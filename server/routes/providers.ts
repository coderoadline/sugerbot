import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AppConfig } from "../config.ts";
import type { InstanceConfigMap } from "../contracts.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProviderRouteDeps {
  /** The live configuration the server serves from; writes go through saveConfig. */
  cfg: () => AppConfig;
  saveConfig: (next: AppConfig) => void;
  dataDir?: string;
}

type Protocol = "openai-completions" | "openai-responses" | "anthropic-messages";

interface ProviderModel {
  id: string;
  label?: string;
  contextWindow?: number;
}

interface ProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  defaultProtocol: Protocol;
  models: ProviderModel[];
}

interface Binding {
  providerId: string;
  protocol: Protocol;
  models: string[];
}

const PROTOCOLS: Protocol[] = ["openai-completions", "openai-responses", "anthropic-messages"];
/** What each CLI can speak. Claude Code only talks the Anthropic Messages API. */
const CLI_PROTOCOLS: Record<string, Protocol[]> = {
  codex: ["openai-completions", "openai-responses"],
  claude: ["anthropic-messages"],
  deepseek: ["openai-completions", "openai-responses", "anthropic-messages"],
};

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function dataDir(deps: ProviderRouteDeps): string {
  return deps.dataDir ?? process.env.OMB_DATA_DIR?.trim() ?? path.join(os.homedir(), ".openmausbot");
}

function registryPath(deps: ProviderRouteDeps): string {
  return path.join(dataDir(deps), "providers.json");
}

function secretPath(deps: ProviderRouteDeps, id: string): string {
  return path.join(dataDir(deps), "secrets", "provider-" + id + ".key");
}

export function readProviderSecret(deps: ProviderRouteDeps, id: string): string {
  try {
    return fs.readFileSync(secretPath(deps, id), "utf8").trim();
  } catch {
    return "";
  }
}

function readRegistry(deps: ProviderRouteDeps): { providers: ProviderEntry[]; bindings: Record<string, Binding[]> } {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(deps), "utf8")) as { providers?: ProviderEntry[]; bindings?: Record<string, Binding[]> };
    return { providers: Array.isArray(parsed.providers) ? parsed.providers : [], bindings: parsed.bindings ?? {} };
  } catch {
    return { providers: [], bindings: {} };
  }
}

/** The engine rows a binding produces: one per CLI and provider, folded together by the picker. */
export function providerInstances(deps: ProviderRouteDeps): InstanceConfigMap {
  const registry = readRegistry(deps);
  const rows: Record<string, unknown> = {};
  for (const cli of ["codex", "claude"] as const) {
    for (const binding of registry.bindings[cli] ?? []) {
      const provider = registry.providers.find((candidate) => candidate.id === binding.providerId);
      if (!provider) continue;
      const key = readProviderSecret(deps, provider.id);
      if (!key) continue;
      const ids = binding.models.filter((id) => provider.models.some((model) => model.id === id));
      const chosen = ids.length ? ids : provider.models.map((model) => model.id);
      const meta = Object.fromEntries(chosen.map((id) => {
        const model = provider.models.find((candidate) => candidate.id === id);
        return [id, model?.contextWindow ? { contextWindow: model.contextWindow } : {}];
      }));
      const instanceId = "gw-" + cli + "-" + provider.id;
      rows[instanceId] = cli === "codex"
        ? {
            driver: "codex",
            displayName: "Codex",
            config: { managed: { url: provider.baseUrl, models: chosen, meta, provider: provider.name } },
            environment: { OPENMAUSBOT_COMPANY_API_KEY: key },
          }
        : {
            driver: "claudeAgent",
            displayName: "Claude",
            access: "api",
            config: {
              managed: true, managedModels: chosen, managedMeta: meta, managedProvider: provider.name,
              configDir: "~/.openmausbot/gateway-homes/" + instanceId, requireApiKey: true,
            },
            environment: { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: provider.baseUrl.replace(/\/v1$/, "") },
          };
    }
  }
  return rows as InstanceConfigMap;
}


/** DeepSeek Harness reads its own provider table, so a binding there is written to its profile patch instead. */
async function syncDeepseek(deps: ProviderRouteDeps, registry: { providers: ProviderEntry[]; bindings: Record<string, Binding[]> }): Promise<void> {
  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), ".dsh");
  const file = path.join(home, "profiles", "acp", "cordis.patch.yml");
  const manifestFile = path.join(dataDir(deps), "dsh-managed.json");
  let previous: string[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { providers?: string[] };
    previous = Array.isArray(parsed.providers) ? parsed.providers : [];
  } catch {
    previous = [];
  }
  const wanted = (registry.bindings.deepseek ?? []).map((binding) => binding.providerId);
  if (!previous.length && !wanted.length) return;
  const entries: unknown[] = [];
  if (fs.existsSync(file)) {
    const yaml = await import("yaml");
    const parsed = yaml.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) entries.push(...parsed);
  }
  const slot = entries.find((entry) => Boolean(entry) && typeof entry === "object" && (entry as { id?: string }).id === "llm-pi-ai") as { config?: Record<string, unknown> } | undefined;
  if (!slot && !wanted.length) return;
  const target = slot ?? { id: "llm-pi-ai", config: {} };
  if (!slot) entries.push(target);
  const config = { ...(target.config ?? {}) } as Record<string, unknown>;
  const providers = { ...((config.providers ?? {}) as Record<string, unknown>) };
  for (const id of previous) delete providers[id];
  const envLines: string[] = [];
  for (const binding of registry.bindings.deepseek ?? []) {
    const provider = registry.providers.find((candidate) => candidate.id === binding.providerId);
    if (!provider) continue;
    const apiKeyEnv = "DSH_KEY_" + provider.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const models = binding.models.filter((id) => provider.models.some((model) => model.id === id));
    providers[provider.id] = {
      displayName: provider.name,
      api: binding.protocol,
      baseURL: provider.baseUrl,
      apiKeyEnv,
      models: (models.length ? models : provider.models.map((model) => model.id)).map((id) => {
        const model = provider.models.find((candidate) => candidate.id === id);
        return { id, ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}) };
      }),
    };
    const key = readProviderSecret(deps, provider.id);
    if (key) envLines.push(apiKeyEnv + "=" + key);
  }
  target.config = { ...config, providers };
  const yamlLib = await import("yaml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yamlLib.stringify(entries), { mode: 0o600 });
  if (false && envLines.length) {
    const envFile = path.join(home, ".env");
    const kept = fs.existsSync(envFile)
      ? fs.readFileSync(envFile, "utf8").split("\n").filter((line) => line.trim() && !previous.some((id) => line.startsWith("DSH_KEY_" + id.toUpperCase())))
      : [];
    fs.writeFileSync(envFile, [...kept, ...envLines].join("\n") + "\n", { mode: 0o600 });
  }
  fs.writeFileSync(manifestFile, JSON.stringify({ providers: wanted }, null, 2), { mode: 0o600 });
}

export function createProviderRoutes(deps: ProviderRouteDeps): RouteHandler {
  return async ({ req, res, path: routePath, method, json, readBody }) => {
    if (routePath !== "/api/providers") return PASS;

    if (method === "GET") {
      const registry = readRegistry(deps);
      return json(res, 200, {
        providers: registry.providers.map((provider) => ({
          ...provider,
          hasKey: Boolean(readProviderSecret(deps, provider.id)),
        })),
        bindings: registry.bindings,
        cliProtocols: CLI_PROTOCOLS,
      });
    }

    if (method !== "PUT") return PASS;

    const body = (await readBody(req)) as { providers?: unknown; bindings?: unknown } | null;
    const rawProviders = Array.isArray(body?.providers) ? (body.providers as any[]) : [];
    const providers: ProviderEntry[] = [];
    for (const entry of rawProviders) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
      if (!ID.test(id)) return json(res, 400, { error: "provider id: lowercase letters, digits and dashes" });
      const baseUrl = typeof row.baseUrl === "string" ? row.baseUrl.trim() : "";
      if (!/^https?:\/\//.test(baseUrl)) return json(res, 400, { error: "base URL must start with http(s)://" });
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
      const defaultProtocol = PROTOCOLS.includes(row.defaultProtocol as Protocol) ? row.defaultProtocol as Protocol : "openai-completions";
      const rawModels = Array.isArray(row.models) ? (row.models as any[]) : [];
      const models: ProviderModel[] = [];
      for (const item of rawModels) {
        const model = (item ?? {}) as Record<string, unknown>;
        const modelId = typeof model.id === "string" ? model.id.trim() : "";
        if (!modelId) continue;
        models.push({
          id: modelId,
          ...(typeof model.label === "string" && model.label.trim() ? { label: model.label.trim() } : {}),
          ...(typeof model.contextWindow === "number" && model.contextWindow > 0 ? { contextWindow: Math.round(model.contextWindow) } : {}),
        });
      }
      if (!models.length) return json(res, 400, { error: "provider " + id + " needs at least one model" });
      if (typeof row.apiKey === "string" && row.apiKey.trim()) {
        fs.mkdirSync(path.join(dataDir(deps), "secrets"), { recursive: true, mode: 0o700 });
        fs.writeFileSync(secretPath(deps, id), row.apiKey.trim() + "\n", { mode: 0o600 });
      }
      providers.push({ id, name, baseUrl, defaultProtocol, models });
    }

    const rawBindings = (body?.bindings ?? {}) as Record<string, unknown>;
    const bindings: Record<string, Binding[]> = {};
    for (const cli of Object.keys(CLI_PROTOCOLS)) {
      const allowed = CLI_PROTOCOLS[cli]!;
      const rows = Array.isArray(rawBindings[cli]) ? (rawBindings[cli] as any[]) : [];
      bindings[cli] = [];
      for (const entry of rows) {
        const row = (entry ?? {}) as Record<string, unknown>;
        const providerId = typeof row.providerId === "string" ? row.providerId : "";
        const provider = providers.find((candidate) => candidate.id === providerId);
        if (!provider) continue;
        const protocol = allowed.includes(row.protocol as Protocol) ? row.protocol as Protocol : allowed[0]!;
        const picked = Array.isArray(row.models) ? (row.models as unknown[]).filter((id): id is string => typeof id === "string") : [];
        const chosen = picked.filter((id) => provider.models.some((model) => model.id === id));
        bindings[cli]!.push({ providerId, protocol, models: chosen.length ? chosen : provider.models.map((model) => model.id) });
      }
    }

    fs.mkdirSync(dataDir(deps), { recursive: true });
    fs.writeFileSync(registryPath(deps), JSON.stringify({ providers, bindings }, null, 2), { mode: 0o600 });

    const next = { ...(deps.cfg().instances ?? {}) } as Record<string, unknown>;
    for (const id of Object.keys(next)) {
      if (id.startsWith("gw-")) delete next[id];
    }
    Object.assign(next, providerInstances(deps) as unknown as Record<string, unknown>);
    deps.cfg().instances = next as InstanceConfigMap;
    await syncDeepseek(deps, { providers, bindings });
    // Every engine keeps its own catalog: re-probe the ones this save touched so the picker reflects them now.
    const port = (req.socket as { localPort?: number }).localPort;
    if (port) {
      for (const instanceId of ["deepseek", ...Object.keys(providerInstances(deps))]) {
        try {
          await fetch("http://127.0.0.1:" + port + "/api/instances/" + instanceId + "/refresh-models", {
            method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000),
          });
        } catch { /* the catalog refreshes on its next probe */ }
      }
    }
    return json(res, 200, { ok: true, instances: Object.keys(next).filter((id) => id.startsWith("gw-")) });
  };
}
