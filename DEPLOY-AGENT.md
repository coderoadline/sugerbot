# 部署手册（给下一个 Agent）

目标：在一台新的 Debian 13 机器上，把 OpenMausBot 复刻成"Codex / Claude / DeepSeek 三个 CLI 全部走 Magpie 本地网关、免登录、OMB 前端能识别 Magpie 配置的模型"的状态。

参考现网：`https://sugerbot.metisai.dpdns.org`（OMB）、`https://magpie.metisai.dpdns.org`（Magpie）。

## 0. 端口与目录

| 组件 | 位置 |
|---|---|
| OMB 本体 | `127.0.0.1:18799`（webhook `18800`） |
| Caddy（压缩/分流/面板 BasicAuth） | `127.0.0.1:18798`（只绑回环） |
| Magpie 网页 | `127.0.0.1:18796` |
| Magpie 网关（CLI 指向它） | `127.0.0.1:3425` |
| OMB 数据 | `$HOME/.openmausbot`（`/data/home/.openmausbot`） |
| Magpie 数据 | `$HOME/.local/state/magpie`、`$HOME/.local/opt/magpie` |

## 1. 基础环境

```sh
# Debian 13，Node 24 装在 /opt/node24，加到 PATH
# 8GB 机器必须有 swap，否则构建会被 OOM 杀掉（本项目构建峰值 4-6GB）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. 安装并构建 OMB（源码版）

```sh
git clone https://github.com/milind-soni/OpenMausBot.git ~/omb && cd ~/omb
git checkout <本次提交的分支/commit>      # 含下面的适配补丁
pnpm install
NODE_OPTIONS=--max-old-space-size=6144 pnpm build          # 前端
NODE_OPTIONS=--max-old-space-size=4096 pnpm build:server   # 服务端
sudo npm i -g --prefix ~/.local   # 不需要；用仓库内 CLI：
cat > ~/.local/bin/omb-src <<'EOF'
#!/bin/sh
exec /opt/node24/bin/node /path/to/omb/dist-server/openmausbot.js "$@"
EOF
chmod +x ~/.local/bin/omb-src
```

## 3. systemd：OMB

`/etc/systemd/system/openmausbot.service`

```ini
[Unit]
Description=OpenMausBot
After=network-online.target

[Service]
User=<运行用户>
Environment=HOME=/data/home
Environment=OMB_PORT=18799
Environment=OMB_WEBHOOK_PORT=18800
Environment=OMB_PUBLIC_URL=https://sugerbot.<你的域名>
Environment=OMB_JEV_MODEL=openjev-latest
Environment=PATH=/opt/node24/bin:/data/home/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/data/home/.local/bin/omb-src serve --public-url https://sugerbot.<你的域名> --no-pair --port 18799
Restart=always

[Install]
WantedBy=multi-user.target
```

## 4. Caddy（`/etc/caddy/Caddyfile`）

```caddyfile
{
  auto_https off
  admin off
}

:18798 {
  bind 127.0.0.1
  handle /gateway-admin/* {
    basicauth { admin <bcrypt-hash> }
    uri strip_prefix /gateway-admin
    reverse_proxy 127.0.0.1:18797
  }
  handle /sw.js {
    reverse_proxy 127.0.0.1:18799
    header Cache-Control "no-cache"
  }
  handle /api/events* {
    reverse_proxy 127.0.0.1:18799 { flush_interval -1 }
  }
  handle /api/* {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18799 {
      header_up X-Forwarded-Proto https
      header_up X-Forwarded-Host {header.X-Forwarded-Host}
      flush_interval -1
    }
  }
  handle {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18799 {
      header_up X-Forwarded-Proto https
      header_up X-Forwarded-Host {header.X-Forwarded-Host}
      flush_interval -1
    }
  }
}
```

要点：
- **不要**写死 `header_up Host`，要让 OMB 靠 `X-Forwarded-Host` 判断同源（见补丁清单）；
- `/api/*` 压缩，但 `/api/events`（SSE）不压缩、不缓冲；
- Caddy 只绑回环，外网只通过隧道进来。

## 5. Cloudflare Tunnel（无公网 IP 的关键）

```sh
cloudflared tunnel login                       # 浏览器授权 zone
cloudflared tunnel create omb
cloudflared tunnel route dns omb sugerbot.<域名>
cloudflared tunnel route dns omb magpie.<域名>
```

`/etc/cloudflared/config.yml`

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: sugerbot.<域名>
    service: http://127.0.0.1:18798      # 经 Caddy
  - hostname: magpie.<域名>
    service: http://127.0.0.1:18796      # 直连 Magpie
  - service: http_status:404
```

```sh
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

## 6. Magpie（让三个 CLI 免登录、统一走本地网关）

```sh
curl -L -o magpie https://usemagpie.ai/download/linux-amd64 && chmod +x magpie
sudo apt-get install -y libwebkit2gtk-4.1-0 libsoup-3.0-0     # Tauri 运行时
sudo install -m 755 magpie /data/home/.local/opt/magpie/magpie
```

**dsh 必须能被 Magpie 发现**（否则 DeepSeek 显示 "CLI not found"）：

```sh
cat > ~/.local/bin/dsh <<'EOF'
#!/bin/sh
exec /opt/node24/bin/node /data/home/.openmausbot/tools/npm/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"
EOF
chmod +x ~/.local/bin/dsh
```

`/etc/systemd/system/magpie.service`

```ini
[Service]
User=<用户>
Environment=HOME=/data/home
Environment=MAGPIE_WEB_KEY=<32位随机串>          # 固定登录 key，链接 ?k=...
Environment=MAGPIE_WEB_URL=https://magpie.<域名>
Environment=PATH=/data/home/.openmausbot/tools/npm/bin:/opt/node24/bin:/data/home/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/data/home/.local/opt/magpie/magpie web --addr 127.0.0.1:18796 --no-open
Restart=always
```

Magpie 会写：
- `~/.codex/config.toml`（`model_provider = "magpie"`、`model_catalog_json`、`openai_base_url` 指向 3425）
- `~/.claude/settings.json`（`modelPicker.options`、`model`、`env.ANTHROPIC_BASE_URL`）
- `~/.dsh/profiles/acp/cordis.patch.yml`（`magpie` provider）

## 7. OMB 源码适配清单（复刻必须）

| 文件 | 改了什么 / 为什么 |
|---|---|
| `server/request-auth.ts` | `requestOrigin` 优先读 `X-Forwarded-Host`：隧道会把 Host 改写成 127.0.0.1，不认这个头就全站 403 |
| `server/drivers/codex.ts` | ① 托管网关用 key 认证；② config.toml 指向回环网关时视为已登录；③ **发起 turn 的登录闸门**同样跳过（否则"Codex isn't signed in"） |
| `server/drivers/codex-catalog.ts` | 裸模型名只有 `gpt-/o1..o9/codex` 才算官方，其余回落到 CLI 配置的 provider（否则 "chat uses openai but current provider is magpie"） |
| `server/drivers/claude.ts` | 同上：`settings.json` 的 `ANTHROPIC_BASE_URL` 是回环即视为已认证；支持 `managedProvider` |
| `server/drivers/claude-model-extras.ts` | 解析 `modelPicker.options` 与 `model`，作为一等模型（`custom: false`），否则 Magpie 的模型不显示 |
| `server/routes/config.ts` | `/api/gateway-models` 支持 `providerId`（服务端读 secrets 里的 key）；`/api/dsh-provider` 写 dsh provider 表 |
| `server/routes/threads.ts` | 附件与消息图片返回 `private, max-age=604800, immutable`（原本 no-store，每次重下） |
| `server/index.ts` | bot 列表里的消息走 `pageMessage`（裁剪工具输出、去掉截图 base64） |
| `server/config.ts` | `instances` 允许增量 patch、允许 null 删除；decider 增加 `jevModel` |
| `src/components/ModelPicker.tsx` / `ModelPickerFull.tsx` | 同一驱动的多个网关实例折叠成一个引擎；模型行显示 provider 后缀 |
| `src/components/ScreenFrame.tsx` / `AttachmentPreview.tsx` | 图片懒加载 + IndexedDB 缓存（`src/lib/media-cache.ts`） |
| `src/components/DecisionModelSettings.tsx` | 决策模型可配 Base URL + 模型 |
| `public/sw.js` + `src/main.tsx` | 媒体缓存 Service Worker（在 CF 后面可不用，保留无害） |
| `server/routes/providers.ts` | 早期的 provider 注册表 API（现在 UI 已撤，接口保留但未使用） |

## 8. 已知坑（照做可避免）

1. **dsh 拒绝 `.env` 里的 `apiKeyEnv` 变量**：`~/.dsh/.env` 中不能有 `DSH_KEY_*`，密钥要放进 OMB 的 `deepseek` 实例 `environment`。否则 dsh 直接不启动，provider 不出现。
2. **dsh 必须在 PATH 里**，否则 Magpie 看不到 DeepSeek（见上面的 wrapper）。
3. **OMB 缓存模型目录**：Magpie 改完要刷新 —— 模型菜单的 ⟳，或 `POST /api/instances/<id>/refresh-models`。
4. **InstaBox 端口发布会把所有响应改成 `cache-control: no-store`**，浏览器缓存与 Service Worker 全失效；必须用 Cloudflare Tunnel（我们的缓存头才能生效）。
5. **构建内存**：8GB 机器务必 `--max-old-space-size=6144`，并先加 swap；否则 OOM 可能把整机打停。
6. **Codex 的 clientInfo 被 OMB 写成 `openmausbot`**，Magpie 面板里 Codex 会显示成 openmausbot 而不是 Codex（只影响可观测性，不影响路由）。

## 9. 验收清单

```sh
curl -s https://sugerbot.<域名>/api/health                 # {"app":"openmausbot"}
curl -s http://127.0.0.1:18799/api/instances | jq '.instances[] | select(.instanceId=="claude") | {auth: .snapshot.authenticated, n: (.models.options|length)}'
# 期望：codex / claude auth=true，且模型列表里能看到 magpie 的模型（workbuddy-local/...）
magpie ls                                                   # 三个 agent 都被识别
```

最后一步（必须）：**在 OMB 里真实发一条消息**，确认能跑通 —— 只看接口返回不算验收。
