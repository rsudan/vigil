import type { AssumptionStatus, Intensity, ProviderId, SignalLayer } from "./taxonomy";

export type { AssumptionStatus, Intensity, ProviderId, SignalLayer };

export type Role = "admin" | "member";

export type Profile = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: Role;
  created_at: string;
};

export type KeyStatus = {
  provider: ProviderId;
  configured: boolean;
  source: "personal" | "org" | "session" | "platform" | "none";
  last_four: string | null;
  label: string | null;
  selected_model: string | null;
  kind?: "llm" | "search" | "reader";
};

export type Strategy = {
  id: number;
  user_id: string;
  title: string;
  domain: string;
  vision: string;
  horizon_start: string | null;
  horizon_end: string | null;
  delivery_rag: "green" | "amber" | "red" | "unrated";
  created_at: string;
  updated_at: string;
};

export type Assumption = {
  id: number;
  strategy_id: number;
  user_id: string;
  claim: string;
  origin: "stated" | "implicit";
  status: AssumptionStatus;
  implied_intensity: Exclude<Intensity, "no-change">;
  owner_label: string;
  last_evidence_at: string | null;
  status_changed_at: string;
  sort_order: number;
  linked_signal_ids: number[];
};

export type Signal = {
  id: number;
  strategy_id: number;
  user_id: string;
  name: string;
  category: number;
  secondary_category: number | null;
  layer: SignalLayer;
  materiality: number;
  velocity: number;
  confidence: number;
  cadence: string;
  baseline: string;
  current_value: string;
  unit: string;
  threshold_watch: string;
  threshold_amend: string;
  threshold_refresh: string;
  threshold_reset: string;
  false_positive_guard: string;
  owner_label: string;
  status: "active" | "parked" | "retired";
  last_evidence_at: string | null;
  created_at: string;
  pressure: number;
  stale: boolean;
};

export type Evidence = {
  id: number;
  strategy_id: number;
  signal_id: number | null;
  assumption_id: number | null;
  note: string;
  source_url: string;
  direction: "supporting" | "weakening";
  created_at: string;
};

export type Interrupt = {
  id: number;
  strategy_id: number;
  name: string;
  red_line: string;
  fired_at: string | null;
  review_by: string | null;
  status: "armed" | "open" | "closed";
  created_at: string;
};

export type Decision = {
  id: number;
  strategy_id: number;
  intensity: Intensity;
  summary: string;
  rationale: string;
  signal_id: number | null;
  assumption_id: number | null;
  decided_at: string;
};

export type Cliff = {
  id: number;
  strategy_id: number;
  name: string;
  cliff_date: string;
  kind: "fiscal" | "legal" | "scenario" | "review";
};

export type QueueItem = {
  id: string;
  kind: "interrupt" | "assumption" | "signal" | "divergence" | "cliff";
  title: string;
  reason: string;
  intensity_hint: Intensity;
  ref_id: number;
};

export type Metrics = {
  holding: number;
  weakening: number;
  broken: number;
  untested: number;
  integrity_share: number;
  coverage_ratio: number;
  stale_count: number;
  active_signals: number;
  sentinel_count: number;
  queue_count: number;
  days_to_cliff: number | null;
  next_cliff_name: string | null;
};

export type StrategyDocument = {
  id: number;
  filename: string;
  kind: string;
  char_count: number;
  page_count: number | null;
  chunk_count: number;
};

export type ExtractPreference = {
  provider: ProviderId;
  model: string;
};

export type Amendment = {
  id: number;
  strategy_id: number;
  intensity: Exclude<Intensity, "no-change">;
  location: string;
  original_excerpt: string;
  proposed_text: string;
  rationale: string;
  assumption_id: number | null;
  source: "monitor" | "peer";
  created_at: string;
};

export type PeerFinding = {
  id: number;
  country: string;
  title: string;
  year: string;
  url: string;
  idea: string;
  relevance: string;
  intensity: string;
  category: number | null;
};

export type PeerResearch = {
  id: number;
  recency_years: number;
  query: string;
  summary: string;
  created_at: string;
  findings: PeerFinding[];
};

export type StrategyBundle = {
  strategy: Strategy;
  assumptions: Assumption[];
  signals: Signal[];
  interrupts: Interrupt[];
  decisions: Decision[];
  cliffs: Cliff[];
  evidence: Evidence[];
  documents: StrategyDocument[];
  amendments: Amendment[];
  peer_research: PeerResearch | null;
  queue: QueueItem[];
  metrics: Metrics;
};

export type SessionKeys = Partial<Record<ProviderId, string>>;
export type SessionModels = Partial<Record<ProviderId, string>>;
