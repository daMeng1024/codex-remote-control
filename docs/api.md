# 应用 API

本文记录浏览器与 Fastify 网关之间的应用接口。它不是 Codex app-server API，也不承诺作为第三方公共 SDK 长期兼容。

## 1. 通用约定

默认基址与页面同源：

```text
http://<host>:8787
```

JSON 请求使用：

```http
Content-Type: application/json
```

认证通过 `codex_remote_session` HttpOnly Cookie。除健康、session 状态和登录外，所有 `/api` 路由都需要有效 Cookie。

所有非 GET/HEAD 请求以及 WebSocket upgrade 还必须携带 `ALLOWED_ORIGINS` 中的精确 `Origin`。

错误响应：

```json
{
  "error": "invalid_request",
  "message": "请求参数不正确。",
  "details": []
}
```

## 2. 公共接口

### `GET /api/health`

无需登录。

```json
{
  "ok": true,
  "codexConnected": true
}
```

`ok` 只表示网关可响应；Codex 连接单独看 `codexConnected`。

### `GET /api/session`

无需登录，读取当前 Cookie 是否有效：

```json
{ "authenticated": false }
```

### `POST /api/auth/login`

每来源 IP 10 分钟最多 5 次。

```json
{ "password": "<access-password>" }
```

成功返回：

```json
{ "authenticated": true }
```

并设置 12 小时 HttpOnly Cookie。

## 3. 认证与 bootstrap

### `POST /api/auth/logout`

清除 session Cookie：

```json
{}
```

### `GET /api/bootstrap`

返回工作台初始化数据：

```ts
interface BootstrapDto {
  connection: ConnectionDto;
  pendingRequests: PendingRequestDto[];
  models: SelectOptionDto[];
  collaborationModes: SelectOptionDto[];
  permissionProfiles: SelectOptionDto[];
  workspaceRoot: string;
}
```

模型、模式和权限列表来自 app-server。离线或对应请求失败时可能为空数组。

## 4. 图片附件

### `POST /api/attachments`

请求 body 是原始图片字节，不是 JSON 或 multipart。

```http
Content-Type: image/png
X-File-Name: screenshot.png
```

支持 `image/jpeg`、`image/png`、`image/webp`，单张最大 10 MB。

成功返回 `201`：

```json
{
  "id": "uuid",
  "name": "screenshot.png",
  "mimeType": "image/png",
  "size": 12345,
  "url": "/api/attachments/uuid"
}
```

版本不匹配只读模式返回 `409`。

### `GET /api/attachments/:id`

返回图片字节，要求认证。ID 必须是 UUID。响应包含：

```http
Cache-Control: private, max-age=3600
X-Content-Type-Options: nosniff
```

## 5. 会话列表与详情

### `GET /api/threads`

查询参数：

| 参数       | 类型           | 说明                                         |
| ---------- | -------------- | -------------------------------------------- |
| `cursor`   | string         | 下一页 cursor                                |
| `search`   | string         | 最多 200 字符                                |
| `status`   | enum           | `notLoaded`、`idle`、`active`、`systemError` |
| `archived` | boolean string | `true` 或 `false`                            |

返回：

```ts
interface ThreadPageDto {
  data: ThreadSummaryDto[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}
```

服务端向 app-server 请求每页 40 条。

### `GET /api/threads/:id`

查询参数：

- `cursor`：更早 turn 的 cursor。
- `archived`：详情是否来自已归档列表。

返回 `ThreadDetailDto`，包含 thread、模型、服务层级、审批、权限、turn、下一页 cursor 和 token 快照。

正常版本会 resume 会话；版本不匹配时只 read。

## 6. 会话变更

### `POST /api/threads`

```json
{
  "cwd": "/absolute/path/inside/workspace-root",
  "prompt": "实现任务",
  "model": "optional-model",
  "serviceTier": "fast",
  "effort": "high",
  "collaborationMode": "default",
  "permissions": "optional-profile"
}
```

只有 `cwd` 和 `prompt` 必填。`prompt` 最多 50,000 字符。成功返回 `201`：

```json
{ "threadId": "..." }
```

### `POST /api/threads/:id/turns`

```json
{
  "text": "继续任务",
  "attachmentIds": ["uuid"],
  "model": "optional-model",
  "serviceTier": "default",
  "effort": "medium",
  "collaborationMode": "default",
  "permissions": "optional-profile"
}
```

文字和附件不能同时为空。附件最多 4 个且不能重复。

### `POST /api/threads/:id/steer`

```json
{
  "text": "调整当前做法",
  "expectedTurnId": "active-turn-id",
  "attachmentIds": []
}
```

### `POST /api/threads/:id/interrupt`

```json
{ "turnId": "active-turn-id" }
```

### `POST /api/threads/:id/fork`

```json
{ "lastTurnId": "optional-last-turn-id" }
```

成功返回新 `threadId`。

### `POST /api/threads/:id/name`

```json
{ "name": "新的会话名称" }
```

名称去除首尾空白后必须为 1 到 100 字符。

### `POST /api/threads/:id/archive`

请求 body：

```json
{}
```

### `POST /api/threads/:id/unarchive`

请求 body：

```json
{}
```

### `POST /api/threads/:id/unsubscribe`

取消当前网关客户端对线程的订阅，不停止线程：

```json
{}
```

## 7. 审批响应

### `POST /api/requests/:id/respond`

决定型请求：

```json
{ "decisionId": "decision-0" }
```

输入型请求：

```json
{
  "answers": {
    "question-id": ["answer"]
  }
}
```

MCP 请求可同时包含 `decisionId` 与 `answers`。

`decisionId` 是应用级临时 ID，只能选择当前 pending request 实际提供的值。已解决或不存在的请求返回 `409`。

成功返回：

```json
{ "resolved": true }
```

## 8. WebSocket 事件

### `GET /api/events`

连接：

```text
GET /api/events?since=<last-sequence>
Upgrade: websocket
```

要求有效 Cookie 和可信 Origin，最大消息 64 KiB。

事件 envelope：

```ts
interface EventEnvelope<T = unknown> {
  seq: number;
  type: EventType;
  emittedAt: number;
  threadId?: string;
  payload: T;
}
```

事件类型：

| type                 | payload                    | 用途                          |
| -------------------- | -------------------------- | ----------------------------- |
| `connection.updated` | `ConnectionDto`            | daemon 连接、版本和只读状态   |
| `thread.updated`     | `{method}`                 | 提示 REST 刷新会话列表        |
| `turn.updated`       | `{method}`                 | 提示刷新当前详情              |
| `timeline.updated`   | append/replace/refresh DTO | 文本、输出 delta 或 item 更新 |
| `plan.updated`       | `RuntimePlanDto`           | 当前 turn 计划                |
| `diff.updated`       | `RuntimeDiffDto`           | 当前 turn 统一 diff           |
| `token.updated`      | `TokenUsageDto`            | token 和上下文窗口            |
| `approval.requested` | `PendingRequestDto`        | 新审批或输入请求              |
| `approval.resolved`  | `{requestId, reason}`      | 请求失效或已处理              |
| `resync.required`    | `{reason}`                 | 客户端必须重读 REST 快照      |

EventHub 只保留进程内最近 500 条事件。`since` 太旧或大于当前服务端序号时返回 `resync.required`。

## 9. 状态码

| 状态码        | 常见原因                       |
| ------------- | ------------------------------ |
| `200` / `201` | 成功                           |
| `400`         | Zod 校验、工作目录或附件不合法 |
| `401`         | 未登录或 Cookie 过期           |
| `403`         | Origin 不受信任                |
| `404`         | 路由或附件不存在               |
| `409`         | 只读模式、审批已解决或状态冲突 |
| `413`         | 请求体超过上传限制             |
| `415`         | 图片 Content-Type 不支持       |
| `429`         | 登录限流                       |
| `503`         | Codex daemon 不可用            |

## 10. 明确不存在的接口

网关没有以下浏览器路由：

- 任意 JSON-RPC 透传
- `command/exec`
- 任意文件读写
- Codex 配置修改
- 插件安装
- 会话永久删除
- 通用终端 stdin/stdout

需要新增动作时，应先定义最小应用 DTO、权限边界、审计字段和测试，而不是增加通用 RPC endpoint。
