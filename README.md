# Codex 远程控制工作台

面向个人使用的 Codex 会话工作台。浏览器只访问应用级 REST/WebSocket DTO，网关通过 managed `codex app-server` 的 Unix socket 接管已有 App、CLI 和工作台会话。

## 能力边界

- 会话搜索、状态/归档筛选、历史分页、新建、恢复、分叉、命名和归档
- 文字/图片发送、运行中 steer、中断、Markdown 实时消息、指令重新编辑、计划、命令输出、统一 diff 和 token 状态
- 命令、文件、权限、`request_user_input` 和 MCP elicitation 的服务端审批
- 版本必须精确匹配 `codex-cli 0.146.0`；不匹配时自动降级为只读
- 新会话 cwd 必须 realpath 到 `/home/epean/code` 内，越界路径和越界符号链接会被拒绝
- 不提供原始 JSON-RPC、通用 Shell、独立文件编辑、后台推送或永久删除

## 目录

```text
apps/server       Fastify 网关与 app-server UDS 客户端
apps/web          React/Vite 工作台
packages/shared   应用 DTO 与隔离的 Codex 0.146.0 生成协议类型
deploy/systemd    用户服务和环境文件模板
```

## 本地开发

要求 Node.js 22+、npm 9+，以及正在运行的 managed `codex app-server`。

```bash
npm install
npm run setup:env
npm run dev
```

开发页面默认是 `http://127.0.0.1:5173`，网关是 `http://127.0.0.1:8787`。随机访问口令只保存在仓库根目录的 `.dev-access-password`，`.env` 和口令文件均以 `0600` 创建且已忽略，不要提交或发到聊天中。

`setup:env` 在文件已存在时会拒绝覆盖。手工配置可从 `.env.example` 开始，口令哈希可通过以下命令生成：

```bash
npm run password:hash -w @codex-remote/server -- "your-long-random-password"
```

## 协议更新

生成代码只来自当前已安装的 Codex CLI：

```bash
npm run protocol:generate
```

脚本执行 `codex app-server generate-ts --experimental`，并同步更新 `SUPPORTED_CODEX_VERSION`。生成类型与应用 DTO 分离，浏览器不会获得 Codex 原始协议入口。

网关按 `codex app-server daemon version` 返回的路径连接 UDS，并关闭 `permessage-deflate`，使 upgrade 与 managed daemon 的严格 WebSocket 握手一致。可运行真实只读/低风险联调：

```bash
npm run verify:live
```

该检查会 initialize、列出会话、rejoin 最近会话、读取一页历史并 unsubscribe；中断检查只使用 ephemeral 测试线程，不执行命令或文件操作。

## 验证

在 WSL2 上，typecheck、测试和构建必须通过共享 build queue：

```bash
/mnt/d/agent/scripts/wsl2/build-queue/build-queue.sh run \
  --task-id codex-remote-control --kind typescript \
  --workdir /home/epean/code/epean/other/remoteControl -- npm run typecheck

/mnt/d/agent/scripts/wsl2/build-queue/build-queue.sh run \
  --task-id codex-remote-control --kind test \
  --workdir /home/epean/code/epean/other/remoteControl -- npm test

/mnt/d/agent/scripts/wsl2/build-queue/build-queue.sh run \
  --task-id codex-remote-control --kind frontend \
  --workdir /home/epean/code/epean/other/remoteControl -- npm run build
```

## ZeroTier 部署边界

生产模式拒绝 `0.0.0.0`、`::` 和主机名。非 loopback 监听还必须满足：

1. `BIND_HOST` 与 `ZEROTIER_ADDRESS` 完全一致。
2. 该地址确实出现在当前 WSL2 的本机网络接口中。
3. `ALLOWED_ORIGINS` 只包含实际工作台来源。

当前模板使用 `10.123.129.30:8787`，不会同时绑定 `192.168.6.166`。ZeroTier 提供链路加密，应用口令提供第二层身份验证；本版本不提供公网 HTTPS、Passkey 或多人权限。

`deploy/systemd` 仅是模板。复制环境文件、安装 unit、`enable` 或 `start` 都是独立运维动作，不由开发或构建命令执行。

## 安全实现

- scrypt 口令哈希，12 小时 HMAC 会话 Cookie（HttpOnly、SameSite=Strict）
- 登录按来源 IP 限流；写请求和 WebSocket 强制 Origin 白名单
- 日志脱敏口令、Cookie、消息、prompt 和审批答案
- REST 动作为固定白名单，审计日志只记录时间、来源 IP、动作和对象 ID
- 图片仅接受 JPEG/PNG/WebP，单张不超过 10 MB、每次不超过 4 张；服务端校验文件头并使用随机 ID 和 `0600` 临时文件，24 小时后清理
- Codex 是会话事实源；服务只在内存中保存连接、订阅、实时状态和待审批映射
