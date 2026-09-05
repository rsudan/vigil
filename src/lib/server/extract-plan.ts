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
  "jurisdiction": "the country, or the organisation, that adopted this strategy, e.g. Romania",
  "vision": string,
  "language": "the language the document is written in, e.g. Romanian",
  "horizon_start": "YYYY-MM-DD" or null,
  "horizon_end": "YYYY-MM-DD" or null,
  "assumptions": [{ "claim": string, "origin": "stated" or "implicit", "implied_intensity": "watch"|"amend"|"refresh"|"reset", "owner_label": string }],
  "signals": [{ "name": string, "category": 1-10, "secondary_category": null or 1-10, "layer": "sentinel"|"rotating", "materiality":1-5, "velocity":1-5, "confidence":1-5, "cadence":"monthly"|"quarterly"|"annual"|"event-driven"|"continuous", "baseline": string, "current_value": string, "threshold_watch": string, "threshold_amend": string, "threshold_refresh": string, "threshold_reset": string, "false_positive_guard": string, "owner_label": string, "assumption_indexes": number[] }],
  "interrupts": [{ "name": string, "red_line": string, "category": 1-10 }],
  "cliffs": [{ "name": string, "cliff_date": "YYYY-MM-DD", "kind": "fiscal"|"legal"|"scenario"|"review" }]
}`;

export function extractionPrompt(text: string, part?: { index: number; total: number }) {
  const partNote = part
    ? `\n\nThis is PART ${part.index} OF ${part.total} of the document. Extract what this part supports; the parts will be consolidated afterwards. If this part is only annexes or tables, extract the signals and cliffs they contain and leave title, vision and horizon empty.`
    : "";
  return `Extract a living-strategy monitoring architecture from this strategy.${partNote}

Return ONLY JSON with this shape:
${EXTRACTION_SHAPE}

Rules:
- 6–12 load-bearing assumptions: bets that, if false, would change the document. Not activities, not hopes. Include the implicit bets the authors never wrote down (a coordinating body keeps sitting, money continues past a funding window, a platform stays in production).
- 10–16 signals. Cover as many of the ten rooms as the document supports. At most 8 are sentinels (the readings that would actually force a rewrite); the rest are rotating. If the document is genuinely silent on a room, leave that room empty rather than invent a watchpoint.
- Every signal names the reading that would justify watch / amend / refresh / reset (leave a level empty if none makes sense) and a false-positive guard: the sentence that stops a local blip being read as failure of the whole.
- Rooms: 1 External (the world outside the plan, and rules set by bodies its owner cannot change), 2 Technology (the systems and data it relies on, and new capabilities that change what is possible), 3 Assumptions (its causal story and stated preconditions), 4 Delivery (whether the work is done as written), 5 Resources (money, people, funder conditions), 6 Mandate (rules the owner can change, coordinating bodies, domestic law), 7 Legitimacy (who actually benefits), 8 Risks (events that should reopen the document), 9 Evidence (evaluations, peers, non-binding frameworks, adjacent strategies), 10 Opportunity (windows with a date). The same ten for any sector; nothing assumes disaster risk.
- Tie-breakers, in these words: a rule made inside the legal order of the jurisdiction named above (its legislature, government or courts, even when the owner is not the body that makes it) is 6, a rule made above or outside that jurisdiction is 1, and the domestic law transposing a rule from above is 6; a dated event that crosses a line is 8, a slow trend is 1; evidence about whether THIS plan's causal chain works is 3 even from abroad, what another jurisdiction did or an outcome evaluation or mid-term review judging whether this strategy's design worked is 9, and progress, implementation and audit reports on this strategy are 4; a technology development is 2, and 10 only when it comes with a dated application or closing window; what another jurisdiction did or learned is 9, and 10 only when it is an instrument or window open to this owner with a date.
- Interrupts are red lines agreed in advance (a loss above a threshold, a platform dark for weeks, a mandate withdrawn). Give each the room whose question it answers: a coordinating body that stops sitting is 6, a platform dark is 2, funding withdrawn is 5, a loss or an event above an agreed threshold is 8, a court ruling that stops a named instrument is 8. Cliffs are dated events: funding sunsets, legal deadlines, scheduled review windows; their kind places them.
- Dates MUST be full YYYY-MM-DD (use 01 January / 31 December if the text only gives a year). Never a year alone.
- Write "NO BASELINE" as current_value when the document names a system or indicator but never measures it.
- assumption_indexes are 0-based indexes into assumptions.
- Ground every claim in the text. Where you can, name the chapter, annex, or page in baseline.
- jurisdiction is whose strategy this is: the country or the organisation that adopted it. Read it off the title, the adopting instrument or the gazette line. Leave it empty only if the document truly never says.
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
  for (const key of ["title", "domain", "jurisdiction", "vision", "language", "horizon_start", "horizon_end"]) {
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
