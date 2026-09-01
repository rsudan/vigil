import {
  ENV_KEY_NAME,
  FALLBACK_MODELS,
  LLM_PROVIDERS,
  type LlmProviderId,
  type ProviderId,
  isLlmProvider,
  providerById,
} from "@/lib/taxonomy";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

export async function chatComplete(opts: {
  provider: LlmProviderId;
  key: string;
  model: string;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
}): Promise<{ content: string; model: string }> {
  const model = opts.model || FALLBACK_MODELS[opts.provider][0]!;
  const maxTokens = opts.maxTokens ?? 6000;

  if (opts.provider === "anthropic") {
    const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader("anthropic", opts.key) },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: opts.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 180)}`);
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
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 180)}`);
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
  });
  if (!res.ok) throw new Error(`${opts.provider} ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return { content: body.choices?.[0]?.message?.content ?? "", model };
}

function filterModelId(id: string) {
  const lower = id.toLowerCase();
  if (/(embed|whisper|tts|audio|image|dall|moderation|realtime|computer-use)/.test(lower)) return false;
  return true;
}

export async function listModels(provider: ProviderId, key: string): Promise<string[]> {
  const meta = providerById(provider);
  if (!meta) return [];
  if (!isLlmProvider(provider)) return [];

  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=50", {
        headers: authHeader("anthropic", key),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data?: { id: string }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter(filterModelId);
      return ids.length ? ids : FALLBACK_MODELS.anthropic;
    }
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const ids = (body.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter(filterModelId);
      return ids.length ? ids : FALLBACK_MODELS.gemini;
    }
    if (provider === "perplexity") {
      return FALLBACK_MODELS.perplexity;
    }
    const url =
      provider === "xai"
        ? "https://api.x.ai/v1/models"
        : provider === "openrouter"
          ? "https://openrouter.ai/api/v1/models"
          : "https://api.openai.com/v1/models";
    const res = await fetch(url, { headers: authHeader(provider, key) });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data?: { id: string }[] };
    const ids = (body.data ?? []).map((m) => m.id).filter(filterModelId);
    return ids.length ? ids : FALLBACK_MODELS[provider];
  } catch {
    return FALLBACK_MODELS[provider] ?? [];
  }
}

export async function testProvider(
  provider: ProviderId,
  key: string,
): Promise<{ ok: true; models: string[]; detail: string } | { ok: false; error: string }> {
  const trimmed = key.trim();
  if (trimmed.length < 8) return { ok: false, error: "That key looks too short." };

  try {
    if (provider === "exa") {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": trimmed },
        body: JSON.stringify({ query: "Sendai disaster risk reduction", numResults: 1 }),
      });
      if (!res.ok) return { ok: false, error: `Exa ${res.status}` };
      return { ok: true, models: [], detail: "Exa search accepted the key." };
    }
    if (provider === "jina") {
      const res = await fetch("https://r.jina.ai/https://example.com", {
        headers: { Authorization: `Bearer ${trimmed}`, Accept: "text/plain", "X-Timeout": "15" },
      });
      if (!res.ok) return { ok: false, error: `Jina ${res.status}` };
      return { ok: true, models: [], detail: "Jina Reader accepted the key." };
    }
    if (!isLlmProvider(provider)) return { ok: false, error: "Unknown provider" };

    const models = await listModels(provider, trimmed);
    if (provider === "perplexity") {
      const ping = await chatComplete({
        provider,
        key: trimmed,
        model: models[0] ?? "sonar",
        messages: [{ role: "user", content: "Reply with the single word pong." }],
        maxTokens: 16,
      });
      if (!ping.content) return { ok: false, error: "Perplexity returned an empty reply." };
    }
    return {
      ok: true,
      models,
      detail: models.length ? `${models.length} models available` : "Key accepted",
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
