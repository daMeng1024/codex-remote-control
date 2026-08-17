import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type {
  BootstrapDto,
  ConnectionDto,
  PendingRequestDto,
  SendTurnInput,
  ThreadDetailDto,
  ThreadPageDto,
  ThreadSummaryDto,
  TimelineItemDto,
} from "@codex-remote/shared";
import { buildApp } from "../src/app.js";
import type { CodexClient } from "../src/codex-client.js";
import type { CodexService } from "../src/codex-service.js";
import type { AppConfig } from "../src/config.js";
import { EventHub } from "../src/event-hub.js";
import { hashPassword } from "../src/security.js";

const connection: ConnectionDto = {
  state: "connected",
  message: "Codex daemon 已连接",
  appServerVersion: "0.146.0",
  supportedVersion: "0.146.0",
  readOnly: false,
};

class FixtureClient extends EventEmitter {
  status(): ConnectionDto {
    return connection;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

const now = Math.floor(Date.now() / 1000);
const thread: ThreadSummaryDto = {
  id: "019e2e2e-e2e0-7000-8000-000000000001",
  sessionId: "e2e-session",
  name: "远程工作台验收",
  preview: "验证手机与桌面流程",
  cwd: "/home/epean/code/epean/other/remoteControl",
  source: "appServer",
  modelProvider: "openai",
  createdAt: now - 60,
  updatedAt: now,
  isPinned: false,
  archived: false,
  status: { type: "idle", waitingOnApproval: false, waitingOnUserInput: false },
  canAcceptDirectInput: true,
  parentThreadId: null,
  forkedFromId: null,
};

const initialItem: TimelineItemDto = {
  id: "assistant-initial",
  turnId: "turn-initial",
  type: "assistant",
  status: null,
  title: null,
  text: "## 准备就绪\n\n- Markdown 内容已格式化\n- 支持图片附件",
  command: null,
  cwd: null,
  output: null,
  exitCode: null,
  durationMs: null,
  fileChanges: [],
  images: [],
};

const initialUserItem: TimelineItemDto = {
  id: "user-initial",
  turnId: "turn-initial",
  type: "user",
  status: null,
  title: null,
  text: "检查移动端渲染",
  command: null,
  cwd: null,
  output: null,
  exitCode: null,
  durationMs: null,
  fileChanges: [],
  images: [],
};

const turns: ThreadDetailDto["turns"] = [
  {
    id: "turn-initial",
    status: "completed",
    startedAt: now - 50,
    completedAt: now - 49,
    durationMs: 1_000,
    items: [initialUserItem, initialItem],
  },
];

const pending = new Map<string, PendingRequestDto>();
const events = new EventHub();

function detail(): ThreadDetailDto {
  return {
    thread,
    model: "gpt-test",
    serviceTier: "fast",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    reasoningEffort: "high",
    permissionProfile: "workspace",
    turns: turns.map((turn) => ({ ...turn, items: [...turn.items] })),
    nextTurnsCursor: null,
    tokenUsage: {
      totalTokens: 1_240,
      inputTokens: 1_000,
      cachedInputTokens: 500,
      cacheWriteInputTokens: 0,
      outputTokens: 240,
      reasoningOutputTokens: 80,
      modelContextWindow: 200_000,
    },
  };
}

const service = {
  async bootstrap(): Promise<BootstrapDto> {
    return {
      connection,
      pendingRequests: [...pending.values()],
      models: [{ value: "gpt-test", label: "GPT Test" }],
      collaborationModes: [{ value: "plan", label: "计划" }],
      permissionProfiles: [{ value: "workspace", label: "Workspace" }],
      workspaceRoot: "/home/epean/code",
    };
  },
  async listThreads(): Promise<ThreadPageDto> {
    return { data: [thread], nextCursor: null, backwardsCursor: null };
  },
  async getThread(): Promise<ThreadDetailDto> {
    return detail();
  },
  async createThread(): Promise<{ threadId: string }> {
    return { threadId: thread.id };
  },
  async sendTurn(
    _threadId: string,
    input: SendTurnInput,
  ): Promise<{ turn: { id: string } }> {
    const turnId = `turn-${turns.length + 1}`;
    const item: TimelineItemDto = {
      id: `assistant-${turns.length + 1}`,
      turnId,
      type: "assistant",
      status: null,
      title: null,
      text: `已收到：${input.text}`,
      command: null,
      cwd: null,
      output: null,
      exitCode: null,
      durationMs: null,
      fileChanges: [],
      images: [],
    };
    turns.push({
      id: turnId,
      status: "completed",
      startedAt: now,
      completedAt: now,
      durationMs: 25,
      items: [item],
    });
    const request: PendingRequestDto = {
      id: `approval-${turns.length}`,
      kind: "command",
      threadId: thread.id,
      turnId,
      itemId: item.id,
      title: "命令执行审批",
      reason: "测试审批流程",
      command: "npm test",
      cwd: thread.cwd,
      createdAt: Date.now(),
      decisions: [
        { id: "accept", label: "允许一次", tone: "primary" },
        { id: "decline", label: "拒绝", tone: "danger" },
      ],
      questions: [],
      resolved: false,
    };
    pending.set(request.id, request);
    events.publish(
      "timeline.updated",
      { mode: "replace", turnId, item },
      thread.id,
    );
    events.publish("approval.requested", request, thread.id);
    return { turn: { id: turnId } };
  },
  async steerTurn(threadId: string, input: SendTurnInput) {
    return this.sendTurn(threadId, input);
  },
  async interruptTurn() {
    return {};
  },
  async forkThread() {
    return { threadId: thread.id };
  },
  async setThreadName(_threadId: string, name: string) {
    thread.name = name;
    return {};
  },
  async archiveThread() {
    return {};
  },
  async unarchiveThread() {
    return {};
  },
  async unsubscribe() {
    return { status: "notSubscribed" };
  },
  respondToRequest(requestId: string) {
    if (!pending.delete(requestId)) throw new Error("该请求已解决或不存在。");
    events.publish(
      "approval.resolved",
      { requestId, reason: "answered" },
      thread.id,
    );
  },
};

const config: AppConfig = {
  nodeEnv: "test",
  passwordHash: await hashPassword("codex-e2e-password"),
  sessionSecret: "e2e-session-secret-with-more-than-32-characters",
  bindHost: "127.0.0.1",
  port: 8790,
  allowedOrigins: new Set(["http://127.0.0.1:8790"]),
  workspaceRoot: "/home/epean/code",
  cookieSecure: false,
  codexBin: "codex",
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
};

const app = await buildApp(config, {
  client: new FixtureClient() as unknown as CodexClient,
  service: service as unknown as CodexService,
  events,
});

let rejectEventConnectionsUntil = 0;
app.websocketServer.on("connection", (socket) => {
  if (Date.now() < rejectEventConnectionsUntil) {
    socket.close(1012, "E2E event stream restart");
  }
});
app.post("/__e2e/restart-events", async () => {
  rejectEventConnectionsUntil = Date.now() + 1_200;
  for (const socket of app.websocketServer.clients) {
    socket.close(1012, "E2E event stream restart");
  }
  return { ok: true };
});

await app.listen({ host: config.bindHost, port: config.port });

async function stop() {
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
