import {
  ENV_KEY_NAME,
  FALLBACK_MODELS,
  LLM_PROVIDERS,
  type LlmProviderId,
  type ProviderId,
  isLlmProvider,
  providerById,
} from "@/lib/taxonomy";

import { isMockKey, mockChat, type MockTask } from "@/lib/server/mock";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const CHAT_TIMEOUT_MS = 180_000;
const LIST_TIMEOUT_MS = 20_000;

function authHeader(provider: LlmProviderId, key: string): Record<string, string> {
  if (provider === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  }
  if (provider === "gemini") return {};
  if (provider === "openrouter") {
    return { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://vigil.app", "X-Title": "Vigil" };
  }
  return { Authorization: `Bearer ${key}` };
}

function openaiCompatibleUrl(provider: LlmProviderId) {
  switch (provider) {
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "perplexity":
      return "https://api.perplexity.ai/chat/completions";
    default:
      return "";
  }
}

async function readError(res: Response, label: string) {
  const text = (await res.text()).slice(0, 180);
  if (res.status === 401 || res.status === 403) return `${label} rejected the key (${res.status}).`;
  if (res.status === 404) return `${label} does not know that model (${res.status}). Pick another on the Keys page.`;
  if (res.status === 429) return `${label} is rate-limiting this key (429). Wait a minute and try again.`;
  return `${label} ${res.status}: ${text}`;
}

export async function chatComplete(opts: {
  provider: LlmProviderId;
  key: string;
  model: string;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  /** What the call is for; only the offline mock reads it. */
  task?: MockTask;
}): Promise<{ content: string; model: string }> {
  if (isMockKey(opts.key)) {
    const last = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    return { content: mockChat(opts.task ?? "generic", last), model: "mock" };
  }
  const model = opts.model || FALLBACK_MODELS[opts.provider][0]!;
  const maxTokens = opts.maxTokens ?? 6000;
  const signal = AbortSignal.timeout(CHAT_TIMEOUT_MS);

  if (opts.provider === "anthropic") {
    const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader("anthropic", opts.key) },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: system || undefined,
        messages: opts.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
      signal,
    });
    if (!res.ok) throw new Error(await readError(res, "Anthropic"));
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).map((c) => c.text ?? "").join("");
    return { content: text, model };
  }

  if (opts.provider === "gemini") {
    const joined = opts.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: joined }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0,
          responseMimeType: opts.json ? "application/json" : undefined,
        },
      }),
      signal,
    });
    if (!res.ok) throw new Error(await readError(res, "Gemini"));
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { content: text, model };
  }

  const url = openaiCompatibleUrl(opts.provider);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(opts.provider, opts.key) },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: opts.json ? { type: "json_object" } : undefined,
      messages: opts.messages,
    }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res, providerById(opts.provider)?.name ?? opts.provider));
  const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return { content: body.choices?.[0]?.message?.content ?? "", model };
}

function filterModelId(id: string) {
  const lower = id.toLowerCase();
  if (/(embed|whisper|tts|audio|image|dall|moderation|realtime|computer-use)/.test(lower)) return false;
  return true;
}

/**
 * Ask the provider for its model list with this key. A rejection is reported
 * as such: the fallback lists are for the picker only, never for deciding
 * whether a key works.
 */
async function fetchModelList(
  provider: LlmProviderId,
  key: string,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=50", {
        headers: authHeader("anthropic", key),
        signal,
      });
      if (!res.ok) return { ok: false, error: await readError(res, "Anthropic") };
      const body = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, models: (body.data ?? []).map((m) => m.id).filter(filterModelId) };
    }
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { signal },
      );
      if (!res.ok) return { ok: false, error: await readError(res, "Gemini") };
      const body = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      return {
        ok: true,
        models: (body.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((m) => (m.name ?? "").replace(/^models\//, ""))
          .filter(filterModelId),
      };
    }
    if (provider === "perplexity") {
      // No list endpoint; the key is checked with a one-word completion instead.
      return { ok: true, models: FALLBACK_MODELS.perplexity };
    }
    const url =
      provider === "xai"
        ? "https://api.x.ai/v1/models"
        : provider === "openrouter"
          ? "https://openrouter.ai/api/v1/models"
          : "https://api.openai.com/v1/models";
    const res = await fetch(url, { headers: authHeader(provider, key), signal });
    if (!res.ok) return { ok: false, error: await readError(res, providerById(provider)?.name ?? provider) };
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (body.data ?? []).map((m) => m.id).filter(filterModelId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Could not reach the provider: ${err.message}` : "Could not reach the provider" };
  }
}

/** Models for the picker: the live list, or the fallback list when listing fails. */
export async function listModels(provider: ProviderId, key: string): Promise<string[]> {
  if (!isLlmProvider(provider)) return [];
  if (isMockKey(key)) return ["mock"];
  const result = await fetchModelList(provider, key);
  return result.ok && result.models.length ? result.models : FALLBACK_MODELS[provider];
}

export async function testProvider(
  provider: ProviderId,
  key: string,
): Promise<{ ok: true; models: string[]; detail: string } | { ok: false; error: string }> {
  const trimmed = key.trim();
  if (isMockKey(trimmed)) return { ok: true, models: ["mock"], detail: "Offline mock accepted." };
  if (trimmed.length < 8) return { ok: false, error: "That key looks too short." };
  const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);

  try {
    if (provider === "exa") {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": trimmed },
        body: JSON.stringify({ query: "Sendai disaster risk reduction", numResults: 1 }),
        signal,
      });
      if (!res.ok) return { ok: false, error: `Exa rejected the key (${res.status})` };
      return { ok: true, models: [], detail: "Exa search accepted the key." };
    }
    if (provider === "jina") {
      const res = await fetch("https://r.jina.ai/https://example.com", {
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "text/plain", "X-Timeout": "15" },
        signal,
      });
      if (!res.ok) return { ok: false, error: `Jina rejected the key (${res.status})` };
      return { ok: true, models: [], detail: "Jina Reader accepted the key." };
    }
    if (!isLlmProvider(provider)) return { ok: false, error: "Unknown provider" };

    const listed = await fetchModelList(provider, trimmed);
    if (!listed.ok) return { ok: false, error: listed.error };
    if (provider === "perplexity") {
      const ping = await chatComplete({
        provider,
        key: trimmed,
        model: listed.models[0] ?? "sonar",
        messages: [{ role: "user", content: "Reply with the single word pong." }],
        maxTokens: 16,
      });
      if (!ping.content) return { ok: false, error: "Perplexity returned an empty reply." };
    }
    return {
      ok: true,
      models: listed.models,
      detail: listed.models.length ? `${listed.models.length} models available` : "Key accepted",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Test failed" };
  }
}

export function envKeyFor(provider: ProviderId) {
  const name = ENV_KEY_NAME[provider];
  if (!name) return null;
  const v = process.env[name]?.trim();
  return v || null;
}

export function defaultModel(provider: LlmProviderId) {
  return LLM_PROVIDERS.find((p) => p.id === provider)?.defaultModel ?? FALLBACK_MODELS[provider][0]!;
}
