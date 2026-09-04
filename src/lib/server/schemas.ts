import { z } from "zod";
import {
  ASSUMPTION_ORIGINS,
  ASSUMPTION_STATUSES,
  CADENCES,
  CLIFF_KINDS,
  CROSSED_LEVELS,
  DELIVERY_RAGS,
  EVIDENCE_DIRECTIONS,
  INTENSITIES,
  PROVIDERS,
  RATING_METHODS,
  REVISION_INTENSITIES,
  SIGNAL_LAYERS,
  SIGNAL_STATUSES,
  type ProviderId,
} from "@/lib/taxonomy";

/**
 * Runtime validation for every server function input. The DB check constraints
 * are the last line; these are the first, and they produce readable errors.
 */
export function validate<T>(schema: z.ZodType<T>) {
  return (input: unknown): T => {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    const detail = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid input — ${detail}`);
  };
}

const id = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const optDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), dateStr.optional());
const nullableDate = z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional());
const providerIds = PROVIDERS.map((p) => p.id) as [ProviderId, ...ProviderId[]];
export const providerId = z.enum(providerIds);
export const sessionKeys = z.partialRecord(providerId, z.string().max(500)).optional();
const scale = z.number().int().min(1).max(5);
const category = z.number().int().min(1).max(10);

export const chunkSchema = z.object({
  index: z.number().int().min(0),
  heading: text(240),
  body: z.string().max(20000),
});

export const strategies = {
  create: z.object({
    title: text(240).min(1, "Title is required"),
    domain: optText(120),
    vision: optText(2000),
    language: optText(60),
    jurisdiction: optText(120),
    horizon_start: optDate,
    horizon_end: optDate,
  }),
  update: z.object({
    id,
    title: text(240).min(1).optional(),
    domain: optText(120),
    vision: optText(2000),
    language: optText(60),
    jurisdiction: optText(120),
    horizon_start: nullableDate,
    horizon_end: nullableDate,
  }),
  // Delivery is rated only here, never through update, so every colour has a basis.
  assess: z
    .object({
      strategy_id: id,
      delivery: z
        .object({
          rag: z.enum(DELIVERY_RAGS),
          basis: text(2000),
          source_label: optText(200),
          source_url: optText(500),
          as_of: optDate,
          method: z.enum(RATING_METHODS).optional(),
        })
        .optional(),
      bets: z
        .array(
          z.object({
            id,
            // Absent when the row only files a note: the status on record stays as it is.
            status: z.enum(ASSUMPTION_STATUSES).optional(),
            note: text(4000),
            direction: z.enum(EVIDENCE_DIRECTIONS).optional(),
            source_url: optText(500),
            method: z.enum(RATING_METHODS).optional(),
          }),
        )
        .max(12)
        .optional(),
    })
    .refine((v) => Boolean(v.delivery) || Boolean(v.bets && v.bets.length), "Rate delivery or change at least one bet."),
  byId: z.object({ id }),
  scoped: z.object({ strategy_id: id, id }),
  upsertAssumption: z.object({
    strategy_id: id,
    id: id.optional(),
    claim: text(800).min(3, "Write the claim"),
    origin: z.enum(ASSUMPTION_ORIGINS),
    implied_intensity: z.enum(REVISION_INTENSITIES),
    owner_label: optText(80),
  }),
  setAssumptionStatus: z.object({
    strategy_id: id,
    id,
    status: z.enum(ASSUMPTION_STATUSES),
    note: text(4000),
    direction: z.enum(EVIDENCE_DIRECTIONS).optional(),
    source_url: optText(500),
  }),
  upsertSignal: z.object({
    strategy_id: id,
    id: id.optional(),
    name: text(180).min(1, "Name the signal"),
    category,
    secondary_category: category.nullable().optional(),
    layer: z.enum(SIGNAL_LAYERS),
    materiality: scale,
    velocity: scale,
    confidence: scale,
    cadence: z.enum(CADENCES),
    baseline: optText(400),
    current_value: optText(400),
    unit: optText(40),
    threshold_watch: optText(240),
    threshold_amend: optText(240),
    threshold_refresh: optText(240),
    threshold_reset: optText(240),
    false_positive_guard: optText(400),
    owner_label: optText(80),
    status: z.enum(SIGNAL_STATUSES).optional(),
    crossed_level: z.enum(CROSSED_LEVELS).optional(),
    linked_assumption_ids: z.array(id).max(12).optional(),
  }),
  recordReading: z.object({
    strategy_id: id,
    signal_id: id,
    current_value: optText(400),
    note: text(4000),
    direction: z.enum(EVIDENCE_DIRECTIONS),
    crossed_level: z.enum(CROSSED_LEVELS).optional(),
    source_url: optText(500),
  }),
  fireInterrupt: z.object({
    strategy_id: id,
    id,
    review_days: z.number().int().min(1).max(365).optional(),
  }),
  addInterrupt: z.object({
    strategy_id: id,
    name: text(180).min(1, "Name the red line"),
    red_line: text(400).min(1, "Describe the red line"),
    category: category.nullable().optional(),
  }),
  setInterruptRoom: z.object({ strategy_id: id, id, category: category.nullable() }),
  logDecision: z.object({
    strategy_id: id,
    intensity: z.enum(INTENSITIES),
    summary: text(180),
    rationale: text(4000).min(1, "A rationale is required"),
    item_key: optText(60),
    signal_id: id.nullable().optional(),
    assumption_id: id.nullable().optional(),
  }),
  addCliff: z.object({
    strategy_id: id,
    name: text(180).min(1, "Name the cliff"),
    cliff_date: dateStr,
    kind: z.enum(CLIFF_KINDS),
  }),
  addMember: z.object({
    strategy_id: id,
    email: z.string().trim().toLowerCase().email().max(200),
    role: z.enum(["editor", "viewer"]),
  }),
  removeMember: z.object({ strategy_id: id, user_id: text(200).min(1) }),
};

export const rooms = {
  read: z.object({ strategy_id: id }),
  search: z.object({
    strategy_id: id,
    category,
    recency_years: z.number().int().min(1).max(10),
    sessionKeys,
  }),
  decide: z.object({
    strategy_id: id,
    id,
    status: z.enum(["kept", "dismissed"]),
    rationale: optText(2000),
  }),
};

export const keys = {
  savePersonal: z.object({
    provider: providerId,
    secret: z.string().trim().min(8, "That key looks too short").max(500),
    label: optText(80),
    selected_model: optText(120),
  }),
  provider: z.object({ provider: providerId }),
  saveOrg: z.object({
    provider: providerId,
    secret: z.string().trim().min(8, "That key looks too short").max(500),
    label: optText(80),
  }),
  grants: z.object({ credential_id: id, grantee_user_ids: z.array(text(200).min(1)).max(500) }),
  credential: z.object({ credential_id: id }),
  test: z.object({ provider: providerId, secret: z.string().max(500).optional(), sessionKeys }),
  selectModel: z.object({ provider: providerId, model: text(120).min(1) }),
  extractPreference: z.object({ provider: providerId, model: text(120).min(1) }),
};

export const profiles = {
  setRole: z.object({ user_id: text(200).min(1), role: z.enum(["admin", "member"]) }),
};

const documentSchema = z.object({
  name: text(255).min(1),
  kind: optText(40),
  pages: z.number().int().positive().nullable().optional(),
  chunks: z.array(chunkSchema).max(4000),
});

export const ai = {
  ingestUrl: z.object({
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs can be read"),
    sessionKeys,
  }),
  parseDocuments: z.object({
    files: z
      .array(z.object({ name: text(255).min(1), base64: z.string().max(17_000_000) }))
      .min(1, "No files received")
      .max(8, "Up to eight files at a time"),
  }),
  extract: z.object({
    strategy_id: id.optional(),
    title: optText(240),
    domain: optText(120),
    vision: optText(2000),
    language: optText(60),
    jurisdiction: optText(120),
    horizon_start: optDate,
    horizon_end: optDate,
    text: z.string().max(3_000_000),
    chunks: z.array(chunkSchema).max(4000).optional(),
    documents: z.array(documentSchema).max(8).optional(),
    provider: z.string().max(40).optional(),
    model: z.string().max(120).optional(),
    sessionKeys,
  }),
  search: z.object({ query: text(400).min(2), sessionKeys }),
};

export const research = {
  draft: z.object({ strategy_id: id, sessionKeys }),
  propose: z.object({ strategy_id: id, sessionKeys }),
  peers: z.object({ strategy_id: id, recency_years: z.number().int().min(1).max(10), sessionKeys }),
};
