# Codex 远程控制工作台

通过手机或桌面浏览器接管本机现有 Codex 会话的单用户工作台。React 前端只访问应用级 REST/WebSocket 接口，Fastify 网关通过 Unix Domain Socket 连接 managed `codex app-server`。

> [!IMPORTANT]
> 当前版本面向受信任的 ZeroTier 私网，不自带公网 HTTPS、多人权限或反向代理。不要把 HTTP 服务直接暴露到互联网。

## 核心能力

- 接管 Codex App、CLI 和本工作台创建的现有会话
- 搜索、状态筛选、历史分页、新建、恢复、分叉、命名和归档会话
- 实时显示 Markdown、计划、命令输出、文件 diff、工具活动和 token 使用量
- 发送文字与图片，运行中追加指令（steer）或中断 turn
- 将历史用户指令重新填入输入框后编辑发送
- 远程处理命令、文件修改、权限、`request_user_input` 和 MCP elicitation
- 手机列表到详情导航、固定输入区和审批抽屉，兼容桌面三栏布局

工作台不向浏览器暴露 Codex socket、原始 JSON-RPC、通用 Shell、独立文件编辑或任意插件安装接口。

## 兼容性基线

| 组件                   | 要求                                           |
| ---------------------- | ---------------------------------------------- |
| Node.js                | 22 或更高                                      |
| npm                    | 9 或更高                                       |
| Codex CLI / app-server | 精确匹配 `0.146.0`                             |
| 运行平台               | Linux 或 WSL2，能够访问 managed app-server UDS |
| 浏览器                 | 当前版本的 Chrome、Edge、Safari 或 Firefox     |

网关会运行 `codex app-server daemon version` 动态取得 socket。运行版本与 `0.146.0` 不一致时，工作台自动进入只读模式，禁止发送、审批和其他变更操作。

## 快速开始

```bash
git clone https://github.com/daMeng1024/codex-remote-control.git
cd codex-remote-control
npm ci
npm run setup:env
npm run dev
```

启动后访问 `http://127.0.0.1:5173`。网关默认监听 `http://127.0.0.1:8787`，Vite 会代理 `/api` 和 WebSocket。

随机访问口令保存在根目录的 `.dev-access-password`。`.env` 与口令文件均以 `0600` 创建并被 Git 忽略。不要把口令、哈希、Cookie 或 session secret 提交到仓库或发送到聊天中。

在开始前确认 managed app-server 可用：

```bash
codex --version
codex app-server daemon version
```

完整的环境准备、首次登录和生产构建说明见[快速入门](docs/getting-started.md)。

## 文档

| 文档                                           | 内容                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| [快速入门](docs/getting-started.md)            | 前置条件、安装、首次启动、登录和基础验证             |
| [用户手册](docs/user-guide.md)                 | 手机与桌面操作、会话、图片、steer、中断和审批        |
| [配置参考](docs/configuration.md)              | 全部环境变量、口令、Cookie、Origin 和路径约束        |
| [ZeroTier 与 systemd 部署](docs/deployment.md) | 私网地址、WSL2、防火墙、用户服务、升级和回滚         |
| [架构与安全](docs/architecture.md)             | 组件边界、数据流、重连、状态模型和威胁边界           |
| [应用 API](docs/api.md)                        | REST DTO、WebSocket 事件、状态码和调用限制           |
| [开发与验证](docs/development.md)              | workspace、协议生成、测试、构建和真实联调            |
| [故障排查](docs/troubleshooting.md)            | 登录、Origin、版本、daemon、ZeroTier、图片和实时连接 |

## 生产部署摘要

生产部署通常按以下顺序完成：

1. 在主机安装依赖并执行 `npm ci`、`npm run build`。
2. 生成 scrypt 口令哈希和至少 32 字符的 session secret。
3. 将环境文件保存到 `~/.config/codex-remote-control/env` 并设置为 `0600`。
4. 将 `BIND_HOST` 和 `ZEROTIER_ADDRESS` 设置为主机实际拥有的同一个 ZeroTier IP。
5. 将 `ALLOWED_ORIGINS` 限定为真实工作台来源。
6. 按实际克隆目录调整 systemd 用户服务模板。
7. 启动后从主机和异地 ZeroTier 客户端分别检查 `/api/health`。

生产模式拒绝 `0.0.0.0`、`::`、主机名、未分配到本机接口的地址，以及与 `ZEROTIER_ADDRESS` 不一致的监听地址。详细步骤和 WSL2 双层防火墙说明见[部署文档](docs/deployment.md)。

## 安全边界

- scrypt 口令哈希
- 12 小时 HMAC 会话 Cookie，`HttpOnly`、`SameSite=Strict`
- 登录按来源 IP 限制为 10 分钟最多 5 次
- 写请求和 WebSocket 强制校验精确 Origin
- 工作目录经过 `realpath` 校验，必须位于 `WORKSPACE_ROOT` 内
- 日志脱敏密码、Cookie、消息、prompt 和审批答案
- 审批按钮只来自 app-server 实际返回的决定集合
- 已解决、过期或断线失效的审批立即移除
- JPEG、PNG、WebP 文件头校验，单张不超过 10 MB，每个 turn 不超过 4 张
- 图片使用随机 ID 和 `0600` 临时文件，启动时清理超过 24 小时的文件
- app-server 版本不匹配或离线时自动只读

浏览器接口是固定动作白名单，不提供 `command/exec`、文件写入、配置修改或插件安装等任意 RPC 透传。安全设计和仍需由部署者承担的风险见[架构与安全](docs/architecture.md)。

## 项目结构

```text
apps/server       Fastify 网关、认证、附件和 app-server UDS 客户端
apps/web          React/Vite 手机优先工作台
packages/shared   应用 DTO 与隔离的 Codex 生成协议类型
deploy/systemd    systemd 用户服务和环境文件模板
docs              使用、部署、架构、API、开发和排错文档
e2e               Playwright 端到端测试
scripts           环境初始化、协议生成和真实 app-server 验证
```

## 常用开发命令

```bash
npm run dev                 # 启动网关与 Vite
npm run typecheck           # 全 workspace 类型检查
npm test                    # 单元和组件测试
npm run test:e2e            # Playwright 手机与桌面流程
npm run build               # 生产构建
npm run verify:live         # 真实 managed app-server 低风险联调
npm run protocol:generate   # 按当前 Codex CLI 重新生成协议类型
```

`protocol:generate` 会删除并重新生成 `packages/shared/src/codex-generated`，同时更新 `SUPPORTED_CODEX_VERSION`。生成后必须完成类型检查、测试、构建和真实联调，不能只提交生成文件。

## 明确不支持

- 直接公网 HTTP 部署
- 多用户、角色和细粒度租户隔离
- Passkey、OIDC 或第三方登录
- 后台通知和离线审批提醒
- 独立终端、通用文件浏览器或文件编辑器
- 会话永久删除
- 除 JPEG、PNG、WebP 之外的附件
- 业务数据库或跨主机会话复制

## License

当前仓库尚未声明开源许可证。公开可读不等于自动授予复制、修改或再发布权限；采用开源许可证前需要由仓库所有者明确选择并添加 `LICENSE`。
