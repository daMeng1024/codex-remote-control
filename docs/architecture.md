# 架构与安全

## 1. 设计目标

本项目解决的是“从另一台受信任设备继续控制当前用户的 Codex 会话”，不是把 Codex 变成公共多租户服务。

核心原则：

- Codex 是会话事实源。
- 浏览器只看应用 DTO，不接触原始 RPC。
- 网关与 app-server 保持同机、同用户、UDS 通信。
- 网络只暴露工作台 HTTP/WS，默认限定 ZeroTier 私网。
- 写操作必须经过固定动作和服务端实际提供的审批决定。

## 2. 组件

| 组件               | 职责                                                             | 不负责                                 |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| React/Vite 前端    | 登录、列表、时间线、输入、审批、响应式布局                       | 直接访问 UDS、执行 Shell、读写任意文件 |
| Fastify 网关       | 认证、Origin、DTO 校验、路由白名单、附件、审计                   | 保存 Codex 会话、提供通用 RPC 代理     |
| CodexClient        | daemon discovery、WebSocket-over-UDS、initialize、请求关联、重连 | 将原始消息直接下发浏览器               |
| CodexService       | thread/turn 操作、通知归一化、审批映射                           | 创造 app-server 未提供的权限决定       |
| EventHub           | 递增序号、最近 500 条事件、客户端回放                            | 持久化事件或跨进程复制                 |
| AttachmentStore    | 校验并临时保存图片                                               | 通用文件存储或永久媒体库               |
| managed app-server | 会话、turn、工具、审批和 Codex 运行状态                          | 浏览器认证和 ZeroTier 访问控制         |

## 3. 连接建立

网关启动流程：

1. 读取并验证环境配置。
2. 初始化图片临时目录并清理超过 24 小时的已识别附件。
3. 执行 `CODEX_BIN app-server daemon version`。
4. 检查 daemon 状态与 app-server 版本。
5. 使用返回的 `socketPath` 建立 WebSocket-over-UDS。
6. 发送 `initialize`，声明 experimental API 和客户端信息。
7. 发送 `initialized` 通知。
8. 发布归一化的连接状态。

UDS WebSocket 显式关闭 `permessage-deflate`，避免 managed daemon 的严格 upgrade 握手拒绝连接。

请求使用递增 JSON-RPC ID 关联响应，默认超时 30 秒。连接断开会拒绝所有未完成请求，2 秒后重连。

## 4. 版本隔离

`packages/shared/src/codex-generated` 是从指定 Codex CLI 生成的协议快照。应用 DTO 位于独立文件，不直接导出完整生成协议给浏览器。

连接时比较：

- app-server 实际版本
- `SUPPORTED_CODEX_VERSION`

不一致时连接状态为 `version-mismatch`，`readOnly=true`。允许 thread/list、thread/read 等读取，禁止：

- 新建、发送和 steer
- 中断、分叉、命名和归档
- 上传图片
- 响应审批或输入请求

这避免用旧 DTO 对新协议执行变更操作。

## 5. 会话生命周期

### 列表

网关调用 `thread/list`，每页 40 条，按 `updated_at` 倒序。搜索由 app-server 执行，状态筛选在归一化结果上执行。

### 打开

正常模式调用 `thread/resume`，设置 `approvalsReviewer=user`，随后通过 `thread/turns/list` 读取每页 30 个完整 turn。

只读模式不 resume，而是调用 `thread/read`，避免版本不匹配时发生订阅或审批归属变更。

### 离开

选择另一会话、手机返回列表或页面卸载时调用 `thread/unsubscribe`。这只取消当前 app-server 客户端订阅，不停止会话。

### 新 turn

普通消息使用 `turn/start`。运行中追加使用 `turn/steer` 并校验 `expectedTurnId`。中断使用 `turn/interrupt`。

所有新 turn 都将审批处理方设置为 `user`，使 app-server 请求可以进入远程审批抽屉。

## 6. 实时事件

app-server 通知经过归一化后发布为应用事件：

- 连接状态
- thread/turn 状态变化
- 时间线 item 开始、完成和文本/输出 delta
- 计划
- 统一 diff
- token 使用量
- 待审批与审批解决

每个事件包含进程内递增 `seq`。EventHub 保存最近 500 条，浏览器在 `sessionStorage` 保存最后序号并通过 `?since=` 重连。

需要 REST 全量同步的情况：

- 浏览器序号大于服务端当前序号，通常说明服务重启。
- 浏览器序号早于 EventHub 最老事件。
- 页面收到 `resync.required`。

进程重启会清空事件、运行时计划、diff、token 快照和 pending 映射，但不会丢失 Codex 会话历史。

## 7. 审批路由

网关只处理五类 app-server server request：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

其他 server request 返回 JSON-RPC `-32601`，不会自动允许。

命令和文件审批的决定集合直接来自 app-server。浏览器只收到随机应用 decision ID、中文标签和 tone；提交时服务端再映射回原始决定，浏览器不能伪造未提供的决定。

权限审批固定映射为本次、本会话和拒绝。用户输入与 MCP schema 被转换为受限问题 DTO。

请求在内存中以 app-server request ID 关联。已解决、重复、断线失效或不存在的请求不能再次响应。

## 8. 图片数据流

1. 浏览器检查 MIME、大小和每次数量。
2. 每张图片单独 POST 到 `/api/attachments`。
3. 服务端检查 Content-Type、大小和 JPEG/PNG/WebP 文件签名。
4. 文件以 UUID 和 `0600` 写入进程临时目录。
5. turn 请求只携带附件 ID。
6. 网关解析 ID 到本机绝对路径并构造 `localImage` 输入。

客户端提供的原始文件名只用于安全截断后的显示，不参与磁盘路径。附件查询只接受 UUID，不能通过路径参数读取其他文件。

附件不是业务数据库：重启时只清理过期文件，不保证长期保存；历史消息中的非本工作台图片也不会被转换为任意本地文件 URL。

## 9. 认证与请求保护

### 登录

- scrypt 哈希验证
- timing-safe 比较
- 每来源 IP 10 分钟最多 5 次
- 成功后签发随机 nonce 和到期时间组成的 HMAC token

### Cookie

- 12 小时
- HttpOnly
- SameSite=Strict
- 可选 Secure

### Origin

以下请求必须有精确白名单 Origin：

- 所有非 GET/HEAD API
- WebSocket upgrade

认证和 Origin 是两层独立检查。拥有 Cookie 但 Origin 不匹配的请求仍被拒绝。

## 10. 路径保护

新会话 cwd 必须位于 `WORKSPACE_ROOT`。根目录和候选路径都经过 `realpath` 后再用 `path.relative` 判断，因此阻断：

- 相对路径
- `..` 穿越
- 不存在路径
- 文件而非目录
- 指向根目录外的符号链接

该保护只限定新建会话 cwd，不替代 Codex 自身的 permission profile 和文件审批。

## 11. 日志与状态

Fastify 日志脱敏：

- Cookie
- Authorization
- 密码
- 消息文字
- prompt
- 审批答案

审计字段只包含：

- 动作
- 对象 ID
- 来源 IP
- 日志时间

项目不使用业务数据库。以下状态仅在内存：

- app-server 连接
- 浏览器 WebSocket 客户端
- 最近 500 条事件
- pending 审批映射
- 当前计划、diff 和 token 快照

## 12. 部署者仍需承担的边界

应用不能替代以下控制：

- ZeroTier 成员授权和设备安全
- 主机、Windows 和 Hyper-V 防火墙
- 操作系统账号与文件权限
- Codex 账号安全
- HTTPS 和公网反向代理
- 日志保留与告警
- 备份和灾难恢复

单用户口令意味着任何拿到口令和 ZeroTier 网络访问权的人都能以该工作台用户身份审批 Codex 操作。不要把该架构直接扩展为多人共享服务。
