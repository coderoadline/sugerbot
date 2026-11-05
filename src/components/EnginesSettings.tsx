import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { EngineCard, EngineSections, RefreshEngines, engineReady } from "./EngineLibrary";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { ApiKeyEngineManage, EngineSetup, EngineUpdateNotice, EngineWarningNotice, isApiKeyEngine } from "./EngineSetup";
import { AppCopyNotice } from "./EngineAppCopy";
import { forgetAppCopySwitches } from "@/state/engine-install";
import { AccountsCard, AddAccount, accountGroupOf, accountsReady, type AccountGroup } from "./EngineAccounts";
import { DEVICE_SIGN_IN_COPY, deviceSignInProvider } from "./DeviceSignIn";
import { AntigravityFreeSpace } from "./AntigravityFreeSpace";
import { CacheKeepWarmSettings } from "./CacheKeepWarmSettings";
import { ConfirmDialog } from "./ConfirmDialog";
import { Select } from "./Select";
import { SettingsDisclosureRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { InstanceProviderMark } from "./ProviderIcons";

interface ProbeResult {
  ok: boolean;
  version?: string;
  message?: string;
}

function CustomPicker({ instance, cliDefault, onClose, onSaved }: {
  instance: InstanceInfo;
  cliDefault?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<string[] | null>(instance.cliCandidates ?? null);
  // Starts empty: a select whose value names a missing option shows the placeholder yet still holds that value.
  const [selected, setSelected] = useState<string>("");
  const [manual, setManual] = useState<string>(
    instance.cli && !(instance.cliCandidates ?? []).includes(instance.cli) ? instance.cli : "",
  );
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    api(`/api/cli-candidates?name=${encodeURIComponent(cliDefault ?? "")}`)
      .then(({ candidates: found }: { candidates: string[] }) => {
        setCandidates(found);
        if (!instance.cli) return;
        if (found.includes(instance.cli)) setSelected(instance.cli);
        else setManual(instance.cli);
      })
      .catch(() => setCandidates((prev) => prev ?? []));
  }, [cliDefault, instance.cli]);

  const value = manual.trim() || selected;
  const dirty = value !== (instance.cli ?? "");
  const busy = probing || saving;

  useEffect(() => {
    setProbe(null);
  }, [value]);

  const persist = () => {
    if (busy || !value || !dirty) return;
    setSaving(true);
    setError(null);
    const committed = value;
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: committed }),
    })
      .then(() => Promise.resolve(onSaved()).catch(() => {}))
      .then(onClose)
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (busy || !value || !dirty) return;
    setProbing(true);
    setError(null);
    api("/api/cli-test", {
      method: "POST",
      body: JSON.stringify({ cli: value, driver: instance.driverKind }),
    })
      .then((result: ProbeResult) => {
        setProbe(result);
        if (result.ok) persist();
      })
      .catch((e) => setError(e.message))
      .finally(() => setProbing(false));
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {candidates !== null && candidates.length > 0 && (
        <Select
          className="w-full font-mono"
          value={manual.trim() ? "" : selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setManual("");
          }}
          aria-label={t("engines.detectedAria", { name: instance.displayName })}
          disabled={busy}
        >
          <option value="">{t("engines.selectBinary")}</option>
          {candidates.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
      )}
      <input
        type="text"
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!value || !dirty) return;
          save();
        }}
        placeholder={candidates?.length ? t("engines.manualPath") : "/absolute/path/to/cli"}
        aria-label={t("engines.customAria", { name: instance.displayName })}
        spellCheck={false}
        disabled={busy}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
      />
      {probe && !probe.ok && probe.message && (
        <div role="alert" className="flex gap-1.5 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-2 text-[12px] leading-relaxed text-warning">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>{t("engines.testFailed", { message: probe.message })}</span>
        </div>
      )}
      {probe?.ok && probe.version && (
        <div className="text-[12px] text-success">{t("engines.testPassed", { version: probe.version })}</div>
      )}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised/50 hover:text-ink disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        {probe && !probe.ok ? (
          <>
            <button
              onClick={() => setProbe(null)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised/50 hover:text-ink disabled:opacity-50"
            >
              {t("engines.editPath")}
            </button>
            <button
              onClick={() => persist()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-danger hover:bg-raised-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : t("engines.saveAnyway")}
            </button>
          </>
        ) : (
          <button
            onClick={save}
            disabled={busy || !value || !dirty}
            className={cn(
              "flex w-[72px] items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px]",
              "bg-raised text-ink hover:bg-raised-hover",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        )}
      </div>
    </div>
  );
}

/** The executable behind an engine: its path, Claude's self-update, and a reset to the default. */
function EngineAdvanced({ instance }: { instance: InstanceInfo }) {
  const { refreshInstances } = useStore();
  const [open, setOpen] = useState(false);
  const cliMotion = useMenuMotion(open);
  const [switching, setSwitching] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updatedVersion, setUpdatedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasOpenFor = useRef<string | null>(null);

  useEffect(() => {
    if (wasOpenFor.current !== null && wasOpenFor.current !== instance.cli) {
      setOpen(false);
    }
    wasOpenFor.current = instance.cli ?? null;
  }, [instance.cli]);

  const reset = () => {
    if (switching || updating) return;
    setSwitching(true);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: "" }),
    })
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  /** Out of every model list until Unhide; the CLI and its sign-in stay as they are. Refused while something uses it. */
  const hide = () => {
    if (switching || updating) return;
    setSwitching(true);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, { method: "PATCH", body: JSON.stringify({ hidden: true }) })
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const updateClaude = () => {
    if (switching || updating) return;
    setUpdating(true);
    setUpdatedVersion(null);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}/claude-update`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(async ({ version }: { version: string }) => {
        setUpdatedVersion(version);
        await Promise.resolve(refreshInstances()).catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setUpdating(false));
  };

  return (
      <details className="mt-4 border-t border-hairline/40 pt-3">
        <summary className="cursor-pointer rounded-md py-1 text-[12px] font-medium text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">{t("engines.library.advanced")}</summary>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("engines.footer")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {instance.cli ? (
            <span className="w-full break-all font-mono text-[12px] text-ink-secondary" title={instance.cli}>
              {instance.cli}
            </span>
          ) : (
            instance.cliDefault && (
              <span className="break-all font-mono text-[11px] text-ink-secondary">{instance.cliDefault}</span>
            )
          )}
          {instance.snapshot.version && (
            <span className="break-all text-[11px] text-ink-secondary" title={instance.snapshot.version}>
              {instance.snapshot.version}
            </span>
          )}
          <span className="flex-1" />
          {instance.driverKind === "claudeAgent" && (
            <button
              onClick={updateClaude}
              disabled={switching || updating}
              className="flex shrink-0 items-center gap-1 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {updating ? t("engines.updating") : t("engines.updateClaude")}
            </button>
          )}
          {instance.cli && (
            <button
              onClick={reset}
              disabled={switching || updating}
              className="shrink-0 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {switching ? t("engines.resetting") : t("engines.reset")}
            </button>
          )}
          <button
            type="button"
            data-hide-engine={instance.instanceId}
            onClick={hide}
            disabled={switching || updating}
            title={t("engines.hideHint")}
            className="shrink-0 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
          >
            {t("engines.hide")}
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={updating}
            aria-expanded={open}
            className={cn(
              "shrink-0 rounded-lg border border-hairline/40 px-3 py-1 text-[12px]",
              open ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
              "disabled:opacity-50",
            )}
          >
            {t("engines.setCli")}
          </button>
        </div>
        {updatedVersion && (
          <div role="status" className="mt-1 text-[12px] text-success">{t("engines.claudeUpdated", { version: updatedVersion })}</div>
        )}
        {error && <div role="alert" className="mt-1 text-[12px] text-danger">{error}</div>}
        {cliMotion.shown && (
          <div className={cliMotion.className} {...cliMotion.exitProps}>
            <CustomPicker
              instance={instance}
              cliDefault={instance.cliDefault}
              onClose={() => setOpen(false)}
              onSaved={refreshInstances}
            />
          </div>
        )}
      </details>
  );
}

/** Remove drops an added account; Sign out forgets a signed-in account's Google sign-in, the first one too. */
function AntigravityAccountAction({ instance, action }: { instance: InstanceInfo; action: "remove" | "signOut" }) {
  const { state, dispatch, refreshInstances } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = action === "remove";
  const usedBy = remove ? state.bots.filter((bot) => bot.modelSelection.instanceId === instance.instanceId).length : 0;
  const label = t(remove ? "accounts.remove" : "accounts.signOut");
  const run = async () => {
    setConfirming(false);
    setRunning(true);
    setError(null);
    try {
      const path = `/api/instances/${encodeURIComponent(instance.instanceId)}${remove ? "" : "/auth/sign-out"}`;
      const { instances } = await api(path, { method: remove ? "DELETE" : "POST" });
      if (Array.isArray(instances)) dispatch({ type: "instances", instances });
      else await refreshInstances();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={running || usedBy > 0} onClick={() => setConfirming(true)} className={cn("rounded-lg px-2.5 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50", remove ? "text-danger hover:bg-danger/10" : "text-ink-secondary hover:bg-raised hover:text-ink")}>
        {running ? <Loader2 size={13} className="animate-spin" /> : label}
      </button>
      {usedBy > 0 && <p className="text-[11px] text-ink-secondary">{t("accounts.inUse", { count: String(usedBy) })}</p>}
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <ConfirmDialog open={confirming} title={t(remove ? "accounts.removeTitle" : "accounts.signOutTitle", { name: instance.displayName })}
      body={t(remove ? "accounts.removeBodyAntigravity" : "accounts.signOutBody")}
      confirmLabel={label} tone="neutral" pending={running} onCancel={() => { if (!running) setConfirming(false); }} onConfirm={() => void run()} />
  </>;
}

function EngineRow({ instance, bare = false }: { instance: InstanceInfo; bare?: boolean }) {
  const policyNote = instance.policy && <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">
    <span className="font-medium text-ink">{t("policy.managedBy", { organization: instance.policy.organizationName })}</span> · {instance.policy.reason}
  </p>;
  if (instance.trialCredit) return <EngineCard instance={instance} bare={bare}>
    <p data-trial-credit={instance.trialCredit} className="text-[13px] leading-relaxed text-ink-secondary">{t(instance.trialCredit === "used_up" ? "engines.trialCreditUsedUp"
      : instance.trialCredit === "ended" ? "engines.trialCreditEnded" : engineReady(instance) ? "engines.trialCredit" : "engines.trialCreditOwn")}</p>
  </EngineCard>;
  if (instance.readOnly) return <EngineCard instance={instance} bare={bare}>
    {policyNote}
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.managedEngine")}</p>
    {!engineReady(instance) && <p className="mt-2 text-[12px] text-ink-secondary">{t("organization.engineUnavailable")}</p>}
  </EngineCard>;

  return (
    <EngineCard instance={instance} bare={bare}>
      {policyNote}
      {!engineReady(instance) && <EngineSetup instance={instance} intent={instance.access === "custom" ? "inject" : "cloud"} unframed />}
      {engineReady(instance) && <ApiKeyEngineManage instance={instance} className="mt-3" />}
      {/* The setup panel that first said so is gone once the engine is Ready. */}
      {engineReady(instance) && <AppCopyNotice instance={instance} className="mt-3" />}
      {instance.snapshot.update && <EngineUpdateNotice update={instance.snapshot.update} instance={instance} className="mt-3" quiet />}
      {instance.snapshot.warning && <EngineWarningNotice warning={instance.snapshot.warning} className="mt-3" />}
      {engineReady(instance) && instance.snapshot.authenticated === true && (
        instance.authentication?.method === "device-code"
          ? <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t(DEVICE_SIGN_IN_COPY[deviceSignInProvider(instance.driverKind)].connectedAccount)}</p>
          : instance.authentication?.method === "paste-code" && (
            <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t("engineSetup.claude.connectedAccount")}</p>
          )
      )}
      {instance.freeUpSpace && <AntigravityFreeSpace instance={instance} />}
      {instance.driverKind === "antigravityAgent" && (
        <div className="mt-3 space-y-3">
          {instance.snapshot.authenticated && <p className="break-words text-[12px] text-ink-secondary">{instance.snapshot.account?.email ?? t("engineSetup.antigravity.emailUnavailable")}</p>}
          <AddAccount label={t("engineSetup.antigravity.addAccount")} endpoint="/api/instances/antigravity-accounts" extra={{ sourceInstanceId: instance.instanceId }} onAdded={() => {}} />
          {instance.snapshot.authenticated === true && instance.authentication?.signOut === true && <AntigravityAccountAction instance={instance} action="signOut" />}
          {instance.instanceId.startsWith("antigravity-") && <AntigravityAccountAction instance={instance} action="remove" />}
        </div>
      )}
      <EngineAdvanced instance={instance} />
    </EngineCard>
  );
}

function simpleStatus(instance: InstanceInfo, ready: boolean): string {
  if (ready) return instance.snapshot.authenticated === true && instance.snapshot.account?.email ? instance.snapshot.account.email : t("onboarding.engines.ready");
  return instance.snapshot.state === "available" && instance.snapshot.authenticated === false ? t("model.signInRequired") : t("onboarding.engines.needsSetup");
}

function SimpleEngines({ rows, isReady, renderEngine, more }: {
  rows: InstanceInfo[];
  isReady: (instance: InstanceInfo) => boolean;
  renderEngine: (instance: InstanceInfo, bare?: boolean) => ReactNode;
  more: { id: string; open: boolean; onToggle: () => void };
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const featured = rows.filter((instance) => isReady(instance) || instance.authentication !== undefined);
  const others = rows.filter((instance) => !featured.includes(instance));
  return (
    <>
      <SettingsGroup label={t("settings.simple.ai.yours")} actions={<RefreshEngines />}>
        <SettingsRows>
          {featured.map((instance) => {
            const ready = isReady(instance), open = opened === instance.instanceId;
            return (
              <div key={instance.instanceId} data-simple-engine={instance.instanceId} className="group">
                <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
                  <span className="flex min-w-[min(100%,15rem)] flex-1 items-center gap-3">
                    <InstanceProviderMark instance={instance} size={14} subtle />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[14px] leading-5 text-ink">{instance.displayName}</span>
                      <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{simpleStatus(instance, ready)}</span>
                    </span>
                  </span>
                  <button type="button" aria-expanded={open} className="ui-button ml-auto shrink-0" onClick={() => setOpened(open ? null : instance.instanceId)}>
                    {t(open ? "common.done" : ready ? "settings.simple.ai.manage" : "settings.simple.ai.setUp")}
                  </button>
                </div>
                {open && <div className="px-4 pb-3">{renderEngine(instance, true)}</div>}
              </div>
            );
          })}
        </SettingsRows>
      </SettingsGroup>
      {others.length > 0 && (
        <SettingsDisclosureRow
          title={t("settings.simple.ai.more", { count: String(others.length) })}
          trailing={<span aria-hidden="true" className="flex items-center -space-x-1">
            {others.slice(0, 4).map((instance) => (
              <span key={instance.instanceId} className="flex size-[18px] items-center justify-center rounded-full bg-menu"><InstanceProviderMark instance={instance} size={14} subtle /></span>
            ))}
          </span>}
          {...more}
        >
          <EngineSections instances={others} isReady={isReady} renderEngine={(instance) => renderEngine(instance)} />
        </SettingsDisclosureRow>
      )}
    </>
  );
}

/** Providers someone hid: listed apart, folded, each one click from coming back. */
export function HiddenEngines() {
  const { state, refreshInstances } = useStore();
  const [hidden, setHidden] = useState<Array<{ instanceId: string; displayName: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // An older server has no such route: nothing is hidden there.
    api<{ instances?: Array<{ instanceId: string; displayName: string }> } | undefined>("/api/instances/hidden")
      .then((result) => { if (alive) setHidden(Array.isArray(result?.instances) ? result.instances : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [state.instances]);
  if (hidden.length === 0) return null;
  const unhide = (instanceId: string) => {
    setBusy(instanceId);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instanceId)}`, { method: "PATCH", body: JSON.stringify({ hidden: false }) })
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };
  return (
    <details data-hidden-engines className="px-4">
      <summary className="cursor-pointer text-[13px] font-medium text-ink-secondary hover:text-ink">{t("engines.hiddenTitle", { count: String(hidden.length) })}</summary>
      <p className="mt-2 text-[12px] text-ink-secondary">{t("engines.hiddenHint")}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {hidden.map((entry) => (
          <div key={entry.instanceId} className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-2">
            <span className="min-w-0 truncate text-[13px] text-ink">{entry.displayName}</span>
            <button type="button" data-unhide-engine={entry.instanceId} disabled={busy !== null} onClick={() => unhide(entry.instanceId)}
              className="shrink-0 text-[12px] font-medium text-accent hover:underline disabled:opacity-50">
              {busy === entry.instanceId ? t("engines.unhiding") : t("engines.unhide")}
            </button>
          </div>
        ))}
      </div>
      {error && <div role="alert" className="mt-1 text-[12px] text-danger">{error}</div>}
    </details>
  );
}

export function AddGatewayEngine() {
  const { state, refreshInstances } = useStore();
  const added = state.instances.filter((instance) => instance.instanceId.startsWith("gw-"));
  const remove = async (instanceId: string) => {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ instances: { [instanceId]: null } }) });
      await refreshInstances({ reportErrors: false }).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const [kind, setKind] = useState<"codex" | "claude" | "deepseek">("codex");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("http://127.0.0.1:8788/v1");
  const [key, setKey] = useState("");
  const [models, setModels] = useState("");
  const [apiKind, setApiKind] = useState("openai-completions");
  const [apiKeyEnv, setApiKeyEnv] = useState("OMB_GW_KEY");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pulled, setPulled] = useState<Array<{ id: string; contextWindow?: number }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const pull = async () => {
    setPulling(true); setError(null); setNote(null);
    try {
      const result = await api<{ models: Array<{ id: string; contextWindow?: number }> }>(
        "/api/gateway-models?url=" + encodeURIComponent(url.trim()) + "&key=" + encodeURIComponent(key.trim()),
      );
      setPulled(result.models);
      setPicked(result.models.map((model) => model.id));
      setNote("拉到 " + result.models.length + " 个模型，勾选后保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPulling(false);
    }
  };
  const add = async () => {
    const typed = models.split(",").map((m) => m.trim()).filter(Boolean);
    const list = picked.length ? picked : typed;
    if (!slug || !url.trim() || !key.trim() || list.length === 0) { setError("名称 / 地址 / key / 模型 都要填"); return; }
    setBusy(true); setError(null); setNote(null);
    try {
      const target = url.trim().replace(/\/+$/, "");
      const meta = Object.fromEntries(list.map((model) => [model, { contextWindow: 1_000_000 }]));
      if (kind === "deepseek") {
        await api("/api/dsh-provider", {
          method: "POST",
          body: JSON.stringify({
            provider: slug,
            displayName: name.trim() || slug,
            baseUrl: target,
            api: apiKind,
            apiKeyEnv: apiKeyEnv.trim(),
            key: key.trim(),
            models: list.map((id) => ({ id, contextWindow: 1_000_000 })),
          }),
        });
        await api("/api/instances/deepseek/refresh-models", { method: "POST", body: "{}" }).catch(() => undefined);
        await refreshInstances({ reportErrors: false }).catch(() => undefined);
        setNote("已写入 DeepSeek 的 provider " + slug + "；模型菜单里是 " + slug + "/<模型>");
      } else {
        const id = "gw-" + kind + "-" + slug;
        const target2 = kind === "claude" ? target.replace(/\/v1$/, "") : target;
        const instance = kind === "codex" ? {
          driver: "codex",
          displayName: "Codex · " + slug,
          config: { managed: { url: target, models: list, meta } },
          environment: { OPENMAUSBOT_COMPANY_API_KEY: key.trim() },
        } : {
          driver: "claudeAgent",
          displayName: "Claude · " + slug,
          access: "api" as const,
          config: { managed: true, managedModels: list, managedMeta: meta, configDir: "~/.openmausbot/gateway-homes/" + id, requireApiKey: true },
          environment: { ANTHROPIC_API_KEY: key.trim(), ANTHROPIC_BASE_URL: target2 },
        };
        await api("/api/config", { method: "PUT", body: JSON.stringify({ instances: { [id]: instance } }) });
        await refreshInstances({ reportErrors: false }).catch(() => undefined);
        setNote("已添加 " + id);
      }
      setKey(""); setModels(""); setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const field = "mt-1 w-full rounded-lg border border-hairline/40 bg-control/30 px-2 py-1.5 text-[13px] text-ink";
  return (
    <div className="mx-4 rounded-xl border border-hairline/40 bg-card p-4" data-testid="engine-add-gateway">
      <h2 className="text-[15px] font-medium text-ink">添加第三方模型</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
        Codex / Claude：成为一条独立引擎，模型名就是下拉里显示的名字。DeepSeek Harness：写进它自己的 provider 表，模型显示为 provider/模型。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] text-ink-secondary">挂到哪个 CLI
          <select value={kind} onChange={(event) => setKind(event.target.value === "claude" ? "claude" : event.target.value === "deepseek" ? "deepseek" : "codex")} className={field}>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
            <option value="deepseek">DeepSeek Harness</option>
          </select>
        </label>
        <label className="text-[12px] text-ink-secondary">{kind === "deepseek" ? "Provider id" : "短名"}
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "deepseek" ? "omb-gw" : "workbuddy"} className={field} />
        </label>
        <label className="text-[12px] text-ink-secondary sm:col-span-2">网关地址
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8788/v1" className={field} />
        </label>
        {kind === "deepseek" && (
          <>
            <label className="text-[12px] text-ink-secondary">协议
              <select value={apiKind} onChange={(event) => setApiKind(event.target.value)} className={field}>
                <option value="openai-completions">openai-completions</option>
                <option value="openai-responses">openai-responses</option>
                <option value="anthropic-messages">anthropic-messages</option>
              </select>
            </label>
            <label className="text-[12px] text-ink-secondary">key 环境变量名
              <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} className={field} />
            </label>
          </>
        )}
        <label className="text-[12px] text-ink-secondary sm:col-span-2">API key
          <input type="password" value={key} onChange={(event) => setKey(event.target.value)} className={field} />
        </label>
        <label className="text-[12px] text-ink-secondary sm:col-span-2">模型 id（逗号分隔；留空则从 /models 拉取）
          <input value={models} onChange={(event) => setModels(event.target.value)} placeholder="deepseek-v4.1-flash-sg,hy3" className={field} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pulling || !url.trim() || !key.trim()} onClick={() => void pull()} className="rounded-lg border border-hairline/40 px-2.5 py-1 text-[12px] text-ink-secondary disabled:opacity-50">
          {pulling ? "拉取中…" : "拉取模型列表"}
        </button>
        {pulled.length > 0 && (
          <button type="button" onClick={() => setPicked(picked.length ? [] : pulled.map((model) => model.id))} className="rounded-lg border border-hairline/40 px-2.5 py-1 text-[12px] text-ink-secondary">
            {picked.length ? "全不选" : "全选"}
          </button>
        )}
        <span className="text-[11px] text-ink-secondary">导入的模型默认按 1M 上下文记录</span>
      </div>
      {pulled.length > 0 && (
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-hairline/40">
          {pulled.map((model) => (
            <label key={model.id} className="flex items-center gap-2 border-b border-hairline/20 px-2 py-1 text-[12px] text-ink last:border-0">
              <input type="checkbox" checked={picked.includes(model.id)} onChange={() => setPicked((current) => current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id])} />
              <span className="min-w-0 flex-1 truncate">{model.id}</span>
              <span className="shrink-0 text-[11px] text-ink-secondary">{model.contextWindow ? Math.round(model.contextWindow / 1000) + "k" : "1M"}</span>
            </label>
          ))}
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => void add()} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
        {busy ? "保存中…" : kind === "deepseek" ? "写入 provider" : "添加引擎"}
      </button>
      {note && <p role="status" className="mt-2 text-[12px] text-success">{note}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {added.length > 0 && (
        <div className="mt-4 border-t border-hairline/40 pt-3">
          <p className="text-[12px] text-ink-secondary">已添加的网关</p>
          <ul className="mt-1 space-y-1">
            {added.map((instance) => (
              <li key={instance.instanceId} className="flex items-center justify-between gap-2 text-[13px] text-ink">
                <span className="min-w-0 truncate">{instance.displayName ?? instance.instanceId}<span className="ml-2 text-[11px] text-ink-secondary">{instance.instanceId}</span></span>
                <button type="button" onClick={() => void remove(instance.instanceId)} className="shrink-0 rounded-md border border-hairline/40 px-2 py-0.5 text-[12px] text-ink-secondary hover:text-danger">删除</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EnginesSettings({ simple = false, more }: { simple?: boolean; more?: { id: string; open: boolean; onToggle: () => void } }) {
  const { state } = useStore();
  // Leaving Settings ends the "now uses the copy OpenMausBot installed" lines.
  useEffect(() => forgetAppCopySwitches, []);
  const listed = state.instances.filter((i) => i.readOnly || i.cli !== undefined || i.cliDefault !== undefined || i.snapshot.state === "unavailable" || i.snapshot.state === "available" || isApiKeyEngine(i));
  // A provider's accounts share one card, which takes the place of its first account.
  const groups = new Map<AccountGroup, InstanceInfo[]>();
  for (const instance of listed) {
    const group = accountGroupOf(instance);
    if (group) groups.set(group, [...groups.get(group) ?? [], instance]);
  }
  const groupOf = (instance: InstanceInfo) => {
    const group = accountGroupOf(instance);
    return group && groups.get(group)?.[0] === instance ? group : null;
  };
  const rows = listed.filter((instance) => !accountGroupOf(instance) || groupOf(instance));
  const isReady = (instance: InstanceInfo) => { const group = groupOf(instance); return group ? accountsReady(groups.get(group)!) : engineReady(instance); };
  const renderEngine = (instance: InstanceInfo, bare = false) => {
    const group = groupOf(instance);
    return group
      ? <AccountsCard group={group} accounts={groups.get(group)!} advanced={<EngineAdvanced instance={instance} />} bare={bare} />
      : <EngineRow instance={instance} bare={bare} />;
  };

  if (simple && more) return <SimpleEngines rows={rows} isReady={isReady} renderEngine={renderEngine} more={more} />;

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60 space-y-2 px-4">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("settings.engines.title")}</h1>
          <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-ink-secondary">{t("engines.library.intro")}</p>
        </div>
        <RefreshEngines />
      </div>
      <EngineSections instances={rows} isReady={isReady} renderEngine={renderEngine} />
      <HiddenEngines />
      <CacheKeepWarmSettings />
    </div>
  );
}
