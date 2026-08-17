# 快速入门

本文从空目录开始，完成开发模式安装、首次登录、新建会话和基本连通性检查。生产部署请继续阅读[ZeroTier 与 systemd 部署](deployment.md)。

## 1. 前置条件

需要以下组件：

- Linux 或 WSL2
- Node.js 22 或更高版本
- npm 9 或更高版本
- Codex CLI `0.146.0`
- 当前用户可访问的 managed `codex app-server`
- 至少一个位于允许工作区根目录内的现有项目目录

检查版本：

```bash
node --version
npm --version
codex --version
```

当前代码的协议基线是 `codex-cli 0.146.0`。版本不同不会让页面完全不可用，但网关会进入只读模式，不能发送消息、上传图片、审批或修改会话。

检查 managed app-server：

```bash
codex app-server daemon version
```

正常结果是 JSON，至少包含：

```json
{
  "status": "running",
  "socketPath": "/path/to/app-server-control.sock",
  "appServerVersion": "0.146.0"
}
```

工作台不要求手工填写 `socketPath`。网关每次连接时都会动态读取该路径。

## 2. 获取源码与安装依赖

```bash
git clone https://github.com/daMeng1024/codex-remote-control.git
cd codex-remote-control
npm ci
```

根目录使用 npm workspaces 管理三个包：

- `@codex-remote/server`
- `@codex-remote/web`
- `@codex-remote/shared`

不要分别进入子目录安装依赖。

## 3. 生成开发环境

```bash
npm run setup:env
```

该命令生成：

| 文件                   | 内容                                       | 权限   |
| ---------------------- | ------------------------------------------ | ------ |
| `.env`                 | scrypt 哈希、session secret 和本地监听配置 | `0600` |
| `.dev-access-password` | 随机访问口令明文                           | `0600` |

两个文件都已在 `.gitignore` 中。脚本发现文件已存在时会拒绝覆盖，避免意外更换口令或使现有 Cookie 全部失效。

查看本机访问口令时直接读取文件，不要将内容写入 shell 历史、日志、Issue 或聊天：

```bash
less .dev-access-password
```

需要手工管理口令时，可生成新的哈希：

```bash
npm run password:hash -w @codex-remote/server -- "your-long-random-password"
```

将输出写入安全环境文件的 `REMOTE_PASSWORD_HASH`。不要把明文口令保存在环境变量模板中。

## 4. 启动开发服务

```bash
npm run dev
```

该命令先构建共享包，再同时启动：

| 服务    | 默认地址                | 用途                               |
| ------- | ----------------------- | ---------------------------------- |
| Vite    | `http://127.0.0.1:5173` | 开发页面和热更新                   |
| Fastify | `http://127.0.0.1:8787` | REST、WebSocket 和 app-server 网关 |

Vite 将 `/api` 请求和 WebSocket 代理到 Fastify。开发时应打开 `5173`，不要直接把 `8787` 当作 Vite 页面地址。

## 5. 检查健康状态

另开终端执行：

```bash
curl http://127.0.0.1:8787/api/health
```

预期响应：

```json
{ "ok": true, "codexConnected": true }
```

字段含义：

- `ok=true`：Fastify 网关已启动。
- `codexConnected=true`：网关已连接 managed app-server。
- `codexConnected=false`：网页可以加载，但会话能力处于离线只读状态。

## 6. 首次登录

1. 打开 `http://127.0.0.1:5173`。
2. 输入 `.dev-access-password` 中的访问口令。
3. 点击“登录”。
4. 登录成功后浏览器获得 12 小时 HttpOnly Cookie。

连续登录失败会按来源 IP 限流：10 分钟最多 5 次。Cookie 使用 `SameSite=Strict`，不要通过 iframe 或跨站页面嵌入工作台。

## 7. 打开或创建会话

### 打开现有会话

会话列表来自 Codex 本身，不是本项目的数据库。选择会话时，网关会：

1. 调用 `thread/resume` 接管会话。
2. 将审批处理方设置为当前工作台用户。
3. 读取最近 30 个 turn。
4. 订阅实时通知。

切换到另一个会话或离开详情时，工作台会调用 `thread/unsubscribe`。

### 创建新会话

1. 点击“新建会话”。
2. 填写绝对工作目录。
3. 选择模型或沿用默认模型。
4. 输入首条任务并创建。

工作目录会经过 `realpath`。它必须真实存在、是目录，并且最终路径位于 `WORKSPACE_ROOT` 内。通过 `..` 或符号链接跳出根目录都会被拒绝。

## 8. 生产构建的本机预检

```bash
npm run typecheck
npm test
npm run build
npm start
```

生产构建后，Fastify 会从 `apps/web/dist` 提供页面，因此只需要访问 `BIND_HOST:PORT` 一个地址。

`npm start` 使用 `.env`。开发环境默认只绑定回环地址；要通过 ZeroTier 访问，必须按[部署文档](deployment.md)准备生产环境，不能简单改成 `0.0.0.0`。

## 9. 下一步

- 日常操作见[用户手册](user-guide.md)。
- 环境变量见[配置参考](configuration.md)。
- ZeroTier 和 systemd 见[部署文档](deployment.md)。
- 页面正常但功能异常时见[故障排查](troubleshooting.md)。
