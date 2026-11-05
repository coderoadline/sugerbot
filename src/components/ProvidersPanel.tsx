import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";

interface ProviderModel { id: string; label?: string; contextWindow?: number }
interface Provider { id: string; name: string; baseUrl: string; defaultProtocol: string; models: ProviderModel[]; hasKey?: boolean; apiKey?: string }
interface Binding { providerId: string; protocol: string; models: string[] }
interface Registry { providers: Provider[]; bindings: Record<string, Binding[]>; cliProtocols: Record<string, string[]> }

const CLI_LABEL: Record<string, string> = { codex: "Codex", claude: "Claude", deepseek: "DeepSeek Harness" };
const PROTOCOL_LABEL: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};
const FIELD = "w-full rounded-lg border border-hairline/40 bg-control/30 px-2 py-1 text-[13px] text-ink";
const ROW_INPUT = "min-w-0 flex-1 rounded-lg border border-hairline/40 bg-control/30 px-2 py-1 text-[13px] text-ink";
const ROW_PAIR = "w-20 shrink-0 rounded-lg border border-hairline/40 bg-control/30 px-2 py-1 text-[13px] text-ink";
const QUIET = "rounded-md border border-hairline/40 px-2 py-0.5 text-[12px] text-ink-secondary hover:text-ink";
const emptyProvider = (): Provider => ({ id: "", name: "", baseUrl: "", defaultProtocol: "openai-completions", models: [] });
const bindingOf = (bindings: Record<string, Binding[]>, cli: string, providerId: string): Binding | undefined =>
  (bindings[cli] ?? []).find((binding) => binding.providerId === providerId);

export function ProvidersPanel() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await api<Registry>("/api/providers");
    setRegistry(next);
    setProviders(next.providers);
    setBindings(next.bindings ?? {});
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [load]);

  const patch = (id: string, change: Partial<Provider>) =>
    setProviders((current) => current.map((provider) => (provider.id === id ? { ...provider, ...change } : provider)));

  const setBinding = (cli: string, providerId: string, change: Partial<Binding> | null) =>
    setBindings((current) => {
      const rows = current[cli] ?? [];
      const existing = rows.find((row) => row.providerId === providerId);
      if (change === null) return { ...current, [cli]: rows.filter((row) => row.providerId !== providerId) };
      if (existing) return { ...current, [cli]: rows.map((row) => (row.providerId === providerId ? { ...row, ...change } : row)) };
      const provider = providers.find((candidate) => candidate.id === providerId);
      return { ...current, [cli]: [...rows, { providerId, protocol: registry?.cliProtocols[cli]?.[0] ?? "openai-completions", models: provider?.models.map((model) => model.id) ?? [], ...change }] };
    });

  const save = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      await api("/api/providers", { method: "PUT", body: JSON.stringify({ providers, bindings }) });
      await load();
      setNote(t("providers.saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async (provider: Provider) => {
    setError(null);
    try {
      const key = provider.apiKey ?? "";
      const result = await api<{ models: ProviderModel[] }>("/api/gateway-models?url=" + encodeURIComponent(provider.baseUrl) + "&providerId=" + encodeURIComponent(provider.id) + (key ? "&key=" + encodeURIComponent(key) : ""));
      patch(provider.id, { models: result.models });
      setNote(t("providers.fetched", { count: result.models.length }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const editing = providers.find((provider) => provider.id === openId);
  return (
    <div className="mx-4 rounded-xl border border-hairline/40 bg-card p-4" data-testid="providers-panel">
      <h2 className="text-[15px] font-medium text-ink">{t("providers.title")}</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("providers.subtitle")}</p>

      <ul className="mt-3 space-y-1">
        {providers.map((provider) => (
          <li key={provider.id} className="flex items-center justify-between gap-2 rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink">
            <span className="min-w-0 truncate">
              {provider.name || provider.id}
              <span className="ml-2 text-[11px] text-ink-secondary">{provider.models.length} 个模型 · {provider.baseUrl}{provider.hasKey || provider.apiKey ? " · 已配密钥" : ""}</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <button type="button" className={QUIET} onClick={() => setOpenId(openId === provider.id ? null : provider.id)}>编辑</button>
              <button type="button" className={QUIET + " text-danger"} disabled={busy} onClick={() => { setProviders((current) => current.filter((row) => row.id !== provider.id)); setOpenId(null); }}>删除</button>
            </span>
          </li>
        ))}
        {providers.length === 0 && <li className="text-[12px] text-ink-secondary">{t("providers.empty")}</li>}
      </ul>

      {editing && (
        <div className="mt-3 grid gap-2 rounded-lg border border-hairline/40 p-3 sm:grid-cols-2">
          <label className="text-[12px] text-ink-secondary">ID
            <input className={FIELD} value={editing.id} onChange={(event) => {
              const next = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
              setProviders((current) => current.map((row) => (row.id === editing.id ? { ...row, id: next } : row)));
              setOpenId(next);
            }} placeholder="workbuddy" />
          </label>
          <label className="text-[12px] text-ink-secondary">显示名称
            <input className={FIELD} value={editing.name} onChange={(event) => patch(editing.id, { name: event.target.value })} />
          </label>
          <label className="text-[12px] text-ink-secondary sm:col-span-2">API 地址
            <input className={FIELD} value={editing.baseUrl} onChange={(event) => patch(editing.id, { baseUrl: event.target.value })} placeholder="http://127.0.0.1:8788/v1" />
          </label>
          <label className="text-[12px] text-ink-secondary sm:col-span-2">API Key（留空沿用已保存的）
            <input className={FIELD} type="password" value={editing.apiKey ?? ""} onChange={(event) => patch(editing.id, { apiKey: event.target.value })} />
          </label>
          <label className="text-[12px] text-ink-secondary">默认协议
            <select className={FIELD} value={editing.defaultProtocol} onChange={(event) => patch(editing.id, { defaultProtocol: event.target.value })}>
              {Object.entries(PROTOCOL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-secondary">模型目录</span>
              <button type="button" className={QUIET} onClick={() => void fetchModels(editing)}>{t("providers.fetch")}</button>
            </div>
            <div className="mt-1 space-y-1">
              {editing.models.map((model, index) => (
                <div key={index} className="flex min-w-0 items-center gap-1">
                  <input className={ROW_INPUT} value={model.id} placeholder="model-id"
                    onChange={(event) => patch(editing.id, { models: editing.models.map((row, at) => (at === index ? { ...row, id: event.target.value } : row)) })} />
                  <input className={ROW_PAIR} value={model.contextWindow ? Math.round(model.contextWindow / 1000) : ""} placeholder="上下文k"
                    onChange={(event) => {
                      const window = Number(event.target.value);
                      patch(editing.id, { models: editing.models.map((row, at) => (at === index ? { ...row, contextWindow: Number.isFinite(window) && window > 0 ? window * 1000 : undefined } : row)) });
                    }} />
                  <button type="button" className={QUIET} onClick={() => patch(editing.id, { models: editing.models.filter((_row, at) => at !== index) })}>删除</button>
                </div>
              ))}
            </div>
            <button type="button" className={QUIET + " mt-1"} onClick={() => patch(editing.id, { models: [...editing.models, { id: "" }] })}>{t("providers.addModel")}</button>
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" onClick={() => void save()}>{t("providers.save")}</button>
            <button type="button" className={QUIET + " px-3 py-1.5"} onClick={() => setOpenId(null)}>{t("providers.cancel")}</button>
          </div>
        </div>
      )}

      {providers.length > 0 && (
        <button type="button" className={QUIET + " mt-2"} onClick={() => {
          const fresh = emptyProvider();
          setProviders((current) => [...current, fresh]);
          setOpenId("");
        }}>+ {t("providers.add")}</button>
      )}

      {registry && providers.length > 0 && (
        <div className="mt-4 border-t border-hairline/40 pt-3">
          <p className="text-[12px] text-ink-secondary">{t("providers.bindings")}</p>
          <div className="mt-2 space-y-2">
            {Object.keys(registry.cliProtocols).map((cli) => (
              <div key={cli} className="rounded-lg border border-hairline/40 p-2">
                <div className="text-[13px] font-medium text-ink">{CLI_LABEL[cli] ?? cli}
                  <span className="ml-2 text-[11px] font-normal text-ink-tertiary">
                    {registry.cliProtocols[cli]?.map((protocol) => PROTOCOL_LABEL[protocol] ?? protocol).join(" / ")}
                  </span>
                </div>
                <div className="mt-1 space-y-1">
                  {providers.map((provider) => {
                    const binding = bindingOf(bindings, cli, provider.id);
                    return (
                      <div key={provider.id} className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={Boolean(binding)}
                            onChange={(event) => setBinding(cli, provider.id, event.target.checked ? { models: provider.models.map((model) => model.id) } : null)} />
                          {provider.name || provider.id}
                        </label>
                        {binding && (
                          <>
                            <select className={FIELD + " w-52"} value={binding.protocol}
                              onChange={(event) => setBinding(cli, provider.id, { protocol: event.target.value })}>
                              {(registry.cliProtocols[cli] ?? []).map((protocol) => (
                                <option key={protocol} value={protocol}>{PROTOCOL_LABEL[protocol] ?? protocol}</option>
                              ))}
                            </select>
                            <span className="flex flex-wrap gap-1">
                              {provider.models.map((model) => (
                                <label key={model.id} className="flex items-center gap-1 rounded border border-hairline/40 px-1 text-[11px]">
                                  <input type="checkbox" checked={binding.models.includes(model.id)}
                                    onChange={(event) => setBinding(cli, provider.id, {
                                      models: event.target.checked
                                        ? [...binding.models, model.id]
                                        : binding.models.filter((id) => id !== model.id),
                                    })} />
                                  {model.id}
                                </label>
                              ))}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button type="button" disabled={busy} className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" onClick={() => void save()}>
            {t("providers.save")}
          </button>
        </div>
      )}

      {note && <p role="status" className="mt-2 text-[12px] text-success">{note}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
