import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const expectedVersion = "0.146.0";
const cwd = "/home/epean/code/epean/other/remoteControl";
const { stdout } = await execFileAsync(
  "/home/epean/.local/bin/codex",
  ["app-server", "daemon", "version"],
  { timeout: 8_000 },
);
const daemon = JSON.parse(stdout);
if (daemon.status !== "running")
  throw new Error("managed app-server is not running");
if (daemon.appServerVersion !== expectedVersion) {
  throw new Error(
    `Expected app-server ${expectedVersion}, received ${daemon.appServerVersion}`,
  );
}

const socket = await new Promise((resolve, reject) => {
  const candidate = new WebSocket("ws://localhost/", {
    createConnection: () => net.createConnection(daemon.socketPath),
    handshakeTimeout: 8_000,
    perMessageDeflate: false,
  });
  candidate.once("open", () => resolve(candidate));
  candidate.once("error", reject);
});

let nextId = 0;
const pending = new Map();
socket.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if ("id" in message && !("method" in message)) {
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
    return;
  }
  if ("id" in message && "method" in message) {
    let result = null;
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval"
    ) {
      result = { decision: "decline" };
    } else if (message.method === "item/permissions/requestApproval") {
      result = { permissions: {}, scope: "turn" };
    } else if (message.method === "item/tool/requestUserInput") {
      result = { answers: {} };
    } else if (message.method === "mcpServer/elicitation/request") {
      result = { action: "decline", content: null, _meta: null };
    }
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  }
});

function request(method, params) {
  const id = ++nextId;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
  });
}

let imagePath = null;
try {
  await request("initialize", {
    clientInfo: {
      name: "codex-remote-control-live-check",
      title: "Codex Remote Control Live Check",
      version: "0.1.0",
    },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));

  const listed = await request("thread/list", {
    limit: 1,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
  });
  let rejoined = false;
  let historyRead = false;
  const existing = listed.data?.[0];
  if (existing) {
    await request("thread/resume", {
      threadId: existing.id,
      approvalsReviewer: "user",
      excludeTurns: true,
    });
    rejoined = true;
    await request("thread/turns/list", {
      threadId: existing.id,
      limit: 1,
      sortDirection: "desc",
      itemsView: "full",
    });
    historyRead = true;
    await request("thread/unsubscribe", { threadId: existing.id });
  }

  const started = await request("thread/start", {
    cwd,
    runtimeWorkspaceRoots: [cwd],
    approvalsReviewer: "user",
    approvalPolicy: "on-request",
    ephemeral: true,
    threadSource: "appServer",
  });
  imagePath = join(tmpdir(), `codex-remote-live-${randomUUID()}.png`);
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    { mode: 0o600 },
  );
  const turn = await request("turn/start", {
    threadId: started.thread.id,
    input: [
      {
        type: "text",
        text: "Acknowledge the supplied image with OK only. Do not run commands, access other files, or modify anything.",
        text_elements: [],
      },
      { type: "localImage", path: imagePath },
    ],
    approvalsReviewer: "user",
  });
  let safeInterrupt = "interrupted";
  try {
    await request("turn/interrupt", {
      threadId: started.thread.id,
      turnId: turn.turn.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("no active turn")) {
      safeInterrupt = "already-completed";
    } else {
      throw error;
    }
  }
  await request("thread/unsubscribe", { threadId: started.thread.id });

  console.log(
    JSON.stringify({
      version: daemon.appServerVersion,
      initialized: true,
      listedThreads: Array.isArray(listed.data),
      rejoined,
      historyRead,
      localImageAccepted: true,
      safeInterrupt,
    }),
  );
} finally {
  socket.close();
  if (imagePath) await unlink(imagePath).catch(() => undefined);
}
