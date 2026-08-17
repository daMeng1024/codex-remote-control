# 配置参考

网关启动时先加载仓库根目录 `.env`，再由进程环境覆盖同名变量。开发模式通常使用 `.env`；systemd 部署使用 `EnvironmentFile`。

## 环境变量

| 变量                   | 必填               | 默认值                   | 说明                                        |
| ---------------------- | ------------------ | ------------------------ | ------------------------------------------- |
| `NODE_ENV`             | 否                 | `development`            | `development`、`test` 或 `production`       |
| `REMOTE_PASSWORD_HASH` | 是                 | 无                       | scrypt 编码后的访问口令，最少 20 字符       |
| `SESSION_SECRET`       | 是                 | 无                       | HMAC session secret，最少 32 字符           |
| `BIND_HOST`            | 否                 | `127.0.0.1`              | Fastify 监听地址                            |
| `PORT`                 | 否                 | `8787`                   | 1 到 65535 的 TCP 端口                      |
| `ALLOWED_ORIGINS`      | 否                 | 两个本地开发 Origin      | 逗号分隔的精确 Origin 白名单                |
| `WORKSPACE_ROOT`       | 否                 | 当前项目约定的代码根目录 | 新会话允许使用的唯一目录树                  |
| `COOKIE_SECURE`        | 否                 | `false`                  | 是否给 session Cookie 添加 Secure 属性      |
| `CODEX_BIN`            | 否                 | 当前用户的 Codex 路径    | 用于执行 daemon version 的 Codex 可执行文件 |
| `ZEROTIER_ADDRESS`     | 生产非回环监听时是 | 无                       | 必须与 `BIND_HOST` 完全一致                 |
| `WEB_DIST`             | 否                 | `apps/web/dist`          | 生产静态页面目录                            |

未知变量不会改变应用行为。

## 开发环境

推荐通过脚本生成：

```bash
npm run setup:env
```

生成的配置只绑定回环地址，适合本机开发。脚本会随机生成 32 字节访问口令和 48 字节 session secret，并以 `0600` 创建 `.env` 和 `.dev-access-password`。

`.env.example` 只包含占位值，不能直接用于运行。

## 生产环境示例

下面仅展示结构。所有尖括号值都必须替换，不能原样使用：

```dotenv
REMOTE_PASSWORD_HASH=scrypt$16384$8$1$<salt>$<derived-key>
SESSION_SECRET=<at-least-32-random-characters>
NODE_ENV=production
BIND_HOST=<zerotier-ip>
ZEROTIER_ADDRESS=<same-zerotier-ip>
PORT=8787
ALLOWED_ORIGINS=http://<zerotier-ip>:8787
WORKSPACE_ROOT=/home/<user>/code
COOKIE_SECURE=false
CODEX_BIN=/home/<user>/.local/bin/codex
WEB_DIST=/home/<user>/src/codex-remote-control/apps/web/dist
```

环境文件权限：

```bash
chmod 600 ~/.config/codex-remote-control/env
```

## 访问口令

生成哈希：

```bash
npm run password:hash -w @codex-remote/server -- "your-long-random-password"
```

编码格式：

```text
scrypt$N$r$p$salt$derivedKey
```

当前生成参数：

- `N=16384`
- `r=8`
- `p=1`
- 派生密钥 64 字节
- salt 16 字节

登录使用 timing-safe 比较。服务端不保存访问口令明文。

建议：

- 使用密码管理器生成至少 24 个随机字符。
- 不要复用 GitHub、Codex 或操作系统密码。
- 不要把明文写入 systemd unit、shell history 或 URL。
- 怀疑泄露时同时轮换访问口令和 session secret。

## Session secret 与 Cookie

`SESSION_SECRET` 用于 HMAC 签名，无需与访问口令相同。更换它会立即使所有现有登录 Cookie 失效。

Cookie 属性：

- 名称：`codex_remote_session`
- 有效期：12 小时
- `HttpOnly`
- `SameSite=Strict`
- Path `/`
- `Secure` 由 `COOKIE_SECURE` 控制

通过 ZeroTier 直接使用 HTTP 时，`COOKIE_SECURE=false`。只有浏览器实际通过 HTTPS 访问时才能设置为 `true`，否则浏览器不会发送 Cookie。

## Origin 白名单

`ALLOWED_ORIGINS` 使用逗号分隔，逐项精确匹配浏览器 `Origin`：

```dotenv
ALLOWED_ORIGINS=http://10.10.10.20:8787,https://codex.example.internal
```

注意：

- 必须包含 scheme、host 和非默认端口。
- 不要添加路径或末尾 `/`。
- `http://127.0.0.1:5173` 与 `http://localhost:5173` 是不同 Origin。
- 所有非 GET/HEAD API 和 WebSocket upgrade 都必须携带受信任 Origin。
- 不要为了消除 403 而使用通配符；代码不支持也不需要通配符。

## 监听地址安全检查

`NODE_ENV=production` 时：

- `127.0.0.1` 和 `::1` 可直接使用。
- 非回环地址必须是具体 IP，不能是主机名。
- 拒绝 `0.0.0.0` 和 `::`。
- `BIND_HOST` 必须等于 `ZEROTIER_ADDRESS`。
- `ZEROTIER_ADDRESS` 必须实际分配到当前系统的网络接口。

该检查防止服务因错误配置同时暴露到局域网或公网接口。

## 工作区根目录

`WORKSPACE_ROOT` 控制新会话可以使用的目录树。新建会话时同时检查：

1. 输入是绝对路径。
2. 路径真实存在。
3. 目标是目录。
4. 根目录和目标都经过 `realpath`。
5. 解析后的目标仍位于解析后的根目录内。

因此路径穿越和指向根目录外的符号链接都会被拒绝。

该设置不改变 managed app-server 自身的沙箱策略。Codex 最终可执行的操作仍受所选 permission profile 和审批结果约束。

## Codex 可执行文件

systemd 用户服务的 PATH 通常比交互式 shell 更短，建议给 `CODEX_BIN` 配置绝对路径：

```bash
command -v codex
```

将输出路径写入环境文件。服务用户还必须能读取 Codex managed app-server 的控制 socket。

## 静态页面目录

执行 `npm run build` 后，Vite 输出到 `apps/web/dist`。默认情况下网关会自动读取该目录。

systemd 从其他工作目录启动或使用自定义发布目录时，设置绝对 `WEB_DIST`。目录不存在时 API 仍可能启动，但页面不会被 Fastify 提供。

## 配置变更生效

开发服务需要重启。systemd 用户服务执行：

```bash
systemctl --user restart codex-remote-control
journalctl --user -u codex-remote-control -n 100 --no-pager
```

修改 unit 文件后还需要：

```bash
systemctl --user daemon-reload
systemctl --user restart codex-remote-control
```
