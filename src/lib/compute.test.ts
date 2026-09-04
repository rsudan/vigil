import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DAY, RANK, buildMetrics, buildQueue, latestDecisions, withPressure } from "./compute.ts";
import type { Assumption, Cliff, Decision, Interrupt, Signal, Strategy } from "./types.ts";

const NOW = Date.parse("2026-09-02T12:00:00Z");
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();

const strategy: Strategy = {
  id: 1,
  user_id: "u",
  title: "T",
  domain: "",
  vision: "",
  language: "",
  extraction_note: "",
  horizon_start: null,
  horizon_end: null,
  delivery_rag: "amber",
  created_at: iso(-400),
  updated_at: iso(0),
};

function assumption(id: number, status: Assumption["status"], changedDaysAgo = 10): Assumption {
  return {
    id,
    strategy_id: 1,
    user_id: "u",
    claim: `Bet ${id}`,
    origin: "implicit",
    status,
    implied_intensity: "refresh",
    owner_label: "",
    last_evidence_at: null,
    status_changed_at: iso(-changedDaysAgo),
    sort_order: id,
    linked_signal_ids: [],
  };
}

function signal(id: number, over: Partial<Omit<Signal, "pressure" | "stale">> = {}): Signal {
  return withPressure(
    {
      id,
      strategy_id: 1,
      user_id: "u",
      name: `Signal ${id}`,
      category: 8,
      secondary_category: null,
      layer: "sentinel",
      materiality: 3,
      velocity: 3,
      confidence: 3,
      cadence: "monthly",
      baseline: "",
      current_value: "",
      unit: "",
      threshold_watch: "0.3",
      threshold_amend: "0.5",
      threshold_refresh: "1.0",
      threshold_reset: "",
      false_positive_guard: "",
      owner_label: "",
      status: "active",
      crossed_level: "none",
      last_evidence_at: iso(-5),
      created_at: iso(-300),
      updated_at: iso(-5),
      ...over,
    },
    NOW,
  );
}

function interrupt(id: number, over: Partial<Interrupt> = {}): Interrupt {
  return { id, strategy_id: 1, name: `Red line ${id}`, red_line: "x", fired_at: null, review_by: null, status: "armed", created_at: iso(-100), ...over };
}

function cliff(id: number, daysFromNow: number): Cliff {
  return { id, strategy_id: 1, name: `Cliff ${id}`, cliff_date: iso(daysFromNow).slice(0, 10), kind: "fiscal" };
}

function decision(item_key: string, daysAgo: number, over: Partial<Decision> = {}): Decision {
  return {
    id: 1,
    strategy_id: 1,
    user_id: "u",
    intensity: "no-change",
    summary: "",
    rationale: "looked",
    item_key,
    signal_id: null,
    assumption_id: null,
    decided_at: iso(-daysAgo),
    author: null,
    ...over,
  };
}

const empty = { strategy, assumptions: [], signals: [], interrupts: [], cliffs: [], now: NOW };

describe("buildQueue ranking", () => {
  it("puts an overdue interrupt first, then crossed thresholds, then broken bets, then a near cliff", () => {
    const { queue } = buildQueue({
      ...empty,
      assumptions: [assumption(1, "broken"), assumption(2, "weakening")],
      signals: [signal(1, { crossed_level: "reset", current_value: "2.0" })],
      interrupts: [interrupt(1, { status: "open", fired_at: iso(-40), review_by: iso(-10) })],
      cliffs: [cliff(1, 10)],
    });
    assert.deepEqual(
      queue.map((q) => q.id),
      ["int-1", "sig-crossed-1", "asm-1", "cliff-1", "asm-2"],
    );
    assert.equal(queue[0]!.overdue, true);
    assert.equal(queue[1]!.intensity_hint, "reset");
  });

  it("never drops a cliff or a fired red line behind twelve weakening bets", () => {
    const assumptions = Array.from({ length: 12 }, (_, i) => assumption(i + 1, "weakening"));
    const { queue, overflow } = buildQueue({
      ...empty,
      strategy: { ...strategy, delivery_rag: "green" },
      assumptions,
      signals: [signal(1, { materiality: 5, velocity: 5, confidence: 1, last_evidence_at: iso(-400) })],
      interrupts: [interrupt(1, { status: "open", fired_at: iso(-1), review_by: iso(29) })],
      cliffs: [cliff(1, 10)],
    });
    assert.equal(queue.length, 12);
    assert.equal(queue[0]!.kind, "interrupt");
    assert.equal(queue[1]!.kind, "cliff");
    assert.equal(overflow, 4, "two weakening bets, the divergence flag and the stale sentinel fell below the cut and are counted");
  });

  it("raises the divergence flag when delivery is green over a weakening logic", () => {
    const { queue } = buildQueue({
      ...empty,
      strategy: { ...strategy, delivery_rag: "green" },
      assumptions: [assumption(1, "weakening")],
    });
    assert.deepEqual(queue.map((q) => q.kind), ["assumption", "divergence"]);
  });

  it("ranks a top-quarter sentinel by pressure and only when not stale or crossed", () => {
    const { queue } = buildQueue({
      ...empty,
      signals: [
        signal(1, { materiality: 5, velocity: 5, confidence: 1 }),
        signal(2, { materiality: 1, velocity: 1, confidence: 5 }),
        signal(3, { materiality: 2, velocity: 2, confidence: 4 }),
        signal(4, { materiality: 2, velocity: 2, confidence: 4, layer: "rotating" }),
      ],
    });
    assert.deepEqual(queue.map((q) => q.id), ["sig-1"]);
    assert.equal(queue[0]!.rank, RANK.sentinelPressure + 9);
  });
});

describe("buildQueue and decisions", () => {
  it("clears a weakening bet once a decision is logged after its status changed", () => {
    const withDecision = buildQueue({
      ...empty,
      assumptions: [assumption(1, "weakening", 10)],
      decisions: [decision("asm-1", 3)],
    });
    assert.equal(withDecision.queue.length, 0);
    assert.equal(withDecision.suppressed, 1);
    const stale = buildQueue({
      ...empty,
      assumptions: [assumption(1, "weakening", 10)],
      decisions: [decision("asm-1", 20)],
    });
    assert.equal(stale.queue.length, 1, "a decision older than the status change does not clear it");
  });

  it("flags a broken bet as overdue only when nothing was decided for 14 days", () => {
    const overdue = buildQueue({ ...empty, assumptions: [assumption(1, "broken", 30)] });
    assert.equal(overdue.queue[0]!.overdue, true);
    assert.equal(overdue.queue[0]!.rank, RANK.brokenOverdue);
    const decided = buildQueue({
      ...empty,
      assumptions: [assumption(1, "broken", 30)],
      decisions: [decision("asm-1", 5, { intensity: "refresh" })],
    });
    assert.equal(decided.queue.length, 0);
  });

  it("clears a stale signal for one cadence after a decision, then resurfaces it", () => {
    const stale = signal(1, { last_evidence_at: iso(-100), cadence: "monthly" });
    assert.equal(stale.stale, true);
    const recent = buildQueue({ ...empty, signals: [stale], decisions: [decision("sig-stale-1", 10)] });
    assert.equal(recent.queue.length, 0);
    const old = buildQueue({ ...empty, signals: [stale], decisions: [decision("sig-stale-1", 45)] });
    assert.equal(old.queue.length, 1);
  });

  it("keeps a passed cliff until a decision is logged after the date", () => {
    const passed = buildQueue({ ...empty, cliffs: [cliff(1, -20)] });
    assert.equal(passed.queue[0]!.overdue, true);
    const decided = buildQueue({ ...empty, cliffs: [cliff(1, -20)], decisions: [decision("cliff-1", 5)] });
    assert.equal(decided.queue.length, 0);
  });

  it("honours decisions logged before item keys existed, by assumption or signal id", () => {
    const legacy = latestDecisions([decision("", 2, { assumption_id: 7 }), decision("", 3, { signal_id: 9 })]);
    assert.ok(legacy.has("asm-7"));
    assert.ok(legacy.has("sig-stale-9"));
    assert.ok(legacy.has("sig-crossed-9"));
  });
});

describe("buildMetrics", () => {
  it("names the next future cliff, counts overdue interrupts and crossed thresholds", () => {
    const queue = buildQueue({ ...empty });
    const m = buildMetrics({
      assumptions: [assumption(1, "holding")],
      signals: [signal(1, { crossed_level: "amend" }), signal(2, { status: "parked", crossed_level: "reset" })],
      cliffs: [cliff(1, -30), cliff(2, 45), cliff(3, 400)],
      interrupts: [
        interrupt(1, { status: "open", review_by: iso(-1) }),
        interrupt(2, { status: "open", review_by: iso(10) }),
        interrupt(3, { status: "closed" }),
      ],
      queue,
      now: NOW,
    });
    assert.equal(m.next_cliff_name, "Cliff 2");
    assert.equal(m.days_to_cliff, 45);
    assert.equal(m.open_interrupts, 2);
    assert.equal(m.overdue_interrupts, 1);
    assert.equal(m.crossed_count, 1, "parked signals do not count");
    assert.equal(m.active_signals, 1);
  });
});
