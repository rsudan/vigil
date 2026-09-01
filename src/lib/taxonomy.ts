export const LLM_PROVIDERS = [
  {
    id: "xai" as const,
    name: "xAI",
    kind: "llm" as const,
    hint: "Grok — extract, briefs, revision notes",
    docs: "https://docs.x.ai",
    testUrl: "https://api.x.ai/v1/models",
    defaultModel: "grok-4-fast",
  },
  {
    id: "openai" as const,
    name: "OpenAI",
    kind: "llm" as const,
    hint: "GPT models for extraction and briefs",
    docs: "https://platform.openai.com/docs",
    testUrl: "https://api.openai.com/v1/models",
    defaultModel: "gpt-4o",
  },
  {
    id: "anthropic" as const,
    name: "Anthropic",
    kind: "llm" as const,
    hint: "Claude models for extraction and briefs",
    docs: "https://docs.anthropic.com",
    testUrl: "https://api.anthropic.com/v1/models",
    defaultModel: "claude-sonnet-4-5",
  },
  {
    id: "openrouter" as const,
    name: "OpenRouter",
    kind: "llm" as const,
    hint: "Route extraction through any OpenRouter model",
    docs: "https://openrouter.ai/docs",
    testUrl: "https://openrouter.ai/api/v1/models",
    defaultModel: "openai/gpt-4o",
  },
  {
    id: "gemini" as const,
    name: "Gemini",
    kind: "llm" as const,
    hint: "Google Gemini for extraction and briefs",
    docs: "https://ai.google.dev/docs",
    testUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "perplexity" as const,
    name: "Perplexity",
    kind: "llm" as const,
    hint: "Sonar models — grounded extraction and search-style briefs",
    docs: "https://docs.perplexity.ai",
    testUrl: "https://api.perplexity.ai/chat/completions",
    defaultModel: "sonar-pro",
  },
] as const;

export const TOOL_PROVIDERS = [
  {
    id: "exa" as const,
    name: "Exa",
    kind: "search" as const,
    hint: "Neural search — adjacent evidence and peer practice",
    docs: "https://docs.exa.ai",
    testUrl: "https://api.exa.ai/search",
    defaultModel: null,
  },
  {
    id: "jina" as const,
    name: "Jina",
    kind: "reader" as const,
    hint: "Reader — pull a strategy URL into markdown",
    docs: "https://jina.ai/reader",
    testUrl: "https://r.jina.ai/https://example.com",
    defaultModel: null,
  },
] as const;

export const PROVIDERS = [...LLM_PROVIDERS, ...TOOL_PROVIDERS];

export type ProviderId = (typeof PROVIDERS)[number]["id"];
export type LlmProviderId = (typeof LLM_PROVIDERS)[number]["id"];

export function isLlmProvider(id: string): id is LlmProviderId {
  return LLM_PROVIDERS.some((p) => p.id === id);
}

export function providerById(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

export const FALLBACK_MODELS: Record<LlmProviderId, string[]> = {
  xai: ["grok-4-fast", "grok-4-fast-non-reasoning", "grok-4.5", "grok-3"],
  openai: ["gpt-4.1", "gpt-4o", "gpt-4o-mini", "o4-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4", "x-ai/grok-4-fast", "google/gemini-2.5-flash"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  perplexity: ["sonar-pro", "sonar", "sonar-reasoning-pro"],
};

export const ENV_KEY_NAME: Partial<Record<ProviderId, string>> = {
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  exa: "EXA_API_KEY",
  jina: "JINA_API_KEY",
};

export const CATEGORIES = [
  { id: 1, short: "External", name: "External operating environment" },
  { id: 2, short: "Technology", name: "Technology, data and digital systems" },
  { id: 3, short: "Assumptions", name: "Critical assumptions and theory of change" },
  { id: 4, short: "Delivery", name: "Results and delivery performance" },
  { id: 5, short: "Resources", name: "Resource envelope and delivery capacity" },
  { id: 6, short: "Mandate", name: "Political mandate, institutions and legal frame" },
  { id: 7, short: "Legitimacy", name: "Stakeholder legitimacy, uptake and distributional effects" },
  { id: 8, short: "Risks", name: "Risk landscape and threshold events" },
  { id: 9, short: "Evidence", name: "Evidence, peer practice and adjacent strategies" },
  { id: 10, short: "Opportunity", name: "Emerging opportunities and option value" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const INTENSITIES = ["watch", "amend", "refresh", "reset", "no-change"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const ASSUMPTION_STATUSES = ["holding", "weakening", "broken", "untested"] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

export const SIGNAL_LAYERS = ["sentinel", "rotating", "interrupt"] as const;
export type SignalLayer = (typeof SIGNAL_LAYERS)[number];

export const SIGNAL_STATUSES = ["active", "parked", "retired"] as const;

export const BUDGET = {
  maxActiveSignals: 30,
  maxSentinels: 8,
  maxQueue: 12,
  maxAssumptions: 12,
  minAssumptions: 5,
} as const;

export function pressure(m: number, v: number, c: number) {
  return m * v * (6 - c);
}

/** Each of M, V, C is 1–5, so pressure runs from 1×1×(6−5)=1 to 5×5×(6−1)=125. */
export const PRESSURE_RANGE = { min: 1, max: 125 } as const;

export function pressureBand(value: number): { id: "quiet" | "moderate" | "high" | "severe"; label: string } {
  if (value >= 80) return { id: "severe", label: "severe" };
  if (value >= 40) return { id: "high", label: "high" };
  if (value >= 16) return { id: "moderate", label: "moderate" };
  return { id: "quiet", label: "quiet" };
}

export function cadenceDays(cadence: string) {
  switch (cadence) {
    case "continuous":
      return 7;
    case "monthly":
      return 30;
    case "quarterly":
      return 90;
    case "annual":
      return 365;
    case "event-driven":
      return 90;
    default:
      return 30;
  }
}

export function categoryById(id: number) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}
