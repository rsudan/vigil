import { BUDGET, cadenceDays, pressure } from "./taxonomy.ts";
import type {
  Assumption,
  Cliff,
  CrossedLevel,
  Decision,
  Interrupt,
  Metrics,
  QueueItem,
  Signal,
  Strategy,
} from "./types.ts";

export const DAY = 86400000;

type Thresholds = Pick<Signal, "threshold_watch" | "threshold_amend" | "threshold_refresh" | "threshold_reset">;

/** The pre-committed reading for a level; empty when nothing has been crossed. */
export function thresholdText(s: Thresholds, level: CrossedLevel): string {
  if (level === "none") return "";
  return s[`threshold_${level}`];
}

export function withPressure(row: Omit<Signal, "pressure" | "stale">, now = Date.now()): Signal {
  const p = pressure(row.materiality, row.velocity, row.confidence);
  const days = cadenceDays(row.cadence);
  const ref = row.last_evidence_at ?? row.created_at;
  const ageMs = now - new Date(ref).getTime();
  const stale = Number.isFinite(ageMs) && ageMs > days * 2 * DAY;
  return { ...row, pressure: p, stale };
}

function at(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function iso(t: number) {
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Latest decision per queue-item key. Rows logged before item keys existed are
 * keyed by the ids they carried, so an old decision on an assumption or signal
 * still counts.
 */
export function latestDecisions(decisions: Decision[]): Map<string, number> {
  const map = new Map<string, number>();
  const bump = (key: string, t: number) => {
    if (!Number.isFinite(t)) return;
    if (t > (map.get(key) ?? Number.NEGATIVE_INFINITY)) map.set(key, t);
  };
  for (const d of decisions) {
    const t = at(d.decided_at);
    if (d.item_key) {
      bump(d.item_key, t);
      continue;
    }
    if (d.assumption_id) bump(`asm-${d.assumption_id}`, t);
    if (d.signal_id) {
      bump(`sig-${d.signal_id}`, t);
      bump(`sig-stale-${d.signal_id}`, t);
      bump(`sig-crossed-${d.signal_id}`, t);
    }
  }
  return map;
}

/** Urgency ranks. Higher first. The gaps leave room for tie-breaks. */
export const RANK = {
  interruptOverdue: 100,
  interruptOpen: 90,
  crossedReset: 85,
  crossedRefresh: 80,
  brokenOverdue: 78,
  broken: 75,
  cliffSoon: 70,
  crossedAmend: 65,
  weakening: 60,
  cliffNear: 55,
  divergence: 50,
  sentinelPressure: 40,
  crossedWatch: 35,
  cliffHorizon: 30,
  staleSentinel: 22,
  staleRotating: 12,
} as const;

type Candidate = QueueItem & { since_ms: number; tiebreak: number };

export type QueueResult = {
  queue: QueueItem[];
  /** Live items that did not fit in the twelve. */
  overflow: number;
  /** Items hidden because a decision was logged after their condition arose. */
  suppressed: number;
};

export function buildQueue(input: {
  strategy: Strategy;
  assumptions: Assumption[];
  signals: Signal[];
  interrupts: Interrupt[];
  cliffs: Cliff[];
  decisions?: Decision[];
  now?: number;
}): QueueResult {
  const now = input.now ?? Date.now();
  const decided = latestDecisions(input.decisions ?? []);
  const candidates: Candidate[] = [];
  const push = (c: Omit<Candidate, "since">) => candidates.push({ ...c, since: iso(c.since_ms) });

  for (const i of input.interrupts) {
    if (i.status !== "open") continue;
    const fired = at(i.fired_at) || at(i.created_at);
    const reviewBy = at(i.review_by);
    const overdue = Number.isFinite(reviewBy) && reviewBy < now;
    const firedDays = Number.isFinite(fired) ? Math.max(0, Math.round((now - fired) / DAY)) : 0;
    push({
      id: `int-${i.id}`,
      kind: "interrupt",
      title: i.name,
      ref_id: i.id,
      intensity_hint: "refresh",
      rank: overdue ? RANK.interruptOverdue : RANK.interruptOpen,
      overdue,
      reason: overdue
        ? `Red line fired ${firedDays ? `${firedDays} days ago` : "today"}; the review deadline passed ${Math.max(1, Math.round((now - reviewBy) / DAY))} days ago. Decide, then close the interrupt.`
        : `Red line fired ${firedDays ? `${firedDays} days ago` : "today"}. ${
            Number.isFinite(reviewBy) ? `${Math.max(0, Math.round((reviewBy - now) / DAY))} days left to review.` : "Review within 30 days."
          }`,
      since_ms: Number.isFinite(fired) ? fired : now,
      tiebreak: firedDays,
    });
  }

  for (const a of input.assumptions) {
    const since = at(a.status_changed_at);
    const ageDays = Number.isFinite(since) ? Math.max(0, Math.round((now - since) / DAY)) : 0;
    if (a.status === "broken") {
      const decidedSince = (decided.get(`asm-${a.id}`) ?? Number.NEGATIVE_INFINITY) > since;
      const overdue = ageDays > 14 && !decidedSince;
      push({
        id: `asm-${a.id}`,
        kind: "assumption",
        title: a.claim,
        ref_id: a.id,
        intensity_hint: a.implied_intensity,
        rank: overdue ? RANK.brokenOverdue : RANK.broken,
        overdue,
        reason: overdue
          ? `Broken for ${ageDays} days with no decision logged since. The pre-committed intensity is ${a.implied_intensity}.`
          : `Load-bearing assumption is broken. The pre-committed intensity is ${a.implied_intensity}.`,
        since_ms: Number.isFinite(since) ? since : now,
        tiebreak: ageDays,
      });
    } else if (a.status === "weakening") {
      push({
        id: `asm-${a.id}`,
        kind: "assumption",
        title: a.claim,
        ref_id: a.id,
        intensity_hint: "amend",
        rank: RANK.weakening,
        overdue: false,
        reason: `Assumption ${ageDays ? `has been weakening for ${ageDays} days` : "started weakening today"}: evidence is moving against the claim.`,
        since_ms: Number.isFinite(since) ? since : now,
        tiebreak: ageDays,
      });
    }
  }

  const active = input.signals.filter((s) => s.status === "active");
  const ranked = [...active].sort((a, b) => b.pressure - a.pressure);
  const cutoffIndex = Math.max(0, Math.ceil(ranked.length * 0.25) - 1);
  const cutoff = ranked[cutoffIndex]?.pressure ?? Number.POSITIVE_INFINITY;
  for (const s of ranked) {
    const updated = at(s.updated_at) || at(s.created_at);
    const evidenceAt = at(s.last_evidence_at) || at(s.created_at);
    const evidenceDays = Number.isFinite(evidenceAt) ? Math.max(0, Math.round((now - evidenceAt) / DAY)) : 0;
    const cadence = cadenceDays(s.cadence);
    if (s.crossed_level !== "none") {
      const level = s.crossed_level;
      const rank =
        level === "reset"
          ? RANK.crossedReset
          : level === "refresh"
            ? RANK.crossedRefresh
            : level === "amend"
              ? RANK.crossedAmend
              : RANK.crossedWatch;
      const threshold = s[`threshold_${level}`] || "threshold not written down";
      push({
        id: `sig-crossed-${s.id}`,
        kind: "signal",
        title: s.name,
        ref_id: s.id,
        intensity_hint: level,
        rank,
        overdue: false,
        reason: `Reading “${s.current_value || "—"}” has crossed the ${level} threshold (${threshold}).${
          s.stale ? ` The reading is also ${evidenceDays} days old.` : ""
        }`,
        since_ms: Number.isFinite(updated) ? updated : now,
        tiebreak: s.pressure,
      });
    } else if (s.stale) {
      push({
        id: `sig-stale-${s.id}`,
        kind: "signal",
        title: s.name,
        ref_id: s.id,
        intensity_hint: "watch",
        rank: s.layer === "sentinel" ? RANK.staleSentinel : RANK.staleRotating,
        overdue: false,
        reason: `Evidence is ${evidenceDays} days old, more than twice the ${s.cadence} cadence (${cadence} days). Record a reading before calling this room calm.`,
        since_ms: now - cadence * DAY,
        tiebreak: s.pressure,
      });
    } else if (s.layer === "sentinel" && s.pressure >= cutoff) {
      push({
        id: `sig-${s.id}`,
        kind: "signal",
        title: s.name,
        ref_id: s.id,
        intensity_hint: "watch",
        rank: RANK.sentinelPressure + Math.round((s.pressure / 125) * 9),
        overdue: false,
        reason: `Sentinel in the top quarter of pressure: ${s.pressure}/125 = M${s.materiality} × V${s.velocity} × (6 − C${s.confidence}). Look at it in the sitting even if delivery is on track.`,
        since_ms: Number.isFinite(updated) ? updated : now,
        tiebreak: s.pressure,
      });
    }
  }

  const moving = input.assumptions.filter((a) => a.status === "weakening" || a.status === "broken");
  if (input.strategy.delivery_rag === "green" && moving.length) {
    const since = Math.max(...moving.map((a) => at(a.status_changed_at)).filter(Number.isFinite));
    push({
      id: "div-1",
      kind: "divergence",
      title: "Delivery is green; the logic is not",
      ref_id: 0,
      intensity_hint: "amend",
      rank: RANK.divergence,
      overdue: false,
      reason: `Activity is on track while ${moving.length} load-bearing bet${moving.length > 1 ? "s are" : " is"} weakening or broken. Green delivery over a weakening logic is the dangerous cell.`,
      since_ms: Number.isFinite(since) ? since : now,
      tiebreak: moving.length,
    });
  }

  for (const c of input.cliffs) {
    const t = at(c.cliff_date);
    if (!Number.isFinite(t)) continue;
    const days = Math.round((t - now) / DAY);
    if (days > 180) continue;
    if (days < 0) {
      push({
        id: `cliff-${c.id}`,
        kind: "cliff",
        title: c.name,
        ref_id: c.id,
        intensity_hint: "refresh",
        rank: RANK.cliffSoon,
        overdue: true,
        reason: `Cliff passed ${Math.abs(days)} days ago. Decide what replaced it, then remove it from the horizon.`,
        since_ms: t,
        tiebreak: days,
      });
      continue;
    }
    push({
      id: `cliff-${c.id}`,
      kind: "cliff",
      title: c.name,
      ref_id: c.id,
      intensity_hint: days <= 90 ? "refresh" : "watch",
      rank: days <= 30 ? RANK.cliffSoon : days <= 90 ? RANK.cliffNear : RANK.cliffHorizon,
      overdue: false,
      reason: `${days} days to the ${c.kind} cliff (${c.cliff_date}).`,
      // A decision on an approaching cliff holds for a month, then it resurfaces.
      since_ms: now - 30 * DAY,
      tiebreak: -days,
    });
  }

  let suppressed = 0;
  const live = candidates.filter((c) => {
    const d = decided.get(c.id);
    if (d !== undefined && d > c.since_ms) {
      suppressed += 1;
      return false;
    }
    return true;
  });
  live.sort((a, b) => b.rank - a.rank || b.tiebreak - a.tiebreak);
  const queue = live.slice(0, BUDGET.maxQueue).map(({ since_ms: _s, tiebreak: _t, ...item }) => item);
  return { queue, overflow: Math.max(0, live.length - BUDGET.maxQueue), suppressed };
}

export function buildMetrics(input: {
  assumptions: Assumption[];
  signals: Signal[];
  cliffs: Cliff[];
  interrupts: Interrupt[];
  queue: QueueResult;
  now?: number;
}): Metrics {
  const now = input.now ?? Date.now();
  const holding = input.assumptions.filter((a) => a.status === "holding").length;
  const weakening = input.assumptions.filter((a) => a.status === "weakening").length;
  const broken = input.assumptions.filter((a) => a.status === "broken").length;
  const untested = input.assumptions.filter((a) => a.status === "untested").length;
  const total = input.assumptions.length || 1;
  const active = input.signals.filter((s) => s.status === "active");
  const sentinels = active.filter((s) => s.layer === "sentinel");
  const withSentinel = input.assumptions.filter((a) =>
    a.linked_signal_ids.some((id) => sentinels.some((s) => s.id === id)),
  ).length;
  const startOfToday = now - (now % DAY);
  const nextCliff = input.cliffs
    .map((c) => ({ c, t: at(c.cliff_date) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= startOfToday)
    .sort((a, b) => a.t - b.t)[0];
  const open = input.interrupts.filter((i) => i.status === "open");
  const overdue = open.filter((i) => {
    const t = at(i.review_by);
    return Number.isFinite(t) && t < now;
  });

  return {
    holding,
    weakening,
    broken,
    untested,
    integrity_share: holding / total,
    coverage_ratio: input.assumptions.length ? withSentinel / input.assumptions.length : 0,
    stale_count: active.filter((s) => s.stale).length,
    active_signals: active.length,
    sentinel_count: sentinels.length,
    crossed_count: active.filter((s) => s.crossed_level !== "none").length,
    queue_count: input.queue.queue.length,
    queue_overflow: input.queue.overflow,
    queue_suppressed: input.queue.suppressed,
    open_interrupts: open.length,
    overdue_interrupts: overdue.length,
    days_to_cliff: nextCliff ? Math.round((nextCliff.t - now) / DAY) : null,
    next_cliff_name: nextCliff?.c.name ?? null,
  };
}
