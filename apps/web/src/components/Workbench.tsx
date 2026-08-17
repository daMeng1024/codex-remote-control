import type {
  BootstrapDto,
  ConnectionDto,
  EventEnvelope,
  PendingRequestDto,
  RuntimeDiffDto,
  RuntimePlanDto,
  ThreadDetailDto,
  ThreadSummaryDto,
  TimelineItemDto,
  TokenUsageDto,
} from "@codex-remote/shared";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  GitFork,
  LoaderCircle,
  Pencil,
  RotateCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { openEventStream } from "../lib/events";
import { ApprovalDrawer } from "./ApprovalDrawer";
import { Composer, type ComposerSettings } from "./Composer";
import { NewThreadDialog } from "./NewThreadDialog";
import { ThreadSidebar } from "./ThreadSidebar";
import { Timeline } from "./Timeline";

interface WorkbenchProps {
  onLogout: () => Promise<void>;
}

interface TimelineUpdate {
  mode: "append" | "replace" | "refresh";
  itemId?: string;
  turnId?: string;
  field?: "text" | "output";
  delta?: string;
  item?: TimelineItemDto;
}

const DEFAULT_SETTINGS: ComposerSettings = {
  model: "",
  serviceTier: "",
  effort: "",
  collaborationMode: "",
  permissions: "",
};

function applyTimelineUpdate(
  detail: ThreadDetailDto,
  update: TimelineUpdate,
): ThreadDetailDto {
  if (update.mode === "refresh") return detail;
  const turns = detail.turns.map((turn) => ({
    ...turn,
    items: [...turn.items],
  }));
  const targetTurn = turns.find((turn) => turn.id === update.turnId);
  if (!targetTurn) return detail;

  if (update.mode === "replace" && update.item) {
    const index = targetTurn.items.findIndex(
      (item) => item.id === update.item?.id,
    );
    if (index >= 0) targetTurn.items[index] = update.item;
    else targetTurn.items.push(update.item);
    return { ...detail, turns };
  }

  const item = targetTurn.items.find(
    (candidate) => candidate.id === update.itemId,
  );
  if (!item || !update.field) return detail;
  item[update.field] = `${item[update.field] ?? ""}${update.delta ?? ""}`;
  return { ...detail, turns };
}

function upsertRuntimeItem(
  detail: ThreadDetailDto,
  turnId: string,
  item: TimelineItemDto,
): ThreadDetailDto {
  const turns = detail.turns.map((turn) => ({
    ...turn,
    items: [...turn.items],
  }));
  const turn = turns.find((candidate) => candidate.id === turnId);
  if (!turn) return detail;
  const index = turn.items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) turn.items[index] = item;
  else turn.items.push(item);
  return { ...detail, turns };
}

function planItem(plan: RuntimePlanDto): TimelineItemDto {
  return {
    id: `${plan.turnId}-runtime-plan`,
    turnId: plan.turnId,
    type: "plan",
    status: null,
    title: "执行计划",
    text: [
      plan.explanation,
      ...plan.steps.map(
        (step) => `[${step.status === "completed" ? "x" : " "}] ${step.step}`,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
    command: null,
    cwd: null,
    output: null,
    exitCode: null,
    durationMs: null,
    fileChanges: [],
    images: [],
  };
}

function diffItem(update: RuntimeDiffDto): TimelineItemDto {
  return {
    id: `${update.turnId}-runtime-diff`,
    turnId: update.turnId,
    type: "fileChange",
    status: null,
    title: "统一 Diff",
    text: null,
    command: null,
    cwd: null,
    output: null,
    exitCode: null,
    durationMs: null,
    fileChanges: [{ path: "本次变更", kind: "unified", diff: update.diff }],
    images: [],
  };
}

export function Workbench({ onLogout }: WorkbenchProps) {
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [connection, setConnection] = useState<ConnectionDto>({
    state: "connecting",
    message: "正在连接",
    appServerVersion: null,
    supportedVersion: "",
    readOnly: true,
  });
  const [threads, setThreads] = useState<ThreadSummaryDto[]>([]);
  const [nextThreadsCursor, setNextThreadsCursor] = useState<string | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const selectedArchivedRef = useRef(false);
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const [pending, setPending] = useState<PendingRequestDto[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [eventConnected, setEventConnected] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settings, setSettings] = useState<ComposerSettings>(DEFAULT_SETTINGS);
  const [composerDraft, setComposerDraft] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const draftSequence = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const loadThreadsRef = useRef<() => Promise<void>>(async () => undefined);

  const loadBootstrap = useCallback(async () => {
    const value = await api.bootstrap();
    setBootstrap(value);
    setConnection(value.connection);
    setPending(value.pendingRequests);
  }, []);

  const loadThreads = useCallback(async () => {
    setListLoading(true);
    try {
      const page = await api.threads({ search, status, archived });
      setThreads(page.data);
      setNextThreadsCursor(page.nextCursor);
    } finally {
      setListLoading(false);
    }
  }, [archived, search, status]);
  loadThreadsRef.current = loadThreads;

  const loadMoreThreads = async () => {
    if (!nextThreadsCursor || listLoading) return;
    setListLoading(true);
    try {
      const page = await api.threads({
        search,
        status,
        archived,
        cursor: nextThreadsCursor,
      });
      setThreads((current) => {
        const known = new Set(current.map((thread) => thread.id));
        return [
          ...current,
          ...page.data.filter((thread) => !known.has(thread.id)),
        ];
      });
      setNextThreadsCursor(page.nextCursor);
    } finally {
      setListLoading(false);
    }
  };

  const loadDetail = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setDetailLoading(true);
    try {
      const value = await api.thread(
        id,
        undefined,
        selectedArchivedRef.current,
      );
      if (selectedIdRef.current === id) {
        setDetail(value);
        setSettings((current) => ({
          ...current,
          model: current.model || value.model,
          serviceTier: current.serviceTier || value.serviceTier || "",
          effort: current.effort || value.reasoningEffort || "",
          permissions: current.permissions || value.permissionProfile || "",
        }));
      }
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, []);

  const scheduleDetailRefresh = useCallback(() => {
    if (refreshTimer.current !== null)
      window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      const id = selectedIdRef.current;
      if (id) void loadDetail(id, true);
    }, 280);
  }, [loadDetail]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 250);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => {
    const stream = openEventStream((event: EventEnvelope) => {
      if (event.type === "connection.updated") {
        const nextConnection = event.payload as ConnectionDto;
        setConnection(nextConnection);
        if (nextConnection.state === "connected") {
          void loadThreadsRef.current();
          scheduleDetailRefresh();
        }
        return;
      }
      if (event.type === "approval.requested") {
        const request = event.payload as PendingRequestDto;
        setPending((current) => [
          request,
          ...current.filter((item) => item.id !== request.id),
        ]);
        return;
      }
      if (event.type === "approval.resolved") {
        const requestId = (event.payload as { requestId: string }).requestId;
        setPending((current) =>
          current.filter((item) => item.id !== requestId),
        );
        return;
      }
      if (event.type === "resync.required") {
        void Promise.all([loadBootstrap(), loadThreadsRef.current()]);
        scheduleDetailRefresh();
        return;
      }
      if (event.type === "thread.updated") {
        void loadThreadsRef.current();
      }
      if (event.threadId && event.threadId === selectedIdRef.current) {
        if (event.type === "plan.updated") {
          const plan = event.payload as RuntimePlanDto;
          setDetail((current) =>
            current
              ? upsertRuntimeItem(current, plan.turnId, planItem(plan))
              : current,
          );
          scheduleDetailRefresh();
        } else if (event.type === "diff.updated") {
          const diff = event.payload as RuntimeDiffDto;
          setDetail((current) =>
            current
              ? upsertRuntimeItem(current, diff.turnId, diffItem(diff))
              : current,
          );
          scheduleDetailRefresh();
        } else if (event.type === "token.updated") {
          const tokenUsage = event.payload as TokenUsageDto;
          setDetail((current) =>
            current ? { ...current, tokenUsage } : current,
          );
        } else if (event.type === "timeline.updated") {
          const update = event.payload as TimelineUpdate;
          setDetail((current) =>
            current ? applyTimelineUpdate(current, update) : current,
          );
          if (update.mode !== "append") scheduleDetailRefresh();
        } else {
          scheduleDetailRefresh();
        }
      }
    }, setEventConnected);
    return stream.close;
  }, [loadBootstrap, scheduleDetailRefresh]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
      const selected = selectedIdRef.current;
      if (selected) void api.unsubscribe(selected).catch(() => undefined);
    },
    [],
  );

  const selectThread = async (id: string) => {
    const previous = selectedIdRef.current;
    if (previous && previous !== id)
      void api.unsubscribe(previous).catch(() => undefined);
    selectedIdRef.current = id;
    selectedArchivedRef.current =
      threads.find((thread) => thread.id === id)?.archived ?? false;
    setSelectedId(id);
    setDetail(null);
    setSettings(DEFAULT_SETTINGS);
    setComposerDraft(null);
    await loadDetail(id);
  };

  const closeDetail = () => {
    if (selectedId) void api.unsubscribe(selectedId).catch(() => undefined);
    selectedIdRef.current = null;
    selectedArchivedRef.current = false;
    setSelectedId(null);
    setDetail(null);
    setComposerDraft(null);
  };

  const activeTurn = detail?.turns
    .filter((turn) => turn.status === "inProgress")
    .at(-1);
  const readOnly = connection.readOnly;

  const send = async (text: string, images: File[]) => {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      const attachmentIds: string[] = [];
      for (const image of images) {
        const attachment = await api.uploadAttachment(image);
        attachmentIds.push(attachment.id);
      }
      if (activeTurn) {
        await api.steerTurn(selectedId, {
          text,
          expectedTurnId: activeTurn.id,
          attachmentIds,
        });
      } else {
        await api.sendTurn(selectedId, {
          text,
          attachmentIds,
          model: settings.model || undefined,
          serviceTier: settings.serviceTier || undefined,
          effort: settings.effort || undefined,
          collaborationMode: settings.collaborationMode || undefined,
          permissions: settings.permissions || undefined,
        });
      }
      scheduleDetailRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const interrupt = async () => {
    if (!selectedId || !activeTurn) return;
    await api.interruptTurn(selectedId, activeTurn.id);
    scheduleDetailRefresh();
  };

  const createThread = async (
    input: Parameters<typeof api.createThread>[0],
  ) => {
    const result = await api.createThread(input);
    await loadThreads();
    await selectThread(result.threadId);
  };

  const fork = async () => {
    if (!selectedId) return;
    const lastTurnId = detail?.turns.at(-1)?.id;
    const result = await api.forkThread(selectedId, lastTurnId);
    await loadThreads();
    await selectThread(result.threadId);
  };

  const rename = async () => {
    if (!selectedId) return;
    const value = window.prompt(
      "会话名称",
      detail?.thread.name ?? detail?.thread.preview ?? "",
    );
    if (!value?.trim()) return;
    await api.renameThread(selectedId, value.trim());
    await Promise.all([loadThreads(), loadDetail(selectedId, true)]);
  };

  const archiveCurrent = async () => {
    if (!selectedId || !detail) return;
    await api.archiveThread(selectedId, detail.thread.archived);
    closeDetail();
    await loadThreads();
  };

  const loadOlder = async () => {
    if (!selectedId || !detail?.nextTurnsCursor) return;
    const older = await api.thread(
      selectedId,
      detail.nextTurnsCursor,
      selectedArchivedRef.current,
    );
    setDetail({
      ...detail,
      turns: [...older.turns, ...detail.turns],
      nextTurnsCursor: older.nextTurnsCursor,
    });
  };

  return (
    <main className="workbench-shell">
      <ThreadSidebar
        connection={connection}
        threads={threads}
        selectedId={selectedId}
        search={search}
        status={status}
        archived={archived}
        loading={listLoading}
        hasMore={Boolean(nextThreadsCursor)}
        readOnly={connection.readOnly}
        mobileHidden={Boolean(selectedId)}
        onSearch={setSearch}
        onStatus={setStatus}
        onArchived={setArchived}
        onSelect={(id) => void selectThread(id)}
        onRefresh={() => void loadThreads()}
        onLoadMore={() => void loadMoreThreads()}
        onCreate={() => setCreateOpen(true)}
        onLogout={() => void onLogout()}
      />

      <section
        className={`conversation-pane ${selectedId ? "mobile-visible" : ""}`}
      >
        {connection.state !== "connected" || !eventConnected ? (
          <div className={`connection-banner state-${connection.state}`}>
            <RotateCw
              className={connection.state === "connecting" ? "spin" : ""}
              size={16}
            />
            <span>
              {!eventConnected && connection.state === "connected"
                ? "实时连接正在恢复"
                : connection.message}
            </span>
          </div>
        ) : null}

        {!selectedId ? (
          <div className="no-selection">
            <span className="brand-glyph large">&gt;_</span>
            <strong>Codex 工作台</strong>
          </div>
        ) : (
          <>
            <header className="conversation-header">
              <button
                className="icon-button mobile-only"
                onClick={closeDetail}
                aria-label="返回会话列表"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="conversation-title">
                <strong>
                  {detail?.thread.name || detail?.thread.preview || "会话"}
                </strong>
                <span>
                  {detail?.tokenUsage
                    ? `${detail.tokenUsage.totalTokens.toLocaleString()} tokens · `
                    : ""}
                  {detail?.thread.cwd}
                </span>
              </div>
              <div className="conversation-actions">
                <button
                  className="icon-button"
                  onClick={() => void fork()}
                  disabled={readOnly}
                  title="分叉会话"
                  aria-label="分叉会话"
                >
                  <GitFork size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => void rename()}
                  disabled={readOnly}
                  title="重命名"
                  aria-label="重命名"
                >
                  <Pencil size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => void archiveCurrent()}
                  disabled={readOnly}
                  title={detail?.thread.archived ? "恢复会话" : "归档"}
                  aria-label={detail?.thread.archived ? "恢复会话" : "归档"}
                >
                  {detail?.thread.archived ? (
                    <ArchiveRestore size={18} />
                  ) : (
                    <Archive size={18} />
                  )}
                </button>
              </div>
            </header>

            <div className="conversation-content">
              <div className="timeline-scroll">
                {detail?.nextTurnsCursor ? (
                  <button
                    className="load-older"
                    onClick={() => void loadOlder()}
                  >
                    加载更早记录
                  </button>
                ) : null}
                <Timeline
                  turns={detail?.turns ?? []}
                  loading={detailLoading}
                  onEditUserMessage={(text) => {
                    draftSequence.current += 1;
                    setComposerDraft({ id: draftSequence.current, text });
                  }}
                />
              </div>
              <aside className="thread-inspector">
                <h2>会话状态</h2>
                <dl>
                  <div>
                    <dt>状态</dt>
                    <dd>{detail?.thread.status.type ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>{detail?.model || "-"}</dd>
                  </div>
                  <div>
                    <dt>速度</dt>
                    <dd>{detail?.serviceTier || "default"}</dd>
                  </div>
                  <div>
                    <dt>审批</dt>
                    <dd>{detail?.approvalPolicy || "-"}</dd>
                  </div>
                  <div>
                    <dt>权限</dt>
                    <dd>{detail?.permissionProfile || "-"}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>{detail?.thread.source || "-"}</dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd>
                      {detail?.tokenUsage
                        ? detail.tokenUsage.totalTokens.toLocaleString()
                        : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt>上下文</dt>
                    <dd>
                      {detail?.tokenUsage?.modelContextWindow
                        ? `${Math.round((detail.tokenUsage.totalTokens / detail.tokenUsage.modelContextWindow) * 100)}%`
                        : "-"}
                    </dd>
                  </div>
                </dl>
                {pending.some((request) => request.threadId === selectedId) ? (
                  <div className="inspector-alert">
                    <ShieldAlert size={17} />
                    待处理请求
                  </div>
                ) : null}
              </aside>
            </div>

            <Composer
              key={selectedId}
              active={Boolean(activeTurn)}
              disabled={readOnly || detailLoading}
              submitting={submitting}
              models={bootstrap?.models ?? []}
              collaborationModes={bootstrap?.collaborationModes ?? []}
              permissionProfiles={bootstrap?.permissionProfiles ?? []}
              settings={settings}
              draft={composerDraft}
              onSettings={setSettings}
              onSend={send}
              onInterrupt={interrupt}
            />
          </>
        )}
      </section>

      <ApprovalDrawer
        requests={pending}
        disabled={readOnly}
        onRespond={async (id, input) => {
          await api.respond(id, input);
          setPending((current) =>
            current.filter((request) => request.id !== id),
          );
        }}
      />
      <NewThreadDialog
        open={createOpen}
        workspaceRoot={bootstrap?.workspaceRoot ?? "/home/epean/code"}
        models={bootstrap?.models ?? []}
        onClose={() => setCreateOpen(false)}
        onCreate={createThread}
      />
    </main>
  );
}
