import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import { promisify } from "node:util";
import type { ConnectionDto } from "@codex-remote/shared";
import { SUPPORTED_CODEX_VERSION } from "@codex-remote/shared";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const RECONNECT_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface DaemonVersion {
  status: string;
  socketPath: string;
  appServerVersion: string;
}

interface RpcResponse {
  id: string | number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface RpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcServerRequest extends RpcNotification {
  id: string | number;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexClientEvents {
  connection: [ConnectionDto];
  notification: [RpcNotification];
  serverRequest: [RpcServerRequest];
}

export interface CodexClientOptions {
  readDaemonVersion?: () => Promise<DaemonVersion>;
  openSocket?: (socketPath: string) => Promise<WebSocket>;
  reconnectDelayMs?: number;
  requestTimeoutMs?: number;
}

export class CodexClient extends EventEmitter<CodexClientEvents> {
  private socket: WebSocket | null = null;
  private requestId = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string | number, PendingRpc>();
  private connection: ConnectionDto = {
    state: "connecting",
    message: "正在连接 Codex daemon",
    appServerVersion: null,
    supportedVersion: SUPPORTED_CODEX_VERSION,
    readOnly: true,
  };

  constructor(
    private readonly codexBin: string,
    private readonly options: CodexClientOptions = {},
  ) {
    super();
  }

  status(): ConnectionDto {
    return { ...this.connection };
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.rejectPending(new Error("Codex connection stopped."));
  }

  async request<T>(
    method: string,
    params?: unknown,
    mutation = false,
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex daemon 当前不可用。");
    }
    if (mutation && this.connection.readOnly) {
      throw new Error("Codex 版本不匹配，工作台当前为只读模式。");
    }

    const id = ++this.requestId;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  respond(id: string | number, result: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex daemon 当前不可用。");
    }
    if (this.connection.readOnly) {
      throw new Error("Codex 版本不匹配，工作台当前为只读模式。");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  respondError(id: string | number, code: number, message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    );
  }

  private async connect(): Promise<void> {
    this.updateConnection({
      state: "connecting",
      message: "正在连接 Codex daemon",
      appServerVersion: this.connection.appServerVersion,
      supportedVersion: SUPPORTED_CODEX_VERSION,
      readOnly: true,
    });

    try {
      const daemon = await (this.options.readDaemonVersion?.() ??
        this.readDaemonVersion());
      if (daemon.status !== "running") {
        throw new Error("managed app-server 未运行");
      }
      const versionMatches =
        daemon.appServerVersion === SUPPORTED_CODEX_VERSION;
      const socket = await (this.options.openSocket?.(daemon.socketPath) ??
        this.openSocket(daemon.socketPath));
      this.socket = socket;
      socket.on("message", (data) => this.handleMessage(data.toString()));
      socket.on("close", () =>
        this.handleDisconnect("Codex daemon 连接已断开"),
      );
      socket.on("error", (error) => this.handleDisconnect(error.message));

      await this.request("initialize", {
        clientInfo: {
          name: "codex-remote-control",
          title: "Codex Remote Control",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      });
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
      this.updateConnection({
        state: versionMatches ? "connected" : "version-mismatch",
        message: versionMatches
          ? "Codex daemon 已连接"
          : `Codex ${daemon.appServerVersion} 与支持版本 ${SUPPORTED_CODEX_VERSION} 不一致`,
        appServerVersion: daemon.appServerVersion,
        supportedVersion: SUPPORTED_CODEX_VERSION,
        readOnly: !versionMatches,
      });
    } catch (error) {
      this.handleDisconnect(
        error instanceof Error ? error.message : "连接失败",
      );
      throw error;
    }
  }

  private async readDaemonVersion(): Promise<DaemonVersion> {
    const { stdout } = await execFileAsync(
      this.codexBin,
      ["app-server", "daemon", "version"],
      { timeout: 8_000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(stdout) as DaemonVersion;
  }

  private openSocket(socketPath: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket("ws://localhost/", {
        createConnection: () => net.createConnection(socketPath),
        handshakeTimeout: 8_000,
        perMessageDeflate: false,
      });
      const onError = (error: Error) => reject(error);
      socket.once("error", onError);
      socket.once("open", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    });
  }

  private handleMessage(serialized: string): void {
    let message: RpcResponse | RpcNotification | RpcServerRequest;
    try {
      message = JSON.parse(serialized) as
        RpcResponse | RpcNotification | RpcServerRequest;
    } catch {
      return;
    }

    if ("id" in message && !("method" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? "Codex request failed."),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("method" in message && "id" in message) {
      this.emit("serverRequest", message as RpcServerRequest);
      return;
    }
    if ("method" in message) {
      this.emit("notification", message as RpcNotification);
    }
  }

  private handleDisconnect(message: string): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.rejectPending(new Error(message));
    this.updateConnection({
      state: "offline",
      message,
      appServerVersion: this.connection.appServerVersion,
      supportedVersion: SUPPORTED_CODEX_VERSION,
      readOnly: true,
    });
    if (!this.stopped && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect().catch(() => undefined);
      }, this.options.reconnectDelayMs ?? RECONNECT_DELAY_MS);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private updateConnection(connection: ConnectionDto): void {
    this.connection = connection;
    this.emit("connection", this.status());
  }
}
