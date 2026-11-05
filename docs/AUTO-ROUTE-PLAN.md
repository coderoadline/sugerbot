# 设计：Jev 难度路由（自动选模型 + 思考档位）

状态：**设计已定，代码未实现**。下一轮开工按本文执行。

## 目标

每次用户发新消息时，用已配置的 Jev（decider）判断任务难度，决定本次 turn 的
`modelSelection`（模型 + effort），不改变 bot 的长期默认值。

## 现有地基

| 组件 | 位置 | 说明 |
|---|---|---|
| decider | `server/decider/` | `choose(job, state, question, options)`，支持 jev / openrouter / workers-ai |
| decider 配置 | `config.decider`（`provider/baseUrl/model/key`） | 用户已在 MausBot 里配好 jev |
| effort | `ModelSelection.effort` | 驱动会传给 CLI（`--effort` / `model_reasoning_effort`） |
| turn 入口 | `server/index.ts` 解析 selection 后调用驱动 | 钩子位置 |

## 配置（写入 `~/.openmausbot/config.json`）

```jsonc
"autoRoute": {
  "enabled": true,
  "deciderTimeoutMs": 2000,
  "tiers": {
    "simple":  { "instanceId": "codex", "model": "workbuddy-local/hy4free",          "effort": "low" },
    "complex": { "instanceId": "codex", "model": "workbuddy-local/kimi-k3.1-pro",    "effort": "high" }
  }
}
```

- `instanceId/model` 必须存在于 `/api/instances`，否则回退；
- `effort` 必须被该引擎支持（`offersReasoning`/`levels`），否则降级到合法值；
- 缺省关闭；UI 后续再加。

## 流程

```
用户消息
  → 只在「用户新消息」时判（工具续跑、bot 内部续写不判）
  → decider.choose("autoRoute", {text}, "这条任务复杂度？", ["simple","complex"])
  → 超时/失败 → 用 bot 原 selection（fail-open，绝不阻塞）
  → 命中 tier → 合成本次 turn 的 selection（不改 bot 默认）
  → 记录：日志 + 可选在消息上打标（便于验证判得准不准）
```

## 实现清单

1. `server/auto-route.ts`：`routeSelection({ decider, tiers, text, fallback, instances })`，含超时与校验；
2. `server/index.ts`：turn 开始处调用，用返回值覆盖本次 selection；
3. `server/config.ts`：`autoRoute` schema（`z.optional`，向后兼容）；
4. 日志：`auto-route: tier=simple model=... effort=low (120ms)`；
5. 测试：`server/auto-route.test.ts`（decider 超时 → fallback；未知模型 → fallback；正常 → 覆盖）；
6. 验收：真实发一条"帮我重构整个模块"（应走 complex）和一条"现在几点"（应走 simple），看日志与耗时。

## 风险

- 判错代价：**保守策略** —— 只允许"明显简单"降到低档，其余保持原档；
- 延迟：默认 2s 超时，超时直接用原档；
- 与 bot 默认值的关系：只影响本次 turn，不改 bot 默认（避免"为什么我的模型自己变了"）。

## 建议提交节奏

```
feat(auto-route): config schema + routeSelection + tests
feat(auto-route): hook turn start
feat(auto-route): log chosen tier
docs(auto-route): usage + tuning notes
```
