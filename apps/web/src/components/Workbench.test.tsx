import type {
  BootstrapDto,
  EventEnvelope,
  PendingRequestDto,
  ThreadDetailDto,
  ThreadSummaryDto,
  TimelineItemDto,
} from "@codex-remote/shared";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventHandler: null as ((event: EventEnvelope) => void) | null,
  api: {
    bootstrap: vi.fn(),
    threads: vi.fn(),
    thread: vi.fn(),
    uploadAttachment: vi.fn(),
    unsubscribe: vi.fn(),
    steerTurn: vi.fn(),
    sendTurn: vi.fn(),
    interruptTurn: vi.fn(),
    createThread: vi.fn(),
    forkThread: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
    respond: vi.fn(),
  },
}));

vi.mock("../lib/api", () => ({ api: mocks.api }));
vi.mock("../lib/events", () => ({
  openEventStream: (
    handler: (event: EventEnvelope) => void,
    onStatus: (connected: boolean) => void,
  ) => {
    mocks.eventHandler = handler;
    onStatus(true);
    return { close: vi.fn() };
  },
}));

import { Workbench } from "./Workbench";

const thread: ThreadSummaryDto = {
  id: "thread-1",
  sessionId: "session-1",
  name: "远程控制开发",
  preview: "实现工作台",
  cwd: "/home/epean/code/project",
  source: "cli",
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: Math.floor(Date.now() / 1000),
  isPinned: false,
  archived: false,
  status: { type: "idle", waitingOnApproval: false, waitingOnUserInput: false },
  canAcceptDirectInput: true,
  parentThreadId: null,
  forkedFromId: null,
};

const detail: ThreadDetailDto = {
  thread,
  model: "gpt-test",
  serviceTier: "fast",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  reasoningEffort: "high",
  permissionProfile: "workspace",
  turns: [
    {
      id: "turn-1",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      durationMs: 1_000,
      items: [
        {
          id: "user-1",
          turnId: "turn-1",
          type: "user",
          status: null,
          title: null,
          text: "开始实现",
          command: null,
          cwd: null,
          output: null,
          exitCode: null,
          durationMs: null,
          fileChanges: [],
          images: [],
        },
      ],
    },
  ],
  nextTurnsCursor: null,
  tokenUsage: null,
};

const bootstrap: BootstrapDto = {
  connection: {
    state: "connected",
    message: "已连接",
    appServerVersion: "0.146.0",
    supportedVersion: "0.146.0",
    readOnly: false,
  },
  pendingRequests: [],
  models: [],
  collaborationModes: [],
  permissionProfiles: [],
  workspaceRoot: "/home/epean/code",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventHandler = null;
  mocks.api.bootstrap.mockResolvedValue(bootstrap);
  mocks.api.threads.mockResolvedValue({
    data: [thread],
    nextCursor: null,
    backwardsCursor: null,
  });
  mocks.api.thread.mockResolvedValue(detail);
  mocks.api.uploadAttachment.mockResolvedValue({
    id: "attachment-1",
    name: "test.png",
    mimeType: "image/png",
    size: 8,
    url: "/api/attachments/attachment-1",
  });
  mocks.api.unsubscribe.mockResolvedValue({});
  mocks.api.respond.mockResolvedValue({ resolved: true });
});

describe("Workbench", () => {
  it("opens a listed thread and applies realtime timeline and approval events", async () => {
    const user = userEvent.setup();
    render(<Workbench onLogout={async () => undefined} />);
    await user.click(
      await screen.findByRole("button", { name: /远程控制开发/ }),
    );
    expect(await screen.findByText("开始实现")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新编辑这条指令" }));
    expect(screen.getByLabelText("发送消息")).toHaveValue("开始实现");

    const item: TimelineItemDto = {
      id: "assistant-1",
      turnId: "turn-1",
      type: "assistant",
      status: null,
      title: null,
      text: "实时回复",
      command: null,
      cwd: null,
      output: null,
      exitCode: null,
      durationMs: null,
      fileChanges: [],
      images: [],
    };
    const pending: PendingRequestDto = {
      id: "request-1",
      kind: "fileChange",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      title: "文件修改审批",
      reason: null,
      command: null,
      cwd: null,
      createdAt: 1,
      decisions: [{ id: "deny", label: "拒绝", tone: "danger" }],
      questions: [],
      resolved: false,
    };

    act(() => {
      mocks.eventHandler?.({
        seq: 1,
        type: "timeline.updated",
        emittedAt: 1,
        threadId: "thread-1",
        payload: { mode: "replace", turnId: "turn-1", item },
      });
      mocks.eventHandler?.({
        seq: 2,
        type: "approval.requested",
        emittedAt: 2,
        threadId: "thread-1",
        payload: pending,
      });
    });

    expect(screen.getByText("实时回复")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "待处理请求" }),
    ).toBeInTheDocument();
  });
});
