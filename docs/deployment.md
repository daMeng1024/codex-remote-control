# ZeroTier 与 systemd 部署

本文面向个人单用户部署。推荐拓扑是：Codex、managed app-server 和网关运行在同一台 Linux/WSL2 主机，手机与主机通过同一个 ZeroTier 网络通信。

## 1. 安全拓扑

```text
手机浏览器
  -> ZeroTier 私网 TCP 8787
  -> Fastify 网关
  -> WebSocket over Unix Domain Socket
  -> managed codex app-server
```

传输层由 ZeroTier 私网负责，应用层由访问口令和 12 小时 Cookie负责。当前版本不终止公网 TLS，不应直接绑定公网地址。

## 2. 主机准备

确认源码、依赖、Codex 和 app-server：

```bash
git clone https://github.com/daMeng1024/codex-remote-control.git
cd codex-remote-control
npm ci
npm run build
codex --version
codex app-server daemon version
```

必须满足：

- Codex 版本与应用支持版本精确一致。
- daemon 状态为 `running`。
- systemd 服务与 managed app-server 属于同一个 Linux 用户。
- 该用户能读取 app-server UDS。

## 3. ZeroTier 地址

主机和手机加入同一个 ZeroTier 网络并在控制台授权后，确认主机地址：

```bash
ip -br address
```

选择明确属于 ZeroTier 网络的地址，例如文档中的 `<zerotier-ip>`。不要使用：

- `0.0.0.0`
- `::`
- 普通 Wi-Fi/LAN 地址
- 公网地址
- 只存在于 Windows、但没有映射到 WSL2 接口的地址

从手机的 ZeroTier 客户端确认：

- 网络状态为 ONLINE/OK。
- Managed IP 已分配。
- 主机和手机使用同一个 Network ID。
- 控制台中两个成员都已 Authorized。

## 4. WSL2 网络模式

如果服务运行在 WSL2，而 ZeroTier 运行在 Windows，推荐使用 WSL mirrored networking，使 ZeroTier 地址出现在 WSL2 网络接口中。

Windows 用户目录的 `.wslconfig` 示例：

```ini
[wsl2]
networkingMode=mirrored
firewall=true
```

修改后在 PowerShell 执行：

```powershell
wsl --shutdown
```

重新进入 WSL2，再运行 `ip -br address`。应用生产安全检查要求 `ZEROTIER_ADDRESS` 确实属于 WSL2 当前接口；如果地址只存在于 Windows，网关会拒绝启动。

另一种方案是在 WSL2 内运行 ZeroTier，但服务归属、开机启动和路由都需要由部署者单独维护，本文不自动安装 ZeroTier。

## 5. 生产环境文件

创建目录并从模板开始：

```bash
install -d -m 700 ~/.config/codex-remote-control
cp deploy/systemd/env.example ~/.config/codex-remote-control/env
chmod 600 ~/.config/codex-remote-control/env
```

编辑文件并替换全部机器相关值：

- `REMOTE_PASSWORD_HASH`
- `SESSION_SECRET`
- `BIND_HOST`
- `ZEROTIER_ADDRESS`
- `ALLOWED_ORIGINS`
- `WORKSPACE_ROOT`
- `CODEX_BIN`
- `WEB_DIST`

`BIND_HOST` 与 `ZEROTIER_ADDRESS` 必须是同一个 ZeroTier IP。`ALLOWED_ORIGINS` 通常是：

```dotenv
ALLOWED_ORIGINS=http://<zerotier-ip>:8787
```

完整说明见[配置参考](configuration.md)。

## 6. 安装 systemd 用户服务

模板包含示例工作目录，复制后必须按实际克隆路径修改：

```bash
install -d ~/.config/systemd/user
cp deploy/systemd/codex-remote-control.service \
  ~/.config/systemd/user/codex-remote-control.service
```

至少检查：

```ini
WorkingDirectory=/absolute/path/to/codex-remote-control
ExecStart=/usr/bin/node apps/server/dist/index.js
EnvironmentFile=%h/.config/codex-remote-control/env
```

确认 Node 路径：

```bash
command -v node
```

如果不是 `/usr/bin/node`，修改 `ExecStart` 的第一个参数。

模板的保护项：

- `UMask=0077`
- `NoNewPrivileges=true`
- `PrivateTmp=true`
- `ProtectSystem=strict`
- `ProtectHome=read-only`
- 仅允许 `AF_UNIX`、`AF_INET`、`AF_INET6`

这些设置允许网关读取源码、静态文件、Codex socket 和工作区路径，但服务自身不能任意写入 home。图片写入服务私有的临时目录；真正的代码变更由独立 managed app-server 进程执行。

加载和启动：

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-remote-control
systemctl --user status codex-remote-control --no-pager
```

需要退出登录后仍运行用户服务时，由系统管理员评估并执行：

```bash
loginctl enable-linger "$USER"
```

安装、enable、start 和 linger 都是主机运维动作，源码构建不会自动执行它们。

## 7. 防火墙

只允许 ZeroTier 接口或 ZeroTier 子网访问 TCP 8787。不要为所有来源开放端口。

### Linux 防火墙示例

使用 UFW 时，先找出 ZeroTier 接口名和网段，再由管理员执行类似规则：

```bash
sudo ufw allow in on <zerotier-interface> proto tcp to any port 8787
sudo ufw status numbered
```

### WSL2 与 Windows 防火墙

mirrored networking 下可能同时受两层策略影响：

1. Windows Defender Firewall 经典入站规则。
2. WSL2/Hyper-V 防火墙规则。

管理员 PowerShell 中可先检查：

```powershell
Get-NetFirewallRule | Where-Object DisplayName -Like '*Codex Remote*'
Get-NetFirewallHyperVVMCreator
Get-NetFirewallHyperVRule -VMCreatorId '<wsl-creator-id>'
```

经典规则应将 `RemoteAddress` 限制为 ZeroTier 子网：

```powershell
New-NetFirewallRule `
  -DisplayName 'Codex Remote Control - ZeroTier' `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 8787 -RemoteAddress '<zerotier-subnet>'
```

支持 Hyper-V 防火墙 cmdlet 的系统还需要对应 WSL creator 的入站规则。具体参数随 Windows 版本变化，应先读取 `Get-Help New-NetFirewallHyperVRule -Full`，并同样限制端口和 ZeroTier 来源。

## 8. 分层验证

### 主机本地

```bash
curl http://<zerotier-ip>:8787/api/health
ss -ltnp 'sport = :8787'
```

预期：

- `ok=true`
- `codexConnected=true`
- `ss` 只显示具体 ZeroTier IP，不是 `0.0.0.0`

### ZeroTier 客户端

从另一台已加入网络的设备检查：

```bash
curl http://<zerotier-ip>:8787/api/health
```

然后用手机浏览器打开：

```text
http://<zerotier-ip>:8787
```

如果 ping 通但 TCP 8787 不通，优先检查 Windows 经典防火墙和 Hyper-V 防火墙，而不是修改应用监听为 `0.0.0.0`。

## 9. 日志和服务控制

```bash
systemctl --user status codex-remote-control --no-pager
journalctl --user -u codex-remote-control -n 200 --no-pager
journalctl --user -u codex-remote-control -f
systemctl --user restart codex-remote-control
systemctl --user stop codex-remote-control
```

日志会脱敏 Cookie、密码、prompt、消息和审批答案，但运维人员仍应限制 journal 访问。

## 10. 升级

记录当前提交后再升级：

```bash
git rev-parse HEAD
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run build
systemctl --user restart codex-remote-control
```

升级后检查：

```bash
curl http://<zerotier-ip>:8787/api/health
journalctl --user -u codex-remote-control -n 100 --no-pager
```

如果 Codex CLI 同时升级，必须重新生成协议并完成验证，见[开发与验证](development.md)。

## 11. 回滚

回滚前确认旧提交与当前 Codex CLI 版本兼容：

```bash
git switch --detach <known-good-commit>
npm ci
npm run build
systemctl --user restart codex-remote-control
```

源码回滚不会还原 Codex 会话，因为 Codex 是会话事实源；也不会恢复已过期的临时图片。

## 12. 公网部署边界

当前实现没有：

- 自动 TLS 证书
- 可信代理和客户端 IP 配置
- 多用户权限
- 密码找回
- 审计日志持久化
- 入侵检测

因此不要通过路由器端口映射、云安全组或公网 IP 直接开放 8787。需要公网访问时，应先单独设计 HTTPS、反向代理、可信代理 IP、强身份验证和审计保留策略。
