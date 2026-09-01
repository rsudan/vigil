import { BUDGET, cadenceDays, pressure } from "./taxonomy";
import type {
  Assumption,
  Cliff,
  Interrupt,
  Metrics,
  QueueItem,
  Signal,
  Strategy,
} from "./types";

export function withPressure(row: Omit<Signal, "pressure" | "stale">): Signal {
  const p = pressure(row.materiality, row.velocity, row.confidence);
  const days = cadenceDays(row.cadence);
  const ref = row.last_evidence_at ?? row.created_at;
  const ageMs = Date.now() - new Date(ref).getTime();
  const stale = Number.isFinite(ageMs) && ageMs > days * 2 * 86400000;
  return { ...row, pressure: p, stale };
}

export function buildQueue(input: {
  strategy: Strategy;
  assumptions: Assumption[];
  signals: Signal[];
  interrupts: Interrupt[];
  cliffs: Cliff[];
}): QueueItem[] {
  const items: QueueItem[] = [];

  for (const i of input.interrupts) {
    if (i.status === "open") {
      items.push({
        id: `int-${i.id}`,
        kind: "interrupt",
        title: i.name,
        reason: `Red line fired. Review by ${i.review_by ?? "now"}.`,
        intensity_hint: "refresh",
        ref_id: i.id,
      });
    }
  }

  for (const a of input.assumptions) {
    if (a.status === "broken") {
      const age = Date.now() - new Date(a.status_changed_at).getTime();
      const overdue = age > 14 * 86400000;
      items.push({
        id: `asm-${a.id}`,
        kind: "assumption",
        title: a.claim,
        reason: overdue
          ? "Broken for more than 14 days with no logged decision."
          : "Load-bearing assumption is broken.",
        intensity_hint: a.implied_intensity,
        ref_id: a.id,
      });
    } else if (a.status === "weakening") {
      items.push({
        id: `asm-${a.id}`,
        kind: "assumption",
        title: a.claim,
        reason: "Assumption is weakening — evidence is moving against the claim.",
        intensity_hint: "amend",
        ref_id: a.id,
      });
    }
  }

  const active = input.signals.filter((s) => s.status === "active");
  const ranked = [...active].sort((a, b) => b.pressure - a.pressure);
  const cutoff = ranked[Math.max(0, Math.floor(ranked.length * 0.25) - 1)]?.pressure ?? 99;
  for (const s of ranked) {
    if (s.stale) {
      items.push({
        id: `sig-stale-${s.id}`,
        kind: "signal",
        title: s.name,
        reason: "Evidence is stale (older than 2× cadence).",
        intensity_hint: "watch",
        ref_id: s.id,
      });
    } else if (s.pressure >= cutoff && s.layer === "sentinel") {
      items.push({
        id: `sig-${s.id}`,
        kind: "signal",
        title: s.name,
        reason: `Sentinel pressure ${s.pressure} (M${s.materiality}·V${s.velocity}·weak evidence).`,
        intensity_hint: "amend",
        ref_id: s.id,
      });
    }
  }

  const weakeningOrBroken = input.assumptions.some(
    (a) => a.status === "weakening" || a.status === "broken",
  );
  if (input.strategy.delivery_rag === "green" && weakeningOrBroken) {
    items.push({
      id: "div-1",
      kind: "divergence",
      title: "Delivery is green; the logic is not",
      reason: "Activity can be on track while the theory of change is already false.",
      intensity_hint: "amend",
      ref_id: 0,
    });
  }

  const now = Date.now();
  for (const c of input.cliffs) {
    const t = new Date(c.cliff_date).getTime();
    const days = Math.round((t - now) / 86400000);
    if (days <= 180) {
      items.push({
        id: `cliff-${c.id}`,
        kind: "cliff",
        title: c.name,
        reason: days < 0 ? `Cliff passed ${Math.abs(days)} days ago.` : `${days} days to cliff.`,
        intensity_hint: days <= 90 ? "refresh" : "watch",
        ref_id: c.id,
      });
    }
  }

  return items.slice(0, BUDGET.maxQueue);
}

export function buildMetrics(input: {
  assumptions: Assumption[];
  signals: Signal[];
  cliffs: Cliff[];
  queueCount: number;
}): Metrics {
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
  const nextCliff = [...input.cliffs]
    .map((c) => ({ c, t: new Date(c.cliff_date).getTime() }))
    .sort((a, b) => a.t - b.t)[0];
  const daysToCliff = nextCliff
    ? Math.round((nextCliff.t - Date.now()) / 86400000)
    : null;

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
    queue_count: input.queueCount,
    days_to_cliff: daysToCliff,
    next_cliff_name: nextCliff?.c.name ?? null,
  };
}
