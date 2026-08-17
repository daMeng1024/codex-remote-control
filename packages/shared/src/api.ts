export const SUPPORTED_CODEX_VERSION = "0.146.0";

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 4;

export type ConnectionState =
  "connecting" | "connected" | "offline" | "version-mismatch";

export interface ConnectionDto {
  state: ConnectionState;
  message: string;
  appServerVersion: string | null;
  supportedVersion: string;
  readOnly: boolean;
}

export type ThreadStatusType = "notLoaded" | "idle" | "active" | "systemError";

export interface ThreadStatusDto {
  type: ThreadStatusType;
  waitingOnApproval: boolean;
  waitingOnUserInput: boolean;
}

export interface ThreadSummaryDto {
  id: string;
  sessionId: string;
  name: string | null;
  preview: string;
  cwd: string;
  source: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  archived: boolean;
  status: ThreadStatusDto;
  canAcceptDirectInput: boolean | null;
  parentThreadId: string | null;
  forkedFromId: string | null;
}

export interface FileChangeDto {
  path: string;
  kind: string;
  diff: string | null;
}

export interface TimelineImageDto {
  url: string | null;
  alt: string;
}

export interface TimelineItemDto {
  id: string;
  turnId: string;
  type:
    | "user"
    | "assistant"
    | "reasoning"
    | "plan"
    | "command"
    | "fileChange"
    | "tool"
    | "agent"
    | "notice"
    | "error";
  status: string | null;
  title: string | null;
  text: string | null;
  command: string | null;
  cwd: string | null;
  output: string | null;
  exitCode: number | null;
  durationMs: number | null;
  fileChanges: FileChangeDto[];
  images: TimelineImageDto[];
}

export interface TurnDto {
  id: string;
  status: string;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  items: TimelineItemDto[];
}

export interface PlanStepDto {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface RuntimePlanDto {
  turnId: string;
  explanation: string | null;
  steps: PlanStepDto[];
}

export interface RuntimeDiffDto {
  turnId: string;
  diff: string;
}

export interface TokenUsageDto {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  modelContextWindow: number | null;
}

export interface ThreadDetailDto {
  thread: ThreadSummaryDto;
  model: string;
  serviceTier: string | null;
  approvalPolicy: string;
  approvalsReviewer: string;
  reasoningEffort: string | null;
  permissionProfile: string | null;
  turns: TurnDto[];
  nextTurnsCursor: string | null;
  tokenUsage: TokenUsageDto | null;
}

export interface SelectOptionDto {
  value: string;
  label: string;
  description?: string;
}

export interface ApprovalDecisionDto {
  id: string;
  label: string;
  tone: "primary" | "danger" | "neutral";
}

export interface UserInputQuestionDto {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: SelectOptionDto[] | null;
}

export interface PendingRequestDto {
  id: string;
  kind: "command" | "fileChange" | "permissions" | "userInput" | "mcp";
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  createdAt: number;
  decisions: ApprovalDecisionDto[];
  questions: UserInputQuestionDto[];
  resolved: boolean;
}

export interface BootstrapDto {
  connection: ConnectionDto;
  pendingRequests: PendingRequestDto[];
  models: SelectOptionDto[];
  collaborationModes: SelectOptionDto[];
  permissionProfiles: SelectOptionDto[];
  workspaceRoot: string;
}

export interface ThreadPageDto {
  data: ThreadSummaryDto[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface CreateThreadInput {
  cwd: string;
  prompt: string;
  model?: string;
  serviceTier?: string;
  effort?: string;
  collaborationMode?: string;
  permissions?: string;
}

export interface SendTurnInput {
  text: string;
  attachmentIds?: string[];
  model?: string;
  serviceTier?: string;
  effort?: string;
  collaborationMode?: string;
  permissions?: string;
}

export interface SteerTurnInput {
  text: string;
  expectedTurnId: string;
  attachmentIds?: string[];
}

export interface AttachmentDto {
  id: string;
  name: string;
  mimeType: ImageMimeType;
  size: number;
  url: string;
}

export interface ApprovalResponseInput {
  decisionId?: string;
  answers?: Record<string, string[]>;
}

export type EventType =
  | "connection.updated"
  | "thread.updated"
  | "turn.updated"
  | "timeline.updated"
  | "plan.updated"
  | "diff.updated"
  | "token.updated"
  | "approval.requested"
  | "approval.resolved"
  | "resync.required";

export interface EventEnvelope<T = unknown> {
  seq: number;
  type: EventType;
  emittedAt: number;
  threadId?: string;
  payload: T;
}

export interface ApiErrorDto {
  error: string;
  message: string;
  details?: unknown;
}
