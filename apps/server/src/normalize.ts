import type {
  FileUpdateChange,
  Thread,
  ThreadItem,
  ThreadStatus,
  Turn,
} from "@codex-remote/shared/codex";
import type {
  FileChangeDto,
  ThreadStatusDto,
  ThreadSummaryDto,
  TimelineItemDto,
  TurnDto,
} from "@codex-remote/shared";

function stringifySource(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }
  if (source && typeof source === "object") {
    return Object.keys(source)[0] ?? "unknown";
  }
  return "unknown";
}

function compactJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > 12_000
      ? `${serialized.slice(0, 12_000)}\n...`
      : serialized;
  } catch {
    return String(value);
  }
}

export function normalizeThreadStatus(status: ThreadStatus): ThreadStatusDto {
  if (status.type !== "active") {
    return {
      type: status.type,
      waitingOnApproval: false,
      waitingOnUserInput: false,
    };
  }
  return {
    type: status.type,
    waitingOnApproval: status.activeFlags.includes("waitingOnApproval"),
    waitingOnUserInput: status.activeFlags.includes("waitingOnUserInput"),
  };
}

export function normalizeThread(
  thread: Thread,
  archived = false,
): ThreadSummaryDto {
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    name: thread.name,
    preview: thread.preview,
    cwd: String(thread.cwd),
    source: stringifySource(thread.source),
    modelProvider: thread.modelProvider,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    isPinned: thread.isPinned,
    archived,
    status: normalizeThreadStatus(thread.status),
    canAcceptDirectInput: thread.canAcceptDirectInput,
    parentThreadId: thread.parentThreadId,
    forkedFromId: thread.forkedFromId,
  };
}

function normalizeFileChanges(changes: FileUpdateChange[]): FileChangeDto[] {
  return changes.map((change) => ({
    path: change.path,
    kind: String(change.kind),
    diff: change.diff || null,
  }));
}

function baseItem(item: ThreadItem, turnId: string): TimelineItemDto {
  return {
    id: item.id,
    turnId,
    type: "notice",
    status: null,
    title: null,
    text: null,
    command: null,
    cwd: null,
    output: null,
    exitCode: null,
    durationMs: null,
    fileChanges: [],
    images: [],
  };
}

export function normalizeItem(
  item: ThreadItem,
  turnId: string,
  localImageUrl: (path: string) => string | null = () => null,
): TimelineItemDto {
  const result = baseItem(item, turnId);
  switch (item.type) {
    case "userMessage":
      return {
        ...result,
        type: "user",
        text: item.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        images: item.content
          .filter((part) => part.type === "image" || part.type === "localImage")
          .map((part, index) => ({
            url:
              part.type === "localImage"
                ? localImageUrl(String(part.path))
                : null,
            alt: `图片附件 ${index + 1}`,
          })),
      };
    case "agentMessage":
      return {
        ...result,
        type: "assistant",
        text: item.text,
        status: item.phase,
      };
    case "plan":
      return { ...result, type: "plan", text: item.text, title: "执行计划" };
    case "reasoning":
      return {
        ...result,
        type: "reasoning",
        title: "推理摘要",
        text: [...item.summary, ...item.content].join("\n\n"),
      };
    case "commandExecution":
      return {
        ...result,
        type: "command",
        title: "命令执行",
        status: item.status,
        command: item.command,
        cwd: String(item.cwd),
        output: item.aggregatedOutput,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
      };
    case "fileChange":
      return {
        ...result,
        type: "fileChange",
        title: "文件修改",
        status: item.status,
        fileChanges: normalizeFileChanges(item.changes),
      };
    case "mcpToolCall":
      return {
        ...result,
        type: "tool",
        title: `${item.server} / ${item.tool}`,
        status: item.status,
        text: item.error ? compactJson(item.error) : compactJson(item.result),
        durationMs: item.durationMs,
      };
    case "dynamicToolCall":
      return {
        ...result,
        type: "tool",
        title: [item.namespace, item.tool].filter(Boolean).join(" / "),
        status: item.status,
        text: compactJson(item.contentItems ?? item.arguments),
        durationMs: item.durationMs,
      };
    case "collabAgentToolCall":
      return {
        ...result,
        type: "agent",
        title: `协作代理 / ${String(item.tool)}`,
        status: item.status,
        text: item.prompt,
      };
    case "subAgentActivity":
      return {
        ...result,
        type: "agent",
        title: item.agentPath,
        status: String(item.kind),
        text: item.agentThreadId,
      };
    case "webSearch":
      return {
        ...result,
        type: "tool",
        title: "网页搜索",
        text: item.query,
        output: compactJson(item.results),
      };
    case "imageView":
      return { ...result, title: "查看图片", text: String(item.path) };
    case "imageGeneration":
      return { ...result, title: "生成图片", status: String(item.status) };
    case "sleep":
      return {
        ...result,
        title: "等待",
        text: `${Math.round(item.durationMs / 1000)} 秒`,
      };
    case "enteredReviewMode":
      return { ...result, title: "进入审查模式", text: item.review };
    case "exitedReviewMode":
      return { ...result, title: "退出审查模式", text: item.review };
    case "contextCompaction":
      return { ...result, title: "上下文已压缩" };
    case "hookPrompt":
      return {
        ...result,
        title: "Hook 指令",
        text: compactJson(item.fragments),
      };
  }
}

export function normalizeTurn(
  turn: Turn,
  localImageUrl: (path: string) => string | null = () => null,
): TurnDto {
  return {
    id: turn.id,
    status: String(turn.status),
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    items: turn.items.map((item) =>
      normalizeItem(item, turn.id, localImageUrl),
    ),
  };
}
