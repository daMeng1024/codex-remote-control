import type {
  ApiErrorDto,
  ApprovalResponseInput,
  AttachmentDto,
  BootstrapDto,
  CreateThreadInput,
  SendTurnInput,
  SteerTurnInput,
  ThreadDetailDto,
  ThreadPageDto,
} from "@codex-remote/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as ApiErrorDto | null;
    throw new ApiError(
      body?.message ?? "请求失败。",
      response.status,
      body?.error ?? "error",
    );
  }
  return (await response.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  return parseResponse<T>(response);
}

export const api = {
  session: () => request<{ authenticated: boolean }>("/api/session"),
  login: (password: string) =>
    request<{ authenticated: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request<{ authenticated: boolean }>("/api/auth/logout", {
      method: "POST",
      body: "{}",
    }),
  bootstrap: () => request<BootstrapDto>("/api/bootstrap"),
  uploadAttachment: async (file: File) => {
    const response = await fetch("/api/attachments", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": file.type,
        "x-file-name": encodeURIComponent(file.name),
      },
      body: file,
    });
    return parseResponse<AttachmentDto>(response);
  },
  threads: (filters: {
    search?: string;
    status?: string;
    archived?: boolean;
    cursor?: string;
  }) => {
    const query = new URLSearchParams();
    if (filters.search) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
    if (filters.archived) query.set("archived", "true");
    if (filters.cursor) query.set("cursor", filters.cursor);
    return request<ThreadPageDto>(`/api/threads?${query}`);
  },
  thread: (id: string, cursor?: string, archived = false) => {
    const query = new URLSearchParams();
    if (cursor) query.set("cursor", cursor);
    if (archived) query.set("archived", "true");
    const suffix = query.size > 0 ? `?${query}` : "";
    return request<ThreadDetailDto>(
      `/api/threads/${encodeURIComponent(id)}${suffix}`,
    );
  },
  createThread: (input: CreateThreadInput) =>
    request<{ threadId: string }>("/api/threads", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  sendTurn: (threadId: string, input: SendTurnInput) =>
    request(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  steerTurn: (threadId: string, input: SteerTurnInput) =>
    request(`/api/threads/${encodeURIComponent(threadId)}/steer`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  interruptTurn: (threadId: string, turnId: string) =>
    request(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ turnId }),
    }),
  forkThread: (threadId: string, lastTurnId?: string) =>
    request<{ threadId: string }>(
      `/api/threads/${encodeURIComponent(threadId)}/fork`,
      {
        method: "POST",
        body: JSON.stringify({ lastTurnId }),
      },
    ),
  renameThread: (threadId: string, name: string) =>
    request(`/api/threads/${encodeURIComponent(threadId)}/name`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  archiveThread: (threadId: string, archived: boolean) =>
    request(
      `/api/threads/${encodeURIComponent(threadId)}/${archived ? "unarchive" : "archive"}`,
      { method: "POST", body: "{}" },
    ),
  unsubscribe: (threadId: string) =>
    request(`/api/threads/${encodeURIComponent(threadId)}/unsubscribe`, {
      method: "POST",
      body: "{}",
    }),
  respond: (requestId: string, input: ApprovalResponseInput) =>
    request(`/api/requests/${encodeURIComponent(requestId)}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
