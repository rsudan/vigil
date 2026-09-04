import type { ParsedChunk } from "../chunk.ts";
import type { LlmProviderId } from "../taxonomy.ts";

/**
 * How many characters of source text each provider's default model can read in
 * one call, with headroom for the prompt and the JSON reply. Longer documents
 * are read in several passes and consolidated, so the whole text is always
 * used. VIGIL_EXTRACT_CHARS caps every provider (useful for tests).
 */
const PROVIDER_CHARS: Record<LlmProviderId, number> = {
  xai: 1_500_000,
  gemini: 1_500_000,
  anthropic: 600_000,
  openai: 350_000,
  openrouter: 350_000,
  perplexity: 350_000,
};

export function extractBudget(provider: LlmProviderId): number {
  const env = Number(process.env.VIGIL_EXTRACT_CHARS);
  const cap = Number.isFinite(env) && env >= 20_000 ? env : Number.POSITIVE_INFINITY;
  return Math.min(PROVIDER_CHARS[provider], cap);
}

export type Window = { text: string; chars: number };

/** Characters of source text a chunk carries (heading plus body). */
export function chunkChars(c: ParsedChunk) {
  return c.heading.length + c.body.length;
}

/** Group chunks into windows of at most `budget` characters, keeping headings. */
export function windowsOf(chunks: ParsedChunk[], budget: number): Window[] {
  const out: Window[] = [];
  let buf: string[] = [];
  let size = 0;
  let chars = 0;
  const flush = () => {
    if (buf.length) out.push({ text: buf.join("\n\n"), chars });
    buf = [];
    size = 0;
    chars = 0;
  };
  for (const c of chunks) {
    const piece = `----- ${c.heading} -----\n${c.body}`;
    if (buf.length && size + piece.length + 2 > budget) flush();
    // A single chunk larger than the budget is cut rather than dropped.
    buf.push(piece.length > budget ? piece.slice(0, budget) : piece);
    size += Math.min(piece.length, budget) + 2;
    chars += Math.min(chunkChars(c), budget);
  }
  flush();
  return out;
}

export const EXTRACTION_SHAPE = `{
  "title": string,
  "domain": string,
  "vision": string,
  "language": "the language the document is written in, e.g. Romanian",
  "horizon_start": "YYYY-MM-DD" or null,
  "horizon_end": "YYYY-MM-DD" or null,
  "assumptions": [{ "claim": string, "origin": "stated" or "implicit", "implied_intensity": "watch"|"amend"|"refresh"|"reset", "owner_label": string }],
  "signals": [{ "name": string, "category": 1-10, "secondary_category": null or 1-10, "layer": "sentinel"|"rotating", "materiality":1-5, "velocity":1-5, "confidence":1-5, "cadence":"monthly"|"quarterly"|"annual"|"event-driven"|"continuous", "baseline": string, "current_value": string, "threshold_watch": string, "threshold_amend": string, "threshold_refresh": string, "threshold_reset": string, "false_positive_guard": string, "owner_label": string, "assumption_indexes": number[] }],
  "interrupts": [{ "name": string, "red_line": string }],
  "cliffs": [{ "name": string, "cliff_date": "YYYY-MM-DD", "kind": "fiscal"|"legal"|"scenario"|"review" }]
}`;

export function extractionPrompt(text: string, part?: { index: number; total: number }) {
  const partNote = part
    ? `\n\nThis is PART ${part.index} OF ${part.total} of the document. Extract what this part supports; the parts will be consolidated afterwards. If this part is only annexes or tables, extract the signals and cliffs they contain and leave title, vision and horizon empty.`
    : "";
  return `Extract a living-strategy monitoring architecture from this national or sectoral strategy.${partNote}

Return ONLY JSON with this shape:
${EXTRACTION_SHAPE}

Rules:
- 6–12 load-bearing assumptions: bets that, if false, would change the document. Not activities, not hopes. Include the implicit bets the authors never wrote down (a coordinating body keeps sitting, money continues past a funding window, a platform stays in production).
- 10–16 signals. Cover as many of the ten rooms as the document supports. At most 8 are sentinels (the readings that would actually force a rewrite); the rest are rotating. If the document is genuinely silent on a room, leave that room empty rather than invent a watchpoint.
- Every signal names the reading that would justify watch / amend / refresh / reset (leave a level empty if none makes sense) and a false-positive guard: the sentence that stops a local blip being read as national failure.
- Categories: 1 External, 2 Technology/data, 3 Assumptions/ToC, 4 Delivery, 5 Resources, 6 Mandate/legal, 7 Legitimacy, 8 Risks, 9 Evidence/adjacent, 10 Opportunity. Technology (2) is first-class.
- Interrupts are red lines agreed in advance (a loss above a threshold, a platform dark for weeks, a mandate withdrawn). Cliffs are dated events: funding sunsets, legal deadlines, scheduled review windows.
- Dates MUST be full YYYY-MM-DD (use 01 January / 31 December if the text only gives a year). Never a year alone.
- Write "NO BASELINE" as current_value when the document names a system or indicator but never measures it.
- assumption_indexes are 0-based indexes into assumptions.
- Ground every claim in the text. Where you can, name the chapter, annex, or page in baseline.
- Write in English; keep institution names and proper nouns as they appear in the document.

STRATEGY TEXT:
${text}`;
}

export function consolidationPrompt(candidates: Record<string, unknown>[]) {
  return `Several passes over one long strategy each produced a partial monitoring architecture. Merge them into ONE.

Return ONLY JSON with this shape:
${EXTRACTION_SHAPE}

Rules:
- Keep the title, domain, vision, language and horizon from whichever pass had them.
- Merge duplicate assumptions and signals (same bet or watchpoint in different words) into one, keeping the more specific thresholds and baselines.
- At most 12 assumptions and 16 signals, of which at most 8 sentinels. Prefer the bets and readings that would actually force a rewrite.
- Keep every distinct interrupt and cliff, deduplicated. Re-number assumption_indexes against the merged assumptions list.

CANDIDATES:
${JSON.stringify(candidates)}`;
}

export type ExtractionRun = {
  parsed: Record<string, unknown>;
  /** Source characters in the passes that succeeded. */
  chars_read: number;
  /** Source characters in the whole document. */
  total_chars: number;
  passes: number;
  consolidated: boolean;
  failed_parts: number[];
};

export function extractionNote(run: ExtractionRun, pages: number | null, llm: { provider: string; model: string }) {
  const when = new Date().toISOString().slice(0, 10);
  const totalChars = run.total_chars;
  const coverage = run.chars_read >= totalChars ? `all ${totalChars.toLocaleString()}` : `${run.chars_read.toLocaleString()} of ${totalChars.toLocaleString()}`;
  const passes =
    run.passes === 1
      ? "in one pass"
      : `in ${run.passes - (run.consolidated ? 1 : 0)} passes${run.consolidated ? " plus a consolidation pass" : ", merged without a model"}`;
  const failed = run.failed_parts.length ? ` Part${run.failed_parts.length > 1 ? "s" : ""} ${run.failed_parts.join(", ")} failed and ${run.failed_parts.length > 1 ? "were" : "was"} skipped.` : "";
  return `Extraction read ${coverage} characters${pages ? ` (${pages} pages)` : ""} ${passes} with ${llm.provider}/${llm.model} on ${when}.${failed}`;
}

const LIST_KEYS = ["assumptions", "signals", "interrupts", "cliffs"] as const;

/** Merge partial extractions without a model: first non-empty scalar wins, lists are deduplicated by name or claim. */
export function mergePartials(parts: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const key of ["title", "domain", "vision", "language", "horizon_start", "horizon_end"]) {
    merged[key] = parts.map((p) => p[key]).find((v) => typeof v === "string" && v.trim()) ?? null;
  }
  const caps = { assumptions: 12, signals: 16, interrupts: 8, cliffs: 8 } as const;
  const offsets: number[] = [];
  let running = 0;
  for (const p of parts) {
    offsets.push(running);
    running += Array.isArray(p.assumptions) ? p.assumptions.length : 0;
  }
  const keptAssumptionIndex = new Map<number, number>();
  for (const key of LIST_KEYS) {
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    parts.forEach((p, pi) => {
      const list = Array.isArray(p[key]) ? (p[key] as Record<string, unknown>[]) : [];
      list.forEach((raw, ii) => {
        let item = raw;
        if (!item || typeof item !== "object") return;
        const label = String(item.claim ?? item.name ?? "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        if (!label || seen.has(label) || out.length >= caps[key]) return;
        seen.add(label);
        if (key === "assumptions") keptAssumptionIndex.set(offsets[pi]! + ii, out.length);
        if (key === "signals") {
          const idx = Array.isArray(item.assumption_indexes) ? (item.assumption_indexes as unknown[]) : [];
          item = {
            ...item,
            assumption_indexes: idx
              .map((i) => keptAssumptionIndex.get(offsets[pi]! + Number(i)))
              .filter((i): i is number => typeof i === "number"),
          };
        }
        out.push(item);
      });
    });
    merged[key] = out;
  }
  return merged;
}
