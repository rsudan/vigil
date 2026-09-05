import { CATEGORY_GUIDE } from "./category-guide.ts";
import { fold } from "./room-read.ts";
import { tokenize } from "./server/retrieval.ts";
import type { Signal } from "./types.ts";

/** The day the ten rooms were re-scoped to fit any sector, as shown and as compared. */
export const ROOM_SCOPES_CHANGED = "6 September 2026";
export const ROOM_SCOPES_CHANGED_AT = Date.parse("2026-09-06T00:00:00Z");

/** A room must beat the watchpoint's own room by this many words before it is worth mentioning. */
export const FIT_MARGIN = 2;

export type RoomFit = { signal: Signal; suggested: number; hits: number; own: number };

/**
 * Watchpoints whose own words point to a different room than the one they sit
 * in. Computed from the room vocabulary alone, so it is a hint for a person and
 * never a move: the room a watchpoint was given is a decision, and this only
 * asks whether the re-scoped rooms make that decision worth a second look.
 * Only watchpoints filed before the re-scope are considered: one filed since was
 * placed under the new rooms, and disagreeing with it is not this list's job.
 */
export function roomFits(signals: Signal[]): RoomFit[] {
  const rooms = CATEGORY_GUIDE.map((g) => ({ id: g.id, terms: new Set(tokenize(g.terms).map(fold)) }));
  const out: RoomFit[] = [];
  for (const s of signals) {
    if (s.status !== "active") continue;
    const filed = Date.parse(s.created_at);
    if (Number.isFinite(filed) && filed >= ROOM_SCOPES_CHANGED_AT) continue;
    const words = new Set(
      tokenize([s.name, s.threshold_watch, s.threshold_amend, s.threshold_refresh, s.threshold_reset].join(" ")).map(fold),
    );
    const scores = rooms.map((r) => ({ id: r.id, hits: [...r.terms].filter((t) => words.has(t)).length }));
    const own = scores.find((x) => x.id === s.category)?.hits ?? 0;
    const best = [...scores].sort((a, b) => b.hits - a.hits || a.id - b.id)[0]!;
    if (best.id === s.category || best.id === s.secondary_category) continue;
    if (best.hits < FIT_MARGIN || best.hits < own + FIT_MARGIN) continue;
    out.push({ signal: s, suggested: best.id, hits: best.hits, own });
  }
  return out;
}
