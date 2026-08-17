import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionDto } from "@codex-remote/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { AttachmentStore } from "./attachment-store.js";
import type { CodexClient } from "./codex-client.js";
import type { CodexService } from "./codex-service.js";
import type { AppConfig } from "./config.js";
import { hashPassword } from "./security.js";

class FakeClient extends EventEmitter {
  private readonly connection: ConnectionDto = {
    state: "offline",
    message: "test offline",
    appServerVersion: null,
    supportedVersion: "0.146.0",
    readOnly: true,
  };

  status(): ConnectionDto {
    return this.connection;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

let validHash = "";
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const attachmentRoots: string[] = [];

beforeAll(async () => {
  validHash = await hashPassword("correct-long-test-password");
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    attachmentRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function config(passwordHash = validHash): AppConfig {
  return {
    nodeEnv: "test",
    passwordHash,
    sessionSecret: "test-session-secret-with-at-least-32-bytes",
    bindHost: "127.0.0.1",
    port: 8787,
    allowedOrigins: new Set(["http://127.0.0.1:5173"]),
    workspaceRoot: "/home/epean/code",
    cookieSecure: false,
    codexBin: "codex",
  };
}

async function testApp(
  passwordHash = validHash,
  attachments?: AttachmentStore,
  client: FakeClient = new FakeClient(),
) {
  const bootstrap = vi.fn(async () => ({ ok: true }));
  const app = await buildApp(config(passwordHash), {
    client: client as unknown as CodexClient,
    service: { bootstrap } as unknown as CodexService,
    attachments,
  });
  apps.push(app);
  return { app, bootstrap };
}

describe("HTTP security boundary", () => {
  it("stops protected routes before their handler when no session is present", async () => {
    const { app, bootstrap } = await testApp();

    const response = await app.inject({ method: "GET", url: "/api/bootstrap" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("requires an allowed Origin for login and sets a strict HttpOnly cookie", async () => {
    const { app } = await testApp();
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-long-test-password" },
    });
    expect(missingOrigin.statusCode).toBe(403);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { password: "correct-long-test-password" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]).toContain("Max-Age=43200");
  });

  it("rate limits repeated failed login attempts", async () => {
    const { app } = await testApp("invalid-hash");
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://127.0.0.1:5173" },
        payload: { password: "wrong-password" },
      });
    }

    expect(response?.statusCode).toBe(429);
  });

  it("does not expose a generic RPC endpoint to an authenticated browser", async () => {
    const { app } = await testApp();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { password: "correct-long-test-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const response = await app.inject({
      method: "POST",
      url: "/api/rpc",
      headers: {
        cookie,
        origin: "http://127.0.0.1:5173",
      },
      payload: { method: "command/exec" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("accepts only authenticated, signature-checked image uploads", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-app-image-test-"));
    attachmentRoots.push(root);
    const client = new FakeClient();
    vi.spyOn(client, "status").mockReturnValue({
      state: "connected",
      message: "connected",
      appServerVersion: "0.146.0",
      supportedVersion: "0.146.0",
      readOnly: false,
    });
    const { app } = await testApp(validHash, new AttachmentStore(root), client);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { password: "correct-long-test-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const upload = await app.inject({
      method: "POST",
      url: "/api/attachments",
      headers: {
        cookie,
        origin: "http://127.0.0.1:5173",
        "content-type": "image/png",
        "x-file-name": encodeURIComponent("手机截图.png"),
      },
      payload: png,
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      name: "手机截图.png",
      mimeType: "image/png",
      size: png.length,
    });
    const image = await app.inject({
      method: "GET",
      url: upload.json().url as string,
      headers: { cookie },
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.rawPayload).toEqual(png);
  });
});
