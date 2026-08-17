import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionDto, EventEnvelope } from "@codex-remote/shared";
import { describe, expect, it, vi } from "vitest";
import type { CodexClient, RpcServerRequest } from "./codex-client.js";
import { AttachmentStore } from "./attachment-store.js";
import { CodexService } from "./codex-service.js";
import { EventHub } from "./event-hub.js";
import { WorkspaceGuard } from "./workspace.js";

class FakeClient extends EventEmitter {
  readonly respond = vi.fn();
  readonly respondError = vi.fn();
  connection: ConnectionDto = {
    state: "connected",
    message: "connected",
    appServerVersion: "0.146.0",
    supportedVersion: "0.146.0",
    readOnly: false,
  };

  status(): ConnectionDto {
    return this.connection;
  }

  request(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }
}

class CapturingEvents extends EventHub {
  readonly published: EventEnvelope[] = [];

  override publish<T>(
    type: EventEnvelope["type"],
    payload: T,
    threadId?: string,
  ): EventEnvelope<T> {
    const event = super.publish(type, payload, threadId);
    this.published.push(event);
    return event;
  }
}

function setup(attachments?: AttachmentStore) {
  const client = new FakeClient();
  const events = new CapturingEvents();
  const service = new CodexService(
    client as unknown as CodexClient,
    events,
    new WorkspaceGuard("/home/epean/code"),
    attachments,
  );
  return { client, events, service };
}

function approval(overrides: Partial<RpcServerRequest> = {}): RpcServerRequest {
  return {
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      command: "npm test",
      availableDecisions: ["accept", "decline"],
      startedAtMs: 1,
    },
    ...overrides,
  };
}

describe("CodexService approval routing", () => {
  it("maps uploaded attachment ids to localImage turn inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-service-image-test-"));
    try {
      const attachments = new AttachmentStore(root);
      const uploaded = await attachments.save(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      );
      const { client, service } = setup(attachments);
      const request = vi
        .spyOn(client, "request")
        .mockResolvedValue({ turn: { id: "turn-1" } } as never);

      await service.sendTurn("thread-1", {
        text: "检查截图",
        attachmentIds: [uploaded.id],
      });

      expect(request).toHaveBeenCalledWith(
        "turn/start",
        expect.objectContaining({
          input: [
            { type: "text", text: "检查截图", text_elements: [] },
            expect.objectContaining({ type: "localImage" }),
          ],
        }),
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shows only command decisions supplied by app-server and rejects duplicate responses", () => {
    const { client, service } = setup();
    client.emit("serverRequest", approval());

    const pending = service.pendingRequests()[0]!;
    expect(pending.decisions.map((decision) => decision.label)).toEqual([
      "允许一次",
      "拒绝",
    ]);
    service.respondToRequest(pending.id, {
      decisionId: pending.decisions[0]!.id,
    });

    expect(client.respond).toHaveBeenCalledWith(42, { decision: "accept" });
    expect(() =>
      service.respondToRequest(pending.id, {
        decisionId: pending.decisions[0]!.id,
      }),
    ).toThrow("已解决");
  });

  it("disables pending requests as soon as app-server resolves them", () => {
    const { client, events, service } = setup();
    client.emit("serverRequest", approval());
    client.emit("notification", {
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: 42 },
    });

    expect(service.pendingRequests()).toHaveLength(0);
    expect(events.published.at(-1)).toMatchObject({
      type: "approval.resolved",
      payload: { requestId: "42", reason: "resolved-by-codex" },
    });
  });

  it("clears all pending requests when the Codex connection is lost", () => {
    const { client, service } = setup();
    client.emit("serverRequest", approval());
    client.connection = {
      ...client.connection,
      state: "offline",
      readOnly: true,
    };
    client.emit("connection", client.connection);

    expect(service.pendingRequests()).toHaveLength(0);
  });

  it("publishes normalized plan, diff, and token updates", () => {
    const { client, events } = setup();
    client.emit("notification", {
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "验证实现",
        plan: [{ step: "运行测试", status: "inProgress" }],
      },
    });
    client.emit("notification", {
      method: "turn/diff/updated",
      params: { threadId: "thread-1", turnId: "turn-1", diff: "+added" },
    });
    client.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: { totalTokens: 123, inputTokens: 100, outputTokens: 23 },
          modelContextWindow: 200_000,
        },
      },
    });

    expect(events.published.map((event) => event.type)).toEqual([
      "plan.updated",
      "diff.updated",
      "token.updated",
    ]);
    expect(events.published.at(-1)?.payload).toMatchObject({
      totalTokens: 123,
      modelContextWindow: 200_000,
    });
  });

  it("rejects server requests outside the approval whitelist", () => {
    const { client, service } = setup();
    client.emit("serverRequest", {
      id: 91,
      method: "item/tool/call",
      params: { threadId: "thread-1" },
    });

    expect(service.pendingRequests()).toHaveLength(0);
    expect(client.respondError).toHaveBeenCalledWith(
      91,
      -32601,
      "Server request is not supported by this client.",
    );
  });
});
