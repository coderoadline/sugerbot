# 交接文档：这个 fork 怎么维护、怎么跟上游合并

面向对象：以后接手这个仓库的 agent。
前提：你已经有 `DEPLOY-AGENT.md`（从零部署手册），这份文档讲**维护**。

---

## 1. 仓库与分支结构

| | |
|---|---|
| 上游 | `https://github.com/milind-soni/OpenMausBot.git`（remote 名 `origin`） |
| 我们的 fork | `https://github.com/coderoadline/sugerbot.git`（remote 名 `sugerbot`） |
| 工作分支 | `omb-magpie-setup` |
| 我们的提交 | `2ef35e0` 代码适配 · `d52c7aa` 部署手册 |
| fork 的 main | 未动过，仍是上游快照 `7117517` |

**规则：所有改动只进 `omb-magpie-setup`，不要直接改 `main`。**

## 2. 本 fork 的改动清单（都是"适配"，不是新功能）

| 文件 | 改了什么 | 上游冲突风险 |
|---|---|---|
| `server/request-auth.ts` | `requestOrigin` 优先取 `X-Forwarded-Host`（隧道会改 Host） | 中 |
| `server/drivers/codex.ts` | 托管网关用 key 认证；config 指向回环网关视为已登录；**发起 turn 的登录闸门**同样放行 | **高**（上游常改这个文件） |
| `server/drivers/codex-catalog.ts` | 裸模型名只有 `gpt-/o1..o9/codex` 算官方，其余回落 CLI 配置的 provider | 中 |
| `server/drivers/claude.ts` | `ANTHROPIC_BASE_URL` 为回环即视为已认证；支持 `managedProvider` | 中 |
| `server/drivers/claude-model-extras.ts` | 解析 Magpie 写的 `modelPicker.options` / `model`，作为一等模型 | 低 |
| `server/routes/config.ts` | `/api/gateway-models` 支持 `providerId`（服务端读密钥）；`/api/dsh-provider` | 中 |
| `server/routes/threads.ts` | 图片/附件返回 `private, max-age=604800, immutable`（原本 no-store） | 低 |
| `server/index.ts` | bot 列表消息走 `pageMessage`（裁工具输出、去截图 base64） | **高**（巨型文件） |
| `server/config.ts` | instances 增量 patch / null 删除；decider `jevModel` | 中 |
| `src/components/ModelPicker*.tsx` | 同驱动多实例折叠成一个引擎；模型行显示 provider | 中 |
| `src/components/ScreenFrame.tsx`、`AttachmentPreview.tsx`、`src/lib/media-cache.ts` | 图片懒加载 + IndexedDB 缓存 | 低 |
| `src/components/DecisionModelSettings.tsx` | 决策模型可配 Base URL + 模型 | 低 |
| `public/sw.js` + `src/main.tsx` | 媒体缓存 Service Worker（CF 后面可不用，保留无害） | — |
| `server/routes/providers.ts` | 早期 provider 注册表 API，**UI 已撤，接口保留未用** | — |

> 判断标准：凡是"让 OMB 认本地网关 / 认 Magpie 写的配置"的改动，都属于**必要适配**，合并时不能被上游冲掉。

## 3. 跟上游合并（官方发新版本时）

```sh
cd <repo>
git remote add upstream https://github.com/milind-soni/OpenMausBot.git   # 只需一次
git fetch upstream
git checkout omb-magpie-setup
git merge upstream/main          # 或 git rebase upstream/main，二选一
```

**冲突热点（按经验排序）**：`server/index.ts` → `drivers/codex.ts` → `drivers/claude.ts` → `routes/config.ts` → `ModelPicker.tsx`。

解决冲突的原则：
1. **上游的结构优先**（函数签名、类型、调用方式照上游）；
2. 把我们那几行适配**移植到新结构里**（通常是 1–5 行：读 `X-Forwarded-Host`、回环网关判定、provider 回落、缓存头）；
3. 每一处改完都做**第 5 节的验收**，不要一次性改完再验。

合并后必须重新构建：

```sh
NODE_OPTIONS=--max-old-space-size=6144 pnpm build          # 前端（8GB 机器必须先有 swap）
NODE_OPTIONS=--max-old-space-size=4096 pnpm build:server
sudo systemctl restart openmausbot
```

## 4. 二次开发约定

- **新功能**尽量放新文件（如 `server/routes/xxx.ts` + `ROUTES.push(...)`），少改上游大文件，降低下次合并成本；
- 改上游文件时，**在提交信息里写明"为什么必须改"**，方便下次合并识别；
- 不要改 `server/config.ts` 的 schema 结构去存业务数据 —— 用独立 JSON（如 `~/.openmausbot/providers.json`）更安全；
- 前端新组件放 `src/components/`，样式复用现有 `FIELD/QUIET` 等常量，别引新依赖。

## 5. 验收清单（每次改动/每次合并后都要跑）

```sh
systemctl is-active openmausbot caddy cloudflared magpie     # 四个都要 active
curl -s http://127.0.0.1:18799/api/health                     # {"app":"openmausbot"}
curl -s http://127.0.0.1:18799/api/instances | jq '.instances[]
  | select(.instanceId|IN("codex","claude","deepseek"))
  | {id: .instanceId, auth: .snapshot.authenticated, n: (.models.options|length)}'
# 期望：三个都 auth=true，且能列出 magpie/workbuddy-local 的模型
magpie ls                                                     # 三个 agent 都被识别
```

**最后一步是硬性要求：在 OMB 里真实给某个 bot 发一条消息，确认能跑通。**
（历史上多次出现"接口看起来对、真发消息报错"的情况：provider 不匹配、缓存未刷新、dsh 未启动。）

## 6. 运行时环境不在仓库里（必须单独备份）

| 项 | 路径 | 说明 |
|---|---|---|
| OMB 数据 | `~/.openmausbot` | bots、会话、`config.json`、密钥 |
| OMB CLI 工具 | `~/.openmausbot/tools/npm` | codex/claude/dsh 等 |
| Magpie | `~/.local/opt/magpie`、`~/.local/state/magpie` | 二进制 + 状态 |
| Magpie 写出的 CLI 配置 | `~/.codex/config.toml`、`~/.claude/settings.json`、`~/.dsh/profiles/acp/cordis.patch.yml` | 换 MAGPIE_WEB_KEY 会重写 |
| 服务单元 | `/etc/systemd/system/{openmausbot,caddy,cloudflared,magpie}.service` | 含环境变量 |
| Caddy | `/etc/caddy/Caddyfile` | |
| 隧道 | `/etc/cloudflared/config.yml`、`~/.cloudflared/` | |

## 7. 排错手册（按报错找原因）

| 现象 | 原因 | 处置 |
|---|---|---|
| 全站 403 `cross-origin request` | 隧道改了 Host，OMB 算错同源 | 确认 Caddy 传 `X-Forwarded-Host`、`request-auth.ts` 优先读它 |
| Codex 显示"需要登录" | 没识别本地网关 | 看 `~/.codex/config.toml` 是否有回环 `base_url`；确认 codex 驱动的两处判定都在 |
| `This chat uses openai, but your current provider is magpie` | 裸模型名被判成官方 | `codex-catalog.ts` 的 `officialSlug` 判定 |
| Magpie 里 Claude/Codex 模型不显示 | OMB 缓存 / 没解析 Magpie 字段 | 点 ⟳ 刷新；确认 `claude-model-extras.ts` 解析 `modelPicker.options` |
| DeepSeek 不显示 provider | dsh 没启动（`.env` 里有 `DSH_KEY_*`）或不在 PATH | 清 `.env` 的 `DSH_KEY_*`；`~/.local/bin/dsh` wrapper |
| 图片每次重下 | 缓存头被上游或隧道改回 `no-store` | 检查 `threads.ts` 与入口（Cloudflare 必须） |
| 构建把机器搞停 | 内存不足 | 先加 swap，`--max-old-space-size=6144` |

## 8. 安全

- `gh` 授权（`repo`+`workflow`）等于**这台机器上的任何进程都能读写你所有仓库**；不用时 `gh auth logout` 并撤销；
- OMB 的 bot 以**同一个系统用户**运行 → bot 能被读取的东西 = 你能被读取的东西（包括密钥）；
- 敏感配置放在 `~/.openmausbot/secrets/`（0600），不要写进仓库。

## 9. 一句话交接

> 这个 fork 的全部价值是：**让 OMB 认 Magpie/本地网关写的配置**（8 处必要适配）。
> 合并上游时保住这 8 处、按第 5 节验收、真实发一条消息 —— 其余都可以按上游来。
