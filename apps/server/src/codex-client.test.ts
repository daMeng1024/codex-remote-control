import { EventEmitter, once } from "node:events";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { CodexClient, type DaemonVersion } from "./codex-client.js";

interface RpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
}

class MockAppServer extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  readonly received: RpcMessage[] = [];

  send(serialized: string): void {
    const message = JSON.parse(serialized) as RpcMessage;
    this.received.push(message);
    if (message.method === "initialize" && message.id) {
      queueMicrotask(() => this.reply(message.id!, { userAgent: "mock" }));
    }
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  reply(id: number, result: unknown): void {
    this.emit(
      "message",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result })),
    );
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.emit(
      "message",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params })),
    );
  }

  request(id: number, method: string, params: Record<string, unknown>): void {
    this.emit(
      "message",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params })),
    );
  }
}

function daemon(version = "0.146.0"): DaemonVersion {
  return {
    status: "running",
    socketPath: "/tmp/mock.sock",
    appServerVersion: version,
  };
}

describe("CodexClient", () => {
  it("initializes and correlates out-of-order JSON-RPC responses", async () => {
    const server = new MockAppServer();
    const client = new CodexClient("codex", {
      readDaemonVersion: async () => daemon(),
      openSocket: async () => server as unknown as WebSocket,
    });
    await client.start();

    const first = client.request<{ value: string }>("thread/list", {
      cursor: null,
    });
    const second = client.request<{ value: string }>("thread/read", {
      threadId: "thread-1",
    });
    const requests = server.received.filter((message) =>
      message.method?.startsWith("thread/"),
    );
    server.reply(requests[1]!.id!, { value: "second" });
    server.reply(requests[0]!.id!, { value: "first" });

    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "second" });
    expect(server.received[0]).toMatchObject({ method: "initialize" });
    expect(server.received[1]).toMatchObject({ method: "initialized" });
    await client.stop();
  });

  it("normalizes notifications and server requests and can answer the request", async () => {
    const server = new MockAppServer();
    const client = new CodexClient("codex", {
      readDaemonVersion: async () => daemon(),
      openSocket: async () => server as unknown as WebSocket,
    });
    await client.start();
    const notification = once(client, "notification");
    const serverRequest = once(client, "serverRequest");

    server.notify("thread/status/changed", { threadId: "thread-1" });
    server.request(77, "item/fileChange/requestApproval", {
      threadId: "thread-1",
    });

    await expect(notification).resolves.toEqual([
      expect.objectContaining({ method: "thread/status/changed" }),
    ]);
    await expect(serverRequest).resolves.toEqual([
      expect.objectContaining({
        id: 77,
        method: "item/fileChange/requestApproval",
      }),
    ]);
    client.respond(77, { decision: "decline" });
    expect(server.received.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 77,
      result: { decision: "decline" },
    });
    await client.stop();
  });

  it("degrades to read only when the app-server version differs", async () => {
    const server = new MockAppServer();
    const client = new CodexClient("codex", {
      readDaemonVersion: async () => daemon("0.147.0"),
      openSocket: async () => server as unknown as WebSocket,
    });
    await client.start();

    expect(client.status()).toMatchObject({
      state: "version-mismatch",
      readOnly: true,
    });
    await expect(client.request("turn/start", {}, true)).rejects.toThrow(
      "只读模式",
    );
    await client.stop();
  });

  it("reconnects and initializes a replacement socket after disconnect", async () => {
    const first = new MockAppServer();
    const second = new MockAppServer();
    const openSocket = vi
      .fn()
      .mockResolvedValueOnce(first as unknown as WebSocket)
      .mockResolvedValueOnce(second as unknown as WebSocket);
    const client = new CodexClient("codex", {
      readDaemonVersion: async () => daemon(),
      openSocket,
      reconnectDelayMs: 5,
    });
    await client.start();
    const reconnected = once(client, "connection");

    first.close();
    await vi.waitFor(() => expect(openSocket).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(client.status().state).toBe("connected"));

    expect(second.received[0]).toMatchObject({ method: "initialize" });
    await reconnected;
    await client.stop();
  });
});
