import type {
  AssumptionStatus,
  CrossedLevel,
  Intensity,
  MemberRole,
  ProviderId,
  RevisionIntensity,
  SignalLayer,
  SignalStatus,
} from "./taxonomy.ts";

export type { AssumptionStatus, CrossedLevel, Intensity, MemberRole, ProviderId, RevisionIntensity, SignalLayer };

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
  /** Language of the official document, e.g. "Romanian". Amendments are drafted in it. */
  language: string;
  /**
   * Whose strategy this is: a country, or the organisation that adopted it. A
   * room cannot ask the world what has changed without naming it.
   */
  jurisdiction: string;
  /** How much of the source the extraction read, and with what. Empty for hand-built strategies. */
  extraction_note: string;
  horizon_start: string | null;
  horizon_end: string | null;
  delivery_rag: "green" | "amber" | "red" | "unrated";
  created_at: string;
  updated_at: string;
};

/** What the portfolio page needs to say "this one needs you" without opening it. */
export type Attention = {
  queue_count: number;
  queue_overflow: number;
  open_interrupts: number;
  overdue_interrupts: number;
  stale_sentinels: number;
  crossed: number;
  broken: number;
  weakening: number;
  next_cliff_days: number | null;
  next_cliff_name: string | null;
};

export type StrategySummary = Strategy & { my_role: MemberRole; attention: Attention; validity: Validity };

export type Assumption = {
  id: number;
  strategy_id: number;
  user_id: string;
  claim: string;
  origin: "stated" | "implicit";
  status: AssumptionStatus;
  implied_intensity: RevisionIntensity;
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
  status: SignalStatus;
  /** Which pre-committed threshold the latest reading has crossed. Set by the reviewer. */
  crossed_level: CrossedLevel;
  last_evidence_at: string | null;
  created_at: string;
  updated_at: string;
  pressure: number;
  stale: boolean;
};

export type Evidence = {
  id: number;
  strategy_id: number;
  user_id: string;
  signal_id: number | null;
  assumption_id: number | null;
  note: string;
  /** The signal value recorded with this evidence, when it is a reading. */
  reading: string;
  source_url: string;
  direction: "supporting" | "weakening" | "neutral";
  /** "desk" when a model drafted the note and a person accepted it. */
  method: "person" | "desk";
  created_at: string;
  author: string | null;
};

/** One delivery rating: a colour with who, when, and what report it rests on. Append-only. */
export type DeliveryRating = {
  id: number;
  strategy_id: number;
  user_id: string;
  rag: "green" | "amber" | "red" | "unrated";
  basis: string;
  source_label: string;
  source_url: string;
  as_of: string | null;
  method: "person" | "desk";
  created_at: string;
  author: string | null;
};

export type ValidityLevel = "not-assessed" | "partly-checked" | "holding" | "weakening" | "broken";

/** The colour of the bets, derived from their statuses; see validityOf(). */
export type Validity = {
  rag: "green" | "amber" | "red" | "unrated";
  level: ValidityLevel;
  label: string;
  meaning: string;
  reason: string;
  holding: number;
  weakening: number;
  broken: number;
  untested: number;
  total: number;
  checked: number;
};

/** What a model proposes for an assessment. Nothing here is saved until a person accepts it. */
export type AssessmentProposal = {
  delivery: {
    rag: "green" | "amber" | "red" | "unrated";
    basis: string;
    source_label: string;
    rests_on: string;
    excerpt: string;
    excerpt_verified: boolean | null;
  } | null;
  bets: {
    assumption_id: number;
    status: AssumptionStatus;
    note: string;
    rests_on: string;
    excerpt: string;
    excerpt_verified: boolean | null;
    settles_it: string;
  }[];
  grounded: number;
  desk_only: number;
  progress_on_file: boolean;
};

export type Interrupt = {
  id: number;
  strategy_id: number;
  name: string;
  red_line: string;
  /** The room this red line belongs to. Null reads as Risks (8) until someone sets it. */
  category: number | null;
  fired_at: string | null;
  review_by: string | null;
  status: "armed" | "open" | "closed";
  created_at: string;
};

export type Decision = {
  id: number;
  strategy_id: number;
  user_id: string;
  intensity: Intensity;
  summary: string;
  rationale: string;
  /** The queue item this decision answered (e.g. "asm-4"). Empty for free-standing decisions. */
  item_key: string;
  signal_id: number | null;
  assumption_id: number | null;
  decided_at: string;
  author: string | null;
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
  /** Urgency used to order the queue; higher first. */
  rank: number;
  /** When the condition behind this item last changed; a decision logged after it clears the item. */
  since: string;
  overdue: boolean;
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
  crossed_count: number;
  queue_count: number;
  /** Ranked items that did not fit in the queue of twelve. */
  queue_overflow: number;
  /** Items hidden because a decision was logged after the condition arose. */
  queue_suppressed: number;
  open_interrupts: number;
  overdue_interrupts: number;
  days_to_cliff: number | null;
  next_cliff_name: string | null;
};

/** A verbatim sentence the document gives for one room, and the page it sits on. */
export type RoomPassage = {
  id: number;
  category: number;
  rank: number;
  locator: string;
  quote: string;
  terms_hit: number;
  read_at: string;
};

/** When a room was last read out of the document, including the rooms that said nothing. */
export type RoomRead = {
  category: number;
  read_at: string;
  passages: number;
  /** false when the room's terms match nothing in this text: a failed search, not a silent document. */
  terms_matched: boolean;
};

/** Something the world says about one room. A proposal until a person keeps it. */
export type RoomFinding = {
  id: number;
  category: number;
  title: string;
  url: string;
  published_date: string;
  quote: string;
  /** true = the quotation was found in the text the search returned; false = not found; null = nothing to check. */
  quote_verified: boolean | null;
  why: string;
  query: string;
  searched_at: string;
  status: "proposed" | "kept" | "dismissed";
  decided_at: string | null;
  rationale: string;
  /** Who ran the search. */
  author: string | null;
  /** Who kept or dismissed it. */
  decided_author: string | null;
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
  intensity: RevisionIntensity;
  location: string;
  original_excerpt: string;
  proposed_text: string;
  rationale: string;
  assumption_id: number | null;
  source: "monitor" | "peer";
  /** true = the quoted excerpt was found in the stored text; false = not found; null = nothing to check. */
  excerpt_verified: boolean | null;
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

export type Member = {
  user_id: string;
  role: MemberRole;
  email: string | null;
  display_name: string | null;
};

export type StrategyBundle = {
  strategy: Strategy;
  my_role: MemberRole;
  members: Member[];
  /** Latest first, at most twenty. The first row is the current delivery rating. */
  delivery_ratings: DeliveryRating[];
  assumptions: Assumption[];
  signals: Signal[];
  interrupts: Interrupt[];
  decisions: Decision[];
  cliffs: Cliff[];
  evidence: Evidence[];
  documents: StrategyDocument[];
  amendments: Amendment[];
  peer_research: PeerResearch | null;
  room_passages: RoomPassage[];
  room_reads: RoomRead[];
  room_findings: RoomFinding[];
  queue: QueueItem[];
  metrics: Metrics;
};

export type SessionKeys = Partial<Record<ProviderId, string>>;
export type SessionModels = Partial<Record<ProviderId, string>>;
