# 开发与验证

## 1. Workspace 结构

项目使用 npm workspaces：

```text
apps/server
apps/web
packages/shared
```

依赖只在仓库根目录安装：

```bash
npm ci
```

各包职责：

- `server`：Fastify、认证、附件、app-server 客户端和业务编排。
- `web`：React 工作台和 REST/WebSocket 客户端。
- `shared`：应用 DTO、常量和生成协议的隔离出口。

## 2. 开发服务

```bash
npm run setup:env
npm run dev
```

根命令先构建 shared，再通过 `concurrently` 启动 server 与 web。任一子进程退出时，开发任务会停止另一子进程。

默认端口：

- Fastify：8787
- Vite：5173
- Playwright fixture：8790

## 3. 命令参考

| 命令                        | 作用                                  |
| --------------------------- | ------------------------------------- |
| `npm run dev`               | shared 构建后启动 server 和 web watch |
| `npm run typecheck`         | 所有 workspace 和 e2e TypeScript 检查 |
| `npm test`                  | 运行 workspace 单元/组件测试          |
| `npm run test:e2e`          | 运行 Playwright 手机与桌面流程        |
| `npm run build`             | 依次构建 shared、web、server          |
| `npm run start`             | 启动已构建 Fastify 服务               |
| `npm run format:check`      | Prettier 检查                         |
| `npm run setup:env`         | 生成本地 secret 和随机访问口令        |
| `npm run protocol:generate` | 从当前 Codex CLI 重新生成 TS 协议     |
| `npm run verify:live`       | 真实 managed app-server 低风险验证    |

## 4. 协议生成

生成脚本执行：

```bash
codex --version
codex app-server generate-ts --experimental \
  --out packages/shared/src/codex-generated
```

然后更新 `packages/shared/src/api.ts` 的 `SUPPORTED_CODEX_VERSION`。

重要行为：

- 生成前会删除整个 `codex-generated` 目录。
- 生成代码与应用 DTO 分离。
- 浏览器只从 shared 的应用出口获取 DTO，不获得通用 RPC client。
- Codex 升级不能只改版本字符串，必须重新生成。

协议升级检查清单：

1. 记录旧 Codex 版本和当前提交。
2. 升级 Codex CLI。
3. 确认 `codex app-server daemon version` 使用新版本。
4. 运行 `npm run protocol:generate`。
5. 审查生成 diff，特别是 thread、turn、approval、permission 和 input 类型。
6. 修复 normalize 和 service 映射。
7. 完成 typecheck、测试、构建、Playwright 和真实联调。
8. 验证旧版本连接会进入只读，而不是继续写操作。

## 5. 应用 DTO 边界

浏览器接口定义在：

```text
packages/shared/src/api.ts
```

新增功能时优先增加最小 DTO，不要直接把 `codex-generated` 类型导出给前端。每个变更动作应回答：

- 浏览器能否构造超出界面能力的 payload？
- 服务端是否重新校验 ID、路径、决定和状态？
- 版本不匹配时是否明确禁止？
- 是否记录不含敏感正文的审计字段？
- 断线或重复提交是否幂等或明确冲突？

## 6. REST 路由开发

路由集中在：

```text
apps/server/src/app.ts
```

要求：

1. 使用 Zod 校验 params、query 和 body。
2. 写请求受 Origin hook 保护。
3. 非公开 `/api` 受 session preHandler 保护。
4. mutation 调用必须向 `CodexClient.request` 传 `mutation=true`。
5. 审计日志只记录动作和对象 ID。
6. 不把原始 app-server error data 返回浏览器。
7. 为成功、校验、未认证、Origin 和只读模式增加测试。

公开路由当前只有：

- `/api/health`
- `/api/session`
- `/api/auth/login`

新增公开路由需要单独进行安全评估。

## 7. 通知归一化

app-server 通知在 `CodexService.handleNotification` 转换为应用事件。新增通知支持时：

- 不透传未知 params。
- 明确提取 string/number/object。
- 为 delta 指定目标字段。
- 无法安全增量合并时发送 `refresh`，让前端读取 REST 快照。
- 确保 threadId 只用于定位，不作为文件或 RPC 方法输入。

前端事件合并位于：

```text
apps/web/src/components/Workbench.tsx
apps/web/src/lib/events.ts
```

## 8. 审批开发

server request 白名单在 `CodexService.normalizeServerRequest`。新增审批类型前必须：

1. 明确 app-server method。
2. 定义应用 DTO。
3. 将原始决定保留在服务端 Map。
4. 浏览器仅持有应用 decision ID。
5. 对响应内容做 schema 校验。
6. 处理 resolved、disconnect 和重复响应。
7. 未支持请求返回 `-32601`，不能默认允许。

## 9. 单元与组件测试

服务端覆盖重点：

- 登录、Cookie、限流、Origin
- 工作区 realpath 和越界符号链接
- app-server 请求关联、超时、重连和版本只读
- thread/turn DTO 归一化
- 事件排序、回放和 resync
- 审批映射、重复响应和断线失效
- 图片 MIME、签名、大小、路径和过期清理

前端覆盖重点：

- 登录
- 输入和图片草稿
- 审批抽屉
- Markdown
- 工作台事件与交互

运行：

```bash
npm test
```

## 10. Playwright

```bash
npm run test:e2e
```

Playwright 使用独立 Fastify fixture，不连接真实 Codex。当前项目覆盖：

- 访问口令登录
- 会话列表和详情
- 历史指令重新编辑
- 图片草稿与发送
- 实时消息
- 审批与拒绝
- WebSocket 断线重连
- `390x844` 手机视口
- `1440x900` 桌面视口
- 页面宽高不超过 viewport

配置默认使用 `/usr/bin/google-chrome`。其他平台需要在 `playwright.config.ts` 调整 executable path 或改用 Playwright 管理的浏览器。

截图和测试结果输出已被 Git 忽略，不应作为源码提交，除非明确选择稳定文档资产目录并审查其中是否包含会话信息。

## 11. 真实 app-server 验证

```bash
npm run verify:live
```

脚本会：

1. 检查 daemon 和精确版本。
2. 通过 UDS WebSocket initialize。
3. 列出一条最近会话。
4. 如存在会话，resume、读取一页历史并 unsubscribe。
5. 创建 ephemeral 测试线程。
6. 发送一张 1x1 临时 PNG 和只要求确认的安全提示。
7. 中断该 ephemeral turn 或接受它已快速完成。
8. unsubscribe 并删除本地临时图片。

脚本对命令、文件和 MCP 审批一律拒绝，不执行通用命令或文件修改。它仍会创建一个 ephemeral Codex 线程，因此不属于纯单元测试。

## 12. 构建与发布验证

建议顺序：

```bash
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run verify:live
```

在具有共享构建协调器的 WSL2 环境中，应按本机 Agent 规则通过构建队列运行 typecheck、test 和 build，避免与其他任务争用资源。公共仓库用户没有该协调器时可直接运行 npm 命令。

文档修改至少检查：

```bash
git diff --check
```

并验证所有相对 Markdown 链接指向已跟踪文件。
