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

export function isProviderId(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id);
}

export function providerById(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Used only when a provider's live model listing is unavailable. The Keys page
 * refreshes the real list from each provider, so treat these as a last resort,
 * not a catalogue.
 */
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
  { id: 1, short: "External", name: "The world outside the plan" },
  { id: 2, short: "Technology", name: "The tools, data and capabilities the plan depends on, or ignores" },
  { id: 3, short: "Assumptions", name: "The story of how change happens" },
  { id: 4, short: "Delivery", name: "Whether the work is getting done" },
  { id: 5, short: "Resources", name: "Money and people" },
  { id: 6, short: "Mandate", name: "Who is allowed to act" },
  { id: 7, short: "Legitimacy", name: "Who actually benefits" },
  { id: 8, short: "Risks", name: "Events that should reopen the document" },
  { id: 9, short: "Evidence", name: "What others have learned" },
  { id: 10, short: "Opportunity", name: "Windows you would regret missing" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const INTENSITIES = ["watch", "amend", "refresh", "reset", "no-change"] as const;
export type Intensity = (typeof INTENSITIES)[number];

/** Revision intensities a threshold or a pre-commitment can name (no "no-change"). */
export const REVISION_INTENSITIES = ["watch", "amend", "refresh", "reset"] as const;
export type RevisionIntensity = (typeof REVISION_INTENSITIES)[number];

/** Which threshold a signal's latest reading has crossed. */
export const CROSSED_LEVELS = ["none", "watch", "amend", "refresh", "reset"] as const;
export type CrossedLevel = (typeof CROSSED_LEVELS)[number];

/** Ordering for intensities and crossed levels — bigger reopens more of the document. */
export const INTENSITY_ORDER: Record<Intensity | CrossedLevel, number> = {
  "no-change": 0,
  none: 0,
  watch: 1,
  amend: 2,
  refresh: 3,
  reset: 4,
};

export const ASSUMPTION_STATUSES = ["holding", "weakening", "broken", "untested"] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

export const ASSUMPTION_ORIGINS = ["stated", "implicit"] as const;

export const SIGNAL_LAYERS = ["sentinel", "rotating", "interrupt"] as const;
export type SignalLayer = (typeof SIGNAL_LAYERS)[number];

export const SIGNAL_STATUSES = ["active", "parked", "retired"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const CADENCES = ["continuous", "monthly", "quarterly", "annual", "event-driven"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CLIFF_KINDS = ["fiscal", "legal", "scenario", "review"] as const;

/** Neutral is for notes that neither support nor weaken: a work order on an untested bet. */
export const EVIDENCE_DIRECTIONS = ["supporting", "weakening", "neutral"] as const;
export type EvidenceDirection = (typeof EVIDENCE_DIRECTIONS)[number];

export const DELIVERY_RAGS = ["green", "amber", "red", "unrated"] as const;
export type DeliveryRag = (typeof DELIVERY_RAGS)[number];

/** Who produced a rating or an evidence note: a person, or a model draft a person accepted. */
export const RATING_METHODS = ["person", "desk"] as const;
export type RatingMethod = (typeof RATING_METHODS)[number];

/** Roles on a shared strategy. The creator is the owner; members are added by email. */
export const MEMBER_ROLES = ["owner", "editor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

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

/** The room a red line reads in when none was named: "red lines agreed in advance" is room 8. */
export const INTERRUPT_DEFAULT_ROOM = 8;

/** A cliff's kind already says which room it belongs to. */
export const CLIFF_ROOM: Record<(typeof CLIFF_KINDS)[number], number> = {
  fiscal: 5,
  legal: 6,
  review: 3,
  scenario: 8,
};

export function roomOfCliff(cliff: { kind: string }): number {
  return CLIFF_ROOM[cliff.kind as (typeof CLIFF_KINDS)[number]] ?? INTERRUPT_DEFAULT_ROOM;
}

export function roomOfInterrupt(interrupt: { category: number | null }): number {
  const c = interrupt.category;
  return c != null && c >= 1 && c <= 10 ? c : INTERRUPT_DEFAULT_ROOM;
}
