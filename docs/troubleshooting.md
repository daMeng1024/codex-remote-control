# 故障排查

按层次排查，不要一开始就把监听改成 `0.0.0.0` 或关闭全部防火墙。

## 1. 快速诊断顺序

1. Fastify 进程是否运行。
2. `/api/health` 是否响应。
3. `codexConnected` 是否为 true。
4. Codex 与支持版本是否一致。
5. 监听地址是否为预期 ZeroTier IP。
6. 主机本地是否能访问 ZeroTier IP:8787。
7. 异地设备是否能 ping/访问该 IP。
8. Windows、Hyper-V、Linux 防火墙是否允许 ZeroTier 来源。
9. 浏览器 Origin 是否与环境配置完全一致。
10. WebSocket 是否被网络或代理阻断。

## 2. 健康检查

```bash
curl http://<host>:8787/api/health
```

### 无法建立 TCP 连接

检查：

```bash
systemctl --user status codex-remote-control --no-pager
ss -ltnp 'sport = :8787'
journalctl --user -u codex-remote-control -n 100 --no-pager
```

### `ok=true`、`codexConnected=false`

网关运行正常，但 app-server 连接失败。继续检查 daemon 和版本。

## 3. managed app-server 离线

```bash
codex app-server daemon version
```

常见原因：

- daemon 没有运行。
- `CODEX_BIN` 路径错误。
- systemd 服务用户与 Codex 用户不同。
- UDS 路径不可读。
- daemon 在网关启动后重启。

CodexClient 断线后每 2 秒尝试重连。恢复 daemon 后通常无需重启网页；如果 `CODEX_BIN` 或用户错误，则必须修正环境或 unit。

## 4. 版本不匹配和只读模式

界面提示版本不一致，按钮禁用或 API 返回 `409` 时比较：

```bash
codex --version
codex app-server daemon version
```

再查看代码支持版本：

```bash
rg 'SUPPORTED_CODEX_VERSION' packages/shared/src/api.ts
```

解决方式只有两类：

- 使用与代码匹配的 Codex CLI/app-server。
- 按[开发文档](development.md)重新生成协议并完成全部验证。

不要只修改版本字符串绕过只读保护。

## 5. 登录失败

### “访问口令不正确”

确认输入的是明文访问口令，不是 `REMOTE_PASSWORD_HASH`。开发环境口令在 `.dev-access-password`。

如手工维护环境，重新生成哈希并重启服务：

```bash
npm run password:hash -w @codex-remote/server -- "new-long-random-password"
systemctl --user restart codex-remote-control
```

### `429 Too Many Requests`

同一来源 IP 10 分钟最多 5 次登录请求。等待窗口恢复并确认手机、反向代理或 NAT 是否让多个设备共享同一来源 IP。

### 登录成功后立即变成未登录

检查：

- 浏览器是否禁用 Cookie。
- `COOKIE_SECURE=true` 时是否实际使用 HTTPS。
- host/port 是否在登录后发生变化。
- 服务是否重启并更换了 `SESSION_SECRET`。
- 页面是否被第三方站点 iframe 嵌入。

## 6. `403 请求来源不受信任`

浏览器当前 Origin 必须精确出现在 `ALLOWED_ORIGINS`：

```text
scheme://host:port
```

常见错误：

- 使用 `localhost` 配置，却通过 IP 访问。
- 漏掉端口。
- HTTP/HTTPS 不一致。
- 添加了末尾 `/` 或路径。
- 修改环境后没有重启服务。

在浏览器地址栏看到什么 Origin，就配置什么 Origin。不要配置 `*`。

## 7. 新建会话提示工作目录错误

```bash
realpath /path/to/project
realpath /configured/workspace/root
```

确认：

- 输入绝对路径。
- 目录真实存在。
- 解析后仍位于 `WORKSPACE_ROOT`。
- 路径中的符号链接没有指向根目录外。
- systemd 服务用户可以读取该路径。

`ProtectHome=read-only` 不影响 app-server 修改工作区，因为修改由独立 app-server 进程执行；但网关仍需要读取目录元数据进行校验。

## 8. 手机能 ping，但页面打不开

这通常是 TCP 或防火墙问题，不是 ZeroTier 成员发现问题。

主机检查：

```bash
ip -br address
ss -ltnp 'sport = :8787'
curl http://<zerotier-ip>:8787/api/health
```

如果主机本地正常，再检查：

- 手机和主机是否在同一 ZeroTier Network ID。
- 两端是否 Authorized 和 ONLINE。
- ZeroTier flow rules 是否允许通信。
- Linux 防火墙是否只允许了其他接口。
- Windows Defender Firewall 是否有 TCP 8787 入站规则。
- mirrored WSL2 是否还受 Hyper-V 防火墙阻断。

不要通过绑定 `0.0.0.0` 解决。生产安全检查会拒绝，而且会扩大到 LAN 或公网接口。

## 9. WSL2 中启动时报 ZeroTier 地址未分配

错误类似：

```text
ZEROTIER_ADDRESS is not assigned to a local network interface.
```

说明地址存在于你的设计或 Windows 主机，但没有出现在 WSL2 的 `networkInterfaces()`。

检查：

```bash
ip -br address
```

处理方向：

- 启用并重启 WSL mirrored networking。
- 确认 ZeroTier Windows 服务正常。
- 或在 WSL2 内单独运行 ZeroTier。

不要伪造 `ZEROTIER_ADDRESS`，应用会按实时接口地址校验。

## 10. systemd 服务启动失败

```bash
systemctl --user status codex-remote-control --no-pager
journalctl --user -u codex-remote-control -n 200 --no-pager
systemd-analyze --user verify ~/.config/systemd/user/codex-remote-control.service
```

重点检查：

- `WorkingDirectory` 是否为实际仓库绝对路径。
- `ExecStart` 中 Node 是否存在。
- `EnvironmentFile` 是否存在且为当前用户可读。
- `WEB_DIST` 是否指向构建结果。
- `CODEX_BIN` 是否为绝对路径。
- 是否执行过 `npm run build`。
- unit 修改后是否 `daemon-reload`。

### 页面 404，但 `/api/health` 正常

静态目录不存在或 `WEB_DIST` 错误：

```bash
npm run build
test -f apps/web/dist/index.html
```

## 11. 图片无法发送

界面只接受：

- JPEG
- PNG
- WebP
- 单张不超过 10 MB
- 每次不超过 4 张

服务端还检查文件签名。常见问题：

- 手机保存的是 HEIC/AVIF。
- 文件扩展名是 `.jpg`，实际内容不是 JPEG。
- 图片为 0 字节。
- 图片超过 10 MB。
- Codex 版本不匹配，工作台只读。
- 选择后等待过久，附件已过期或服务重启后的临时路径不可用。

将 HEIC 转为 JPEG/PNG/WebP 后重试，不要只改文件名。

## 12. 审批抽屉消失或返回 409

可能原因：

- 另一个 Codex 客户端已处理。
- app-server 主动 resolved。
- daemon 断线导致所有 pending 请求失效。
- 页面已经成功提交过一次。

这是防重复执行行为。刷新会话状态，不要自动重试同一个 request ID。

## 13. “实时连接正在恢复”

浏览器 REST 可用但 WebSocket 未连接时显示该提示。浏览器会从 500 ms 开始指数退避，最长 10 秒。

检查浏览器开发者工具 Network 中 `/api/events`：

- `401`：Cookie 无效。
- `403`：Origin 不匹配。
- `1008 Unauthorized`：WebSocket upgrade 时未认证。
- TCP pending/failed：网络、防火墙或反向代理不支持 WebSocket。

服务重启或错过超过 500 条事件时，页面会自动 REST resync。若提示长期不消失，先修复 WebSocket，不要依赖频繁手工刷新。

## 14. 会话列表为空

确认：

- `codexConnected=true`。
- 搜索框为空。
- 状态筛选为全部。
- “已归档”开关符合预期。
- 当前系统用户与创建 Codex 会话的用户相同。

本项目没有独立会话数据库，不会显示其他用户或其他主机的 Codex 会话。

## 15. 收集诊断信息

可以安全收集：

```bash
codex --version
codex app-server daemon version
curl http://127.0.0.1:8787/api/health
systemctl --user status codex-remote-control --no-pager
journalctl --user -u codex-remote-control -n 200 --no-pager
ss -ltnp 'sport = :8787'
ip -br address
```

分享前仍需检查并删除：

- token、Cookie 和 Authorization
- 访问口令和 session secret
- `.env` 内容
- prompt、消息和审批答案
- 私有仓库路径或业务文件名
- ZeroTier Network ID（如不希望公开）

不要上传 `.dev-access-password`、真实环境文件或浏览器 Cookie 截图。
