import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  type ApiErrorDto,
} from "@codex-remote/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { AttachmentStore } from "./attachment-store.js";
import { CodexClient } from "./codex-client.js";
import { CodexService } from "./codex-service.js";
import type { AppConfig } from "./config.js";
import { EventHub } from "./event-hub.js";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL,
  verifyPassword,
  verifySessionToken,
} from "./security.js";
import { WorkspaceGuard } from "./workspace.js";

const loginSchema = z.object({ password: z.string().min(1).max(512) });
const threadIdSchema = z.object({ id: z.string().min(1).max(128) });
const threadListSchema = z.object({
  cursor: z.string().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(["notLoaded", "idle", "active", "systemError"]).optional(),
  archived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
const detailQuerySchema = z.object({
  cursor: z.string().optional(),
  archived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
const createThreadSchema = z.object({
  cwd: z.string().min(1).max(4096),
  prompt: z.string().trim().min(1).max(50_000),
  model: z.string().max(200).optional(),
  serviceTier: z.string().max(100).optional(),
  effort: z.string().max(100).optional(),
  collaborationMode: z.string().max(100).optional(),
  permissions: z.string().max(200).optional(),
});
const attachmentIdsSchema = z
  .array(z.string().uuid())
  .max(MAX_ATTACHMENTS_PER_TURN)
  .optional();
const messageInputSchema = z
  .object({
    text: z.string().trim().max(50_000),
    attachmentIds: attachmentIdsSchema,
  })
  .refine(
    (input) => input.text.length > 0 || Boolean(input.attachmentIds?.length),
    { message: "消息文字和图片不能同时为空。" },
  );
const sendTurnSchema = messageInputSchema.and(
  z.object({
    model: z.string().max(200).optional(),
    serviceTier: z.string().max(100).optional(),
    effort: z.string().max(100).optional(),
    collaborationMode: z.string().max(100).optional(),
    permissions: z.string().max(200).optional(),
  }),
);
const steerSchema = messageInputSchema.and(
  z.object({ expectedTurnId: z.string().min(1).max(128) }),
);
const interruptSchema = z.object({ turnId: z.string().min(1).max(128) });
const forkSchema = z.object({ lastTurnId: z.string().max(128).optional() });
const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const requestIdSchema = z.object({ id: z.string().min(1).max(200) });
const attachmentIdSchema = z.object({ id: z.string().uuid() });
const approvalSchema = z.object({
  decisionId: z.string().max(200).optional(),
  answers: z.record(z.string(), z.array(z.string().max(10_000))).optional(),
});

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/session",
  "/api/auth/login",
]);

function isAuthenticated(request: FastifyRequest, config: AppConfig): boolean {
  return verifySessionToken(
    request.cookies[SESSION_COOKIE_NAME],
    config.sessionSecret,
  );
}

function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): FastifyReply | undefined {
  if (!isAuthenticated(request, config)) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "请先登录。",
    } satisfies ApiErrorDto);
  }
}

function audit(
  request: FastifyRequest,
  action: string,
  objectId?: string,
): void {
  request.log.info({
    audit: {
      action,
      objectId,
      sourceIp: request.ip,
    },
  });
}

export interface AppDependencies {
  client?: CodexClient;
  events?: EventHub;
  service?: CodexService;
  attachments?: AttachmentStore;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
) {
  const app = Fastify({
    logger:
      config.nodeEnv === "test"
        ? false
        : {
            level: config.nodeEnv === "production" ? "info" : "debug",
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "body.password",
              "body.text",
              "body.prompt",
              "body.answers",
            ],
          },
  });
  const events = dependencies.events ?? new EventHub();
  const client = dependencies.client ?? new CodexClient(config.codexBin);
  const attachments = dependencies.attachments ?? new AttachmentStore();
  await attachments.init();
  const service =
    dependencies.service ??
    new CodexService(
      client,
      events,
      new WorkspaceGuard(config.workspaceRoot),
      attachments,
    );

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });
  app.addContentTypeParser(
    [...ALLOWED_IMAGE_MIME_TYPES],
    { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) {
      return;
    }
    const origin = request.headers.origin;
    const isUnsafe = request.method !== "GET" && request.method !== "HEAD";
    const isWebSocket = request.headers.upgrade?.toLowerCase() === "websocket";
    if (
      (isUnsafe || isWebSocket) &&
      (!origin || !config.allowedOrigins.has(origin))
    ) {
      return reply.code(403).send({
        error: "invalid_origin",
        message: "请求来源不受信任。",
      } satisfies ApiErrorDto);
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (path.startsWith("/api/") && !PUBLIC_API_PATHS.has(path)) {
      return requireAuth(request, reply, config);
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    codexConnected: client.status().state === "connected",
  }));

  app.get("/api/session", async (request) => ({
    authenticated: isAuthenticated(request, config),
  }));

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "10 minutes",
        },
      },
    },
    async (request, reply) => {
      const { password } = loginSchema.parse(request.body);
      if (!(await verifyPassword(password, config.passwordHash))) {
        audit(request, "auth.login.failed");
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "访问口令不正确。",
        } satisfies ApiErrorDto);
      }
      reply.setCookie(
        SESSION_COOKIE_NAME,
        createSessionToken(config.sessionSecret),
        {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
          secure: config.cookieSecure,
          maxAge: SESSION_TTL,
        },
      );
      audit(request, "auth.login.succeeded");
      return { authenticated: true };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    audit(request, "auth.logout");
    return { authenticated: false };
  });

  app.get("/api/bootstrap", async () => service.bootstrap());

  app.post("/api/attachments", async (request, reply) => {
    if (client.status().readOnly) {
      return reply.code(409).send({
        error: "conflict",
        message: "Codex 当前为只读状态，不能上传图片。",
      } satisfies ApiErrorDto);
    }
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({
        error: "unsupported_media_type",
        message: "仅支持 JPEG、PNG 和 WebP 图片。",
      } satisfies ApiErrorDto);
    }
    const contentType = request.headers["content-type"]?.split(";")[0] ?? "";
    const encodedName = request.headers["x-file-name"];
    let displayName = typeof encodedName === "string" ? encodedName : undefined;
    if (displayName) {
      try {
        displayName = decodeURIComponent(displayName);
      } catch {
        displayName = undefined;
      }
    }
    const attachment = await attachments.save(
      request.body,
      contentType,
      displayName,
    );
    audit(request, "attachment.upload", attachment.id);
    return reply.code(201).send(attachment);
  });

  app.get("/api/attachments/:id", async (request, reply) => {
    const { id } = attachmentIdSchema.parse(request.params);
    const attachment = await attachments.read(id);
    return reply
      .header("Cache-Control", "private, max-age=3600")
      .header("X-Content-Type-Options", "nosniff")
      .type(attachment.mimeType)
      .send(attachment.data);
  });

  app.get("/api/threads", async (request) => {
    const query = threadListSchema.parse(request.query);
    return service.listThreads(query);
  });

  app.get("/api/threads/:id", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const { cursor, archived } = detailQuerySchema.parse(request.query);
    return service.getThread(id, cursor, archived);
  });

  app.post("/api/threads", async (request, reply) => {
    const input = createThreadSchema.parse(request.body);
    const result = await service.createThread(input);
    audit(request, "thread.create", result.threadId);
    return reply.code(201).send(result);
  });

  app.post("/api/threads/:id/turns", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const input = sendTurnSchema.parse(request.body);
    const result = await service.sendTurn(id, input);
    audit(request, "turn.start", id);
    return result;
  });

  app.post("/api/threads/:id/steer", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const input = steerSchema.parse(request.body);
    const result = await service.steerTurn(id, input);
    audit(request, "turn.steer", id);
    return result;
  });

  app.post("/api/threads/:id/interrupt", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const { turnId } = interruptSchema.parse(request.body);
    const result = await service.interruptTurn(id, turnId);
    audit(request, "turn.interrupt", id);
    return result;
  });

  app.post("/api/threads/:id/fork", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const { lastTurnId } = forkSchema.parse(request.body ?? {});
    const result = await service.forkThread(id, lastTurnId);
    audit(request, "thread.fork", id);
    return result;
  });

  app.post("/api/threads/:id/name", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const { name } = nameSchema.parse(request.body);
    const result = await service.setThreadName(id, name);
    audit(request, "thread.rename", id);
    return result;
  });

  app.post("/api/threads/:id/archive", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const result = await service.archiveThread(id);
    audit(request, "thread.archive", id);
    return result;
  });

  app.post("/api/threads/:id/unarchive", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    const result = await service.unarchiveThread(id);
    audit(request, "thread.unarchive", id);
    return result;
  });

  app.post("/api/threads/:id/unsubscribe", async (request) => {
    const { id } = threadIdSchema.parse(request.params);
    return service.unsubscribe(id);
  });

  app.post("/api/requests/:id/respond", async (request) => {
    const { id } = requestIdSchema.parse(request.params);
    const input = approvalSchema.parse(request.body);
    service.respondToRequest(id, input);
    audit(request, "approval.respond", id);
    return { resolved: true };
  });

  app.get("/api/events", { websocket: true }, (socket, request) => {
    if (!isAuthenticated(request, config)) {
      socket.close(1008, "Unauthorized");
      return;
    }
    const query = z
      .object({ since: z.coerce.number().int().min(0).default(0) })
      .parse(request.query);
    events.addClient(socket, query.since);
    events.publish("connection.updated", client.status());
  });

  const defaultWebDist = fileURLToPath(
    new URL("../../web/dist", import.meta.url),
  );
  const webDist = config.webDist ?? defaultWebDist;
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "接口不存在。" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "请求参数不正确。",
        details: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      } satisfies ApiErrorDto);
    }
    const errorMessage = error instanceof Error ? error.message : "";
    const frameworkStatus =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400
        ? error.statusCode
        : null;
    const statusCode = errorMessage.includes("版本不匹配")
      ? 409
      : errorMessage.includes("已解决或不存在")
        ? 409
        : errorMessage.includes("工作目录")
          ? 400
          : errorMessage.includes("daemon 当前不可用")
            ? 503
            : (frameworkStatus ?? 500);
    if (statusCode >= 500) {
      request.log.error(
        { err: error, route: request.routeOptions.url },
        "request failed",
      );
    }
    return reply.code(statusCode).send({
      error:
        statusCode === 409
          ? "conflict"
          : statusCode === 429
            ? "rate_limited"
            : "request_failed",
      message: errorMessage || "请求失败。",
    } satisfies ApiErrorDto);
  });

  app.addHook("onReady", async () => {
    await client.start();
  });
  app.addHook("onClose", async () => {
    await client.stop();
  });

  return app;
}
