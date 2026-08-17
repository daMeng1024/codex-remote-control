import { randomUUID } from "node:crypto";
import type {
  ApprovalResponseInput,
  BootstrapDto,
  CreateThreadInput,
  PendingRequestDto,
  RuntimeDiffDto,
  RuntimePlanDto,
  SelectOptionDto,
  SendTurnInput,
  SteerTurnInput,
  ThreadDetailDto,
  ThreadPageDto,
  TokenUsageDto,
  TurnDto,
} from "@codex-remote/shared";
import type {
  CollaborationMode,
  CollaborationModeListResponse,
  CollaborationModeMask,
  CommandExecutionApprovalDecision,
  ModelListResponse,
  PermissionProfileListResponse,
  Thread,
  ThreadForkResponse,
  ThreadItem,
  ThreadListResponse,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  ThreadTurnsListResponse,
  Turn,
  UserInput,
} from "@codex-remote/shared/codex";
import { AttachmentStore, type StoredAttachment } from "./attachment-store.js";
import type { RpcNotification, RpcServerRequest } from "./codex-client.js";
import { CodexClient } from "./codex-client.js";
import { EventHub } from "./event-hub.js";
import { normalizeItem, normalizeThread, normalizeTurn } from "./normalize.js";
import { WorkspaceGuard } from "./workspace.js";

interface ThreadListQuery {
  cursor?: string;
  search?: string;
  status?: string;
  archived?: boolean;
}

interface PendingInternal {
  dto: PendingRequestDto;
  requestId: string | number;
  method: string;
  raw: Record<string, unknown>;
  decisions: Map<string, unknown>;
}

interface TimelineUpdate {
  mode: "append" | "replace" | "refresh";
  itemId?: string;
  turnId?: string;
  field?: "text" | "output";
  delta?: string;
  item?: ReturnType<typeof normalizeItem>;
}

interface ThreadRuntimeState {
  plan?: RuntimePlanDto;
  diff?: RuntimeDiffDto;
  tokenUsage?: TokenUsageDto;
}

const READ_ONLY_MESSAGE = "Codex 版本不匹配，当前只允许查看会话。";

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function policyLabel(value: unknown): string {
  return typeof value === "string" ? value : "granular";
}

function decisionLabel(decision: unknown): {
  label: string;
  tone: "primary" | "danger" | "neutral";
} {
  if (decision === "accept") {
    return { label: "允许一次", tone: "primary" };
  }
  if (decision === "acceptForSession") {
    return { label: "本会话允许", tone: "primary" };
  }
  if (decision === "decline") {
    return { label: "拒绝", tone: "danger" };
  }
  if (decision === "cancel") {
    return { label: "取消任务", tone: "neutral" };
  }
  if (decision && typeof decision === "object") {
    if ("acceptWithExecpolicyAmendment" in decision) {
      return { label: "应用命令规则并允许", tone: "primary" };
    }
    if ("applyNetworkPolicyAmendment" in decision) {
      return { label: "应用网络规则并允许", tone: "primary" };
    }
  }
  return { label: "确认", tone: "neutral" };
}

export class CodexService {
  private readonly pending = new Map<string, PendingInternal>();
  private readonly runtime = new Map<string, ThreadRuntimeState>();
  private collaborationModes: CollaborationModeMask[] = [];

  constructor(
    private readonly client: CodexClient,
    private readonly events: EventHub,
    private readonly workspace: WorkspaceGuard,
    private readonly attachments: AttachmentStore = new AttachmentStore(),
  ) {
    client.on("connection", (connection) => {
      if (connection.state === "offline") {
        this.resolveAllPending("connection-lost");
      }
      events.publish("connection.updated", connection);
    });
    client.on("notification", (notification) =>
      this.handleNotification(notification),
    );
    client.on("serverRequest", (request) => this.handleServerRequest(request));
  }

  async bootstrap(): Promise<BootstrapDto> {
    const workspaceRoot = await this.workspace.root();
    const [models, modes, profiles] = await Promise.all([
      this.safeOptions("model/list"),
      this.safeOptions("collaborationMode/list"),
      this.safeOptions("permissionProfile/list", { cwd: workspaceRoot }),
    ]);
    return {
      connection: this.client.status(),
      pendingRequests: this.pendingRequests(),
      models,
      collaborationModes: modes,
      permissionProfiles: profiles,
      workspaceRoot,
    };
  }

  pendingRequests(): PendingRequestDto[] {
    return [...this.pending.values()].map(({ dto }) => dto);
  }

  async listThreads(query: ThreadListQuery): Promise<ThreadPageDto> {
    const response = await this.client.request<ThreadListResponse>(
      "thread/list",
      {
        cursor: query.cursor ?? null,
        limit: 40,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: query.archived ?? false,
        searchTerm: query.search || null,
        useStateDbOnly: false,
      },
    );
    const normalized = response.data.map((thread) =>
      normalizeThread(thread, query.archived),
    );
    return {
      data: query.status
        ? normalized.filter((thread) => thread.status.type === query.status)
        : normalized,
      nextCursor: response.nextCursor,
      backwardsCursor: response.backwardsCursor,
    };
  }

  async getThread(
    threadId: string,
    cursor?: string,
    archived = false,
  ): Promise<ThreadDetailDto> {
    if (this.client.status().readOnly) {
      const response = await this.client.request<ThreadReadResponse>(
        "thread/read",
        {
          threadId,
          includeTurns: true,
        },
      );
      return {
        thread: normalizeThread(response.thread, archived),
        model: "",
        serviceTier: null,
        approvalPolicy: READ_ONLY_MESSAGE,
        approvalsReviewer: "user",
        reasoningEffort: null,
        permissionProfile: null,
        turns: this.decorateTurns(
          threadId,
          response.thread.turns.map((turn) => this.normalizeTurn(turn)),
        ),
        nextTurnsCursor: null,
        tokenUsage: this.runtime.get(threadId)?.tokenUsage ?? null,
      };
    }

    const resumed = await this.client.request<ThreadResumeResponse>(
      "thread/resume",
      {
        threadId,
        approvalsReviewer: "user",
        excludeTurns: true,
      },
      true,
    );
    const page = await this.client.request<ThreadTurnsListResponse>(
      "thread/turns/list",
      {
        threadId,
        cursor: cursor ?? null,
        limit: 30,
        sortDirection: "desc",
        itemsView: "full",
      },
    );
    return {
      thread: normalizeThread(resumed.thread, archived),
      model: resumed.model,
      serviceTier: resumed.serviceTier,
      approvalPolicy: policyLabel(resumed.approvalPolicy),
      approvalsReviewer: resumed.approvalsReviewer,
      reasoningEffort: resumed.reasoningEffort,
      permissionProfile: resumed.activePermissionProfile?.id ?? null,
      turns: this.decorateTurns(
        threadId,
        page.data
          .slice()
          .reverse()
          .map((turn) => this.normalizeTurn(turn)),
      ),
      nextTurnsCursor: page.nextCursor,
      tokenUsage: this.runtime.get(threadId)?.tokenUsage ?? null,
    };
  }

  async createThread(input: CreateThreadInput): Promise<{ threadId: string }> {
    const cwd = await this.workspace.assertAllowedDirectory(input.cwd);
    const started = await this.client.request<ThreadStartResponse>(
      "thread/start",
      {
        cwd,
        runtimeWorkspaceRoots: [cwd],
        model: input.model || null,
        serviceTier: input.serviceTier || null,
        permissions: input.permissions || null,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        ephemeral: false,
        threadSource: "appServer",
      },
      true,
    );
    await this.client.request(
      "turn/start",
      this.turnParams(started.thread.id, input.prompt, input),
      true,
    );
    return { threadId: started.thread.id };
  }

  async sendTurn(threadId: string, input: SendTurnInput): Promise<unknown> {
    const attachments = await this.attachments.resolve(input.attachmentIds);
    return this.client.request(
      "turn/start",
      this.turnParams(threadId, input.text, input, attachments),
      true,
    );
  }

  async steerTurn(threadId: string, input: SteerTurnInput): Promise<unknown> {
    const attachments = await this.attachments.resolve(input.attachmentIds);
    return this.client.request(
      "turn/steer",
      {
        threadId,
        expectedTurnId: input.expectedTurnId,
        input: this.userInput(input.text, attachments),
      },
      true,
    );
  }

  async interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.client.request("turn/interrupt", { threadId, turnId }, true);
  }

  async forkThread(
    threadId: string,
    lastTurnId?: string,
  ): Promise<{ threadId: string }> {
    const response = await this.client.request<ThreadForkResponse>(
      "thread/fork",
      {
        threadId,
        lastTurnId: lastTurnId ?? null,
        approvalsReviewer: "user",
        excludeTurns: true,
        deferGoalContinuation: true,
      },
      true,
    );
    return { threadId: response.thread.id };
  }

  async setThreadName(threadId: string, name: string): Promise<unknown> {
    return this.client.request("thread/name/set", { threadId, name }, true);
  }

  async archiveThread(threadId: string): Promise<unknown> {
    return this.client.request("thread/archive", { threadId }, true);
  }

  async unarchiveThread(threadId: string): Promise<unknown> {
    return this.client.request("thread/unarchive", { threadId }, true);
  }

  async unsubscribe(threadId: string): Promise<unknown> {
    if (this.client.status().readOnly) {
      return { status: "notSubscribed" };
    }
    return this.client.request("thread/unsubscribe", { threadId }, true);
  }

  respondToRequest(requestId: string, input: ApprovalResponseInput): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.dto.resolved) {
      throw new Error("该请求已解决或不存在。");
    }

    let result: unknown;
    if (pending.dto.kind === "userInput") {
      result = {
        answers: Object.fromEntries(
          Object.entries(input.answers ?? {}).map(([id, answers]) => [
            id,
            { answers },
          ]),
        ),
      };
    } else if (pending.dto.kind === "mcp") {
      const action = pending.decisions.get(input.decisionId ?? "");
      if (!action) {
        throw new Error("请选择有效操作。");
      }
      result = {
        action,
        content:
          action === "accept" ? this.answersToContent(input.answers) : null,
        _meta: null,
      };
    } else {
      const decision = pending.decisions.get(input.decisionId ?? "");
      if (decision === undefined) {
        throw new Error("请选择有效操作。");
      }
      result =
        pending.dto.kind === "command" || pending.dto.kind === "fileChange"
          ? { decision }
          : decision;
    }

    this.client.respond(pending.requestId, result);
    this.markResolved(requestId, "answered");
  }

  private turnParams(
    threadId: string,
    text: string,
    input:
      Omit<CreateThreadInput, "cwd" | "prompt"> | Omit<SendTurnInput, "text">,
    attachments: StoredAttachment[] = [],
  ): Record<string, unknown> {
    return {
      threadId,
      input: this.userInput(text, attachments),
      approvalsReviewer: "user",
      model: input.model || null,
      serviceTier: input.serviceTier || null,
      effort: input.effort || null,
      permissions: input.permissions || null,
      collaborationMode: this.collaborationMode(
        input.collaborationMode,
        input.model,
      ),
    };
  }

  private userInput(
    text: string,
    attachments: StoredAttachment[],
  ): UserInput[] {
    const input: UserInput[] = [];
    if (text.trim()) {
      input.push({ type: "text", text, text_elements: [] });
    }
    input.push(
      ...attachments.map((attachment): UserInput => ({
        type: "localImage",
        path: attachment.path,
      })),
    );
    return input;
  }

  private collaborationMode(
    name?: string,
    selectedModel?: string,
  ): CollaborationMode | null {
    if (!name) {
      return null;
    }
    const preset = this.collaborationModes.find(
      (candidate) => candidate.name === name,
    );
    if (!preset?.mode) {
      return null;
    }
    const model = selectedModel || preset.model;
    if (!model) {
      return null;
    }
    return {
      mode: preset.mode,
      settings: {
        model,
        reasoning_effort: preset.reasoning_effort ?? null,
        developer_instructions: null,
      },
    };
  }

  private async safeOptions(
    method: "model/list" | "collaborationMode/list" | "permissionProfile/list",
    params: Record<string, unknown> = {},
  ): Promise<SelectOptionDto[]> {
    if (this.client.status().state === "offline") {
      return [];
    }
    try {
      if (method === "model/list") {
        const response = await this.client.request<ModelListResponse>(method, {
          limit: 100,
          includeHidden: false,
        });
        return response.data
          .filter((model) => !model.hidden)
          .map((model) => ({
            value: model.model,
            label: model.displayName,
            description: model.description,
          }));
      }
      if (method === "collaborationMode/list") {
        const response =
          await this.client.request<CollaborationModeListResponse>(method, {});
        this.collaborationModes = response.data;
        return response.data.map((mode) => ({
          value: mode.name,
          label:
            mode.name === "plan"
              ? "计划"
              : mode.name === "default"
                ? "默认"
                : mode.name,
        }));
      }
      const response = await this.client.request<PermissionProfileListResponse>(
        method,
        params,
      );
      return response.data
        .filter((profile) => profile.allowed)
        .map((profile) => ({
          value: profile.id,
          label: profile.id,
          description: profile.description ?? undefined,
        }));
    } catch {
      return [];
    }
  }

  private handleNotification(notification: RpcNotification): void {
    const params = notification.params ?? {};
    const threadId = stringValue(params.threadId) ?? undefined;
    if (notification.method === "serverRequest/resolved") {
      const requestId = params.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        this.markResolved(String(requestId), "resolved-by-codex");
      }
      return;
    }

    if (notification.method === "turn/plan/updated" && threadId) {
      const plan: RuntimePlanDto = {
        turnId: stringValue(params.turnId) ?? "",
        explanation: stringValue(params.explanation),
        steps: Array.isArray(params.plan)
          ? params.plan.map((value) => {
              const step = objectValue(value);
              const status = stringValue(step.status);
              return {
                step: stringValue(step.step) ?? "",
                status:
                  status === "inProgress" || status === "completed"
                    ? status
                    : "pending",
              };
            })
          : [],
      };
      this.runtimeState(threadId).plan = plan;
      this.events.publish("plan.updated", plan, threadId);
      return;
    }

    if (notification.method === "turn/diff/updated" && threadId) {
      const diff: RuntimeDiffDto = {
        turnId: stringValue(params.turnId) ?? "",
        diff: stringValue(params.diff) ?? "",
      };
      this.runtimeState(threadId).diff = diff;
      this.events.publish("diff.updated", diff, threadId);
      return;
    }

    if (notification.method === "thread/tokenUsage/updated" && threadId) {
      const usage = objectValue(params.tokenUsage);
      const total = objectValue(usage.total);
      const tokenUsage: TokenUsageDto = {
        totalTokens: numberValue(total.totalTokens) ?? 0,
        inputTokens: numberValue(total.inputTokens) ?? 0,
        cachedInputTokens: numberValue(total.cachedInputTokens) ?? 0,
        cacheWriteInputTokens: numberValue(total.cacheWriteInputTokens) ?? 0,
        outputTokens: numberValue(total.outputTokens) ?? 0,
        reasoningOutputTokens: numberValue(total.reasoningOutputTokens) ?? 0,
        modelContextWindow: numberValue(usage.modelContextWindow),
      };
      this.runtimeState(threadId).tokenUsage = tokenUsage;
      this.events.publish("token.updated", tokenUsage, threadId);
      return;
    }

    if (
      notification.method === "item/started" ||
      notification.method === "item/completed"
    ) {
      const item = params.item as ThreadItem | undefined;
      const turnId = stringValue(params.turnId);
      if (item && turnId && threadId) {
        this.events.publish<TimelineUpdate>(
          "timeline.updated",
          {
            mode: "replace",
            item: normalizeItem(item, turnId, (path) =>
              this.attachments.publicUrlForPath(path),
            ),
            turnId,
          },
          threadId,
        );
      }
      return;
    }

    const deltaMethods: Record<string, "text" | "output"> = {
      "item/agentMessage/delta": "text",
      "item/plan/delta": "text",
      "item/reasoning/summaryTextDelta": "text",
      "item/reasoning/textDelta": "text",
      "item/commandExecution/outputDelta": "output",
      "item/fileChange/outputDelta": "output",
    };
    const field = deltaMethods[notification.method];
    if (field && threadId) {
      this.events.publish<TimelineUpdate>(
        "timeline.updated",
        {
          mode: "append",
          itemId: stringValue(params.itemId) ?? undefined,
          turnId: stringValue(params.turnId) ?? undefined,
          field,
          delta: stringValue(params.delta) ?? "",
        },
        threadId,
      );
      return;
    }

    if (notification.method.startsWith("thread/")) {
      this.events.publish(
        "thread.updated",
        { method: notification.method },
        threadId,
      );
    } else if (notification.method.startsWith("turn/")) {
      this.events.publish(
        "turn.updated",
        { method: notification.method },
        threadId,
      );
    } else if (notification.method.startsWith("item/")) {
      this.events.publish<TimelineUpdate>(
        "timeline.updated",
        { mode: "refresh" },
        threadId,
      );
    }
  }

  private handleServerRequest(request: RpcServerRequest): void {
    const internal = this.normalizeServerRequest(request);
    if (!internal) {
      this.client.respondError(
        request.id,
        -32601,
        "Server request is not supported by this client.",
      );
      return;
    }
    this.pending.set(internal.dto.id, internal);
    this.events.publish(
      "approval.requested",
      internal.dto,
      internal.dto.threadId,
    );
  }

  private normalizeServerRequest(
    request: RpcServerRequest,
  ): PendingInternal | null {
    const raw = request.params ?? {};
    const id = String(request.id);
    const threadId = stringValue(raw.threadId) ?? "";
    const turnId = stringValue(raw.turnId) ?? "";
    const itemId = stringValue(raw.itemId) ?? id;
    const common = {
      id,
      threadId,
      turnId,
      itemId,
      reason: stringValue(raw.reason),
      command: stringValue(raw.command),
      cwd: stringValue(raw.cwd),
      createdAt: numberValue(raw.startedAtMs) ?? Date.now(),
      questions: [],
      resolved: false,
    } satisfies Omit<PendingRequestDto, "kind" | "title" | "decisions">;

    if (request.method === "item/commandExecution/requestApproval") {
      const decisions = this.decisionMap(
        (raw.availableDecisions as
          CommandExecutionApprovalDecision[] | undefined) ?? [],
      );
      return {
        dto: {
          ...common,
          kind: "command",
          title: "命令执行审批",
          decisions: this.decisionDtos(decisions),
        },
        requestId: request.id,
        method: request.method,
        raw,
        decisions,
      };
    }

    if (request.method === "item/fileChange/requestApproval") {
      const decisions = this.decisionMap([
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ]);
      return {
        dto: {
          ...common,
          kind: "fileChange",
          title: "文件修改审批",
          decisions: this.decisionDtos(decisions),
        },
        requestId: request.id,
        method: request.method,
        raw,
        decisions,
      };
    }

    if (request.method === "item/permissions/requestApproval") {
      const requested = objectValue(raw.permissions);
      const decisions = new Map<string, unknown>([
        ["permission-turn", { permissions: requested, scope: "turn" }],
        ["permission-session", { permissions: requested, scope: "session" }],
        ["permission-decline", { permissions: {}, scope: "turn" }],
      ]);
      return {
        dto: {
          ...common,
          kind: "permissions",
          title: "权限申请",
          decisions: [
            { id: "permission-turn", label: "本次允许", tone: "primary" },
            { id: "permission-session", label: "本会话允许", tone: "primary" },
            { id: "permission-decline", label: "拒绝", tone: "danger" },
          ],
        },
        requestId: request.id,
        method: request.method,
        raw,
        decisions,
      };
    }

    if (request.method === "item/tool/requestUserInput") {
      const questions = Array.isArray(raw.questions)
        ? raw.questions.map((questionValue) => {
            const question = objectValue(questionValue);
            return {
              id: stringValue(question.id) ?? randomUUID(),
              header: stringValue(question.header) ?? "需要确认",
              question: stringValue(question.question) ?? "",
              isSecret: question.isSecret === true,
              options: Array.isArray(question.options)
                ? question.options.map((optionValue) => {
                    const option = objectValue(optionValue);
                    return {
                      value: stringValue(option.label) ?? "",
                      label: stringValue(option.label) ?? "",
                      description: stringValue(option.description) ?? undefined,
                    };
                  })
                : null,
            };
          })
        : [];
      return {
        dto: {
          ...common,
          kind: "userInput",
          title: "Codex 需要你的输入",
          decisions: [],
          questions,
        },
        requestId: request.id,
        method: request.method,
        raw,
        decisions: new Map(),
      };
    }

    if (request.method === "mcpServer/elicitation/request") {
      const decisions = new Map<string, unknown>([
        ["mcp-accept", "accept"],
        ["mcp-decline", "decline"],
        ["mcp-cancel", "cancel"],
      ]);
      const schema = objectValue(raw.requestedSchema);
      const properties = objectValue(schema.properties);
      const questions = Object.entries(properties).map(([name, value]) => {
        const property = objectValue(value);
        const values = Array.isArray(property.enum) ? property.enum : null;
        return {
          id: name,
          header: stringValue(property.title) ?? name,
          question: stringValue(property.description) ?? name,
          isSecret: false,
          options: values
            ? values.map((option) => ({
                value: String(option),
                label: String(option),
              }))
            : null,
        };
      });
      return {
        dto: {
          ...common,
          kind: "mcp",
          title: stringValue(raw.message) ?? "MCP 请求输入",
          decisions: [
            { id: "mcp-accept", label: "提交", tone: "primary" },
            { id: "mcp-decline", label: "拒绝", tone: "danger" },
            { id: "mcp-cancel", label: "取消", tone: "neutral" },
          ],
          questions,
        },
        requestId: request.id,
        method: request.method,
        raw,
        decisions,
      };
    }

    return null;
  }

  private decisionMap(decisions: unknown[]): Map<string, unknown> {
    return new Map(
      decisions.map((decision, index) => [`decision-${index}`, decision]),
    );
  }

  private decisionDtos(
    decisions: Map<string, unknown>,
  ): PendingRequestDto["decisions"] {
    return [...decisions.entries()].map(([id, decision]) => ({
      id,
      ...decisionLabel(decision),
    }));
  }

  private answersToContent(
    answers?: Record<string, string[]>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(answers ?? {}).map(([key, values]) => [
        key,
        values.length === 1 ? values[0] : values,
      ]),
    );
  }

  private markResolved(requestId: string, reason: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    pending.dto.resolved = true;
    this.pending.delete(requestId);
    this.events.publish(
      "approval.resolved",
      { requestId, reason },
      pending.dto.threadId,
    );
  }

  private resolveAllPending(reason: string): void {
    for (const requestId of [...this.pending.keys()]) {
      this.markResolved(requestId, reason);
    }
  }

  private runtimeState(threadId: string): ThreadRuntimeState {
    const existing = this.runtime.get(threadId);
    if (existing) {
      return existing;
    }
    const created: ThreadRuntimeState = {};
    this.runtime.set(threadId, created);
    return created;
  }

  private decorateTurns(threadId: string, turns: TurnDto[]): TurnDto[] {
    const runtime = this.runtime.get(threadId);
    if (!runtime) {
      return turns;
    }
    return turns.map((turn) => {
      const items = [...turn.items];
      if (runtime.plan?.turnId === turn.id) {
        const text = [
          runtime.plan.explanation,
          ...runtime.plan.steps.map(
            (step) =>
              `[${step.status === "completed" ? "x" : " "}] ${step.step}`,
          ),
        ]
          .filter(Boolean)
          .join("\n");
        items.push({
          id: `${turn.id}-runtime-plan`,
          turnId: turn.id,
          type: "plan",
          status: null,
          title: "执行计划",
          text,
          command: null,
          cwd: null,
          output: null,
          exitCode: null,
          durationMs: null,
          fileChanges: [],
          images: [],
        });
      }
      if (runtime.diff?.turnId === turn.id && runtime.diff.diff) {
        items.push({
          id: `${turn.id}-runtime-diff`,
          turnId: turn.id,
          type: "fileChange",
          status: null,
          title: "统一 Diff",
          text: null,
          command: null,
          cwd: null,
          output: null,
          exitCode: null,
          durationMs: null,
          fileChanges: [
            { path: "本次变更", kind: "unified", diff: runtime.diff.diff },
          ],
          images: [],
        });
      }
      return { ...turn, items };
    });
  }

  private normalizeTurn(turn: Turn): TurnDto {
    return normalizeTurn(turn, (path) =>
      this.attachments.publicUrlForPath(path),
    );
  }
}
