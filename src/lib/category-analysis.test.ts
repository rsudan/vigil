import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_REVIEW_DAYS,
  analyzeAllCategories,
  analyzeCategory,
  roomsWithoutWatchpoint,
  unwatchedBets,
} from "./category-analysis.ts";
import { DAY, withPressure } from "./compute.ts";
import { roomOfCliff, roomOfInterrupt } from "./taxonomy.ts";
import type {
  Assumption,
  Cliff,
  Decision,
  Interrupt,
  QueueItem,
  Signal,
  StrategyBundle,
} from "./types.ts";

const NOW = Date.parse("2026-09-02T12:00:00Z");
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();

function signal(id: number, over: Partial<Omit<Signal, "pressure" | "stale">> = {}): Signal {
  return withPressure(
    {
      id,
      strategy_id: 1,
      user_id: "u",
      name: `S${id}`,
      category: 5,
      secondary_category: null,
      layer: "sentinel",
      materiality: 2,
      velocity: 2,
      confidence: 4,
      cadence: "quarterly",
      baseline: "",
      current_value: "12",
      unit: "",
      threshold_watch: "",
      threshold_amend: "",
      threshold_refresh: "",
      threshold_reset: "",
      false_positive_guard: "",
      owner_label: "",
      status: "active",
      crossed_level: "none",
      last_evidence_at: iso(0),
      created_at: iso(0),
      updated_at: iso(0),
      ...over,
    },
    NOW,
  );
}

function assumption(
  id: number,
  status: Assumption["status"],
  linked: number[],
  over: Partial<Assumption> = {},
): Assumption {
  return {
    id,
    strategy_id: 1,
    user_id: "u",
    claim: `Bet ${id}`,
    origin: "implicit",
    status,
    implied_intensity: "amend",
    owner_label: "",
    last_evidence_at: null,
    status_changed_at: iso(-10),
    sort_order: id,
    linked_signal_ids: linked,
    ...over,
  };
}

function interrupt(id: number, over: Partial<Interrupt> = {}): Interrupt {
  return {
    id,
    strategy_id: 1,
    name: `Red line ${id}`,
    red_line: "x",
    category: null,
    fired_at: null,
    review_by: null,
    status: "armed",
    created_at: iso(-100),
    ...over,
  };
}

function cliff(id: number, daysFromNow: number, kind: Cliff["kind"] = "fiscal"): Cliff {
  return {
    id,
    strategy_id: 1,
    name: `Cliff ${id}`,
    cliff_date: iso(daysFromNow).slice(0, 10),
    kind,
  };
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
    author: "Ana",
    ...over,
  };
}

function bundle(over: Partial<StrategyBundle>): StrategyBundle {
  return {
    signals: [],
    assumptions: [],
    interrupts: [],
    cliffs: [],
    decisions: [],
    queue: [] as QueueItem[],
    ...over,
  } as unknown as StrategyBundle;
}

describe("where things sit", () => {
  it("counts a signal in its secondary room too, marked as filed", () => {
    const b = bundle({ signals: [signal(1, { category: 2, secondary_category: 9 })] });
    assert.equal(analyzeCategory(b, 9, NOW).verdict, "quiet");
    assert.equal(analyzeCategory(b, 9, NOW).filed.length, 1);
    assert.equal(analyzeCategory(b, 2, NOW).home.length, 1);
    assert.equal(analyzeCategory(b, 5, NOW).verdict, "gap");
  });

  it("ignores parked signals", () => {
    assert.equal(
      analyzeCategory(bundle({ signals: [signal(1, { status: "parked" })] }), 5, NOW).verdict,
      "gap",
    );
  });

  it("shows a bet only through a home watchpoint, never through a filing or a parked signal", () => {
    const b = bundle({
      signals: [
        signal(1, { category: 2, secondary_category: 9 }),
        signal(2, { category: 4, status: "parked" }),
      ],
      assumptions: [assumption(1, "weakening", [1]), assumption(2, "broken", [2])],
    });
    const home = analyzeCategory(b, 2, NOW);
    assert.deepEqual(
      home.assumptions.map((a) => a.id),
      [1],
    );
    assert.equal(home.bets[0]!.via[0]!.id, 1);
    assert.equal(home.verdict, "high", "weakening through the home room colours it");
    const filing = analyzeCategory(b, 9, NOW);
    assert.equal(filing.assumptions.length, 0);
    assert.equal(filing.verdict, "quiet", "a filing carries pressure, not bet status");
    assert.equal(analyzeCategory(b, 4, NOW).assumptions.length, 0, "a parked signal places no bet");
    assert.deepEqual(
      unwatchedBets(b).map((a) => a.id),
      [2],
    );
  });

  it("places red lines by their room, or in Risks when none was named, and cliffs by kind", () => {
    assert.equal(roomOfInterrupt(interrupt(1)), 8);
    assert.equal(roomOfInterrupt(interrupt(1, { category: 6 })), 6);
    assert.equal(roomOfCliff(cliff(1, 10, "fiscal")), 5);
    assert.equal(roomOfCliff(cliff(1, 10, "legal")), 6);
    assert.equal(roomOfCliff(cliff(1, 10, "review")), 3);
    assert.equal(roomOfCliff(cliff(1, 10, "scenario")), 8);
    const b = bundle({
      interrupts: [interrupt(1), interrupt(2, { category: 6, status: "closed" })],
      cliffs: [cliff(1, 40, "legal")],
    });
    assert.equal(analyzeCategory(b, 8, NOW).interrupts.length, 1);
    assert.equal(analyzeCategory(b, 8, NOW).interrupts[0]!.room_set, false);
    assert.equal(analyzeCategory(b, 6, NOW).interrupts.length, 0, "closed red lines are history");
    assert.equal(analyzeCategory(b, 6, NOW).cliffs[0]!.days, 40);
  });
});

describe("what a room must never do", () => {
  it("never reads calm over a fired red line, even with no watchpoint", () => {
    const b = bundle({
      interrupts: [
        interrupt(1, { category: 6, status: "open", fired_at: iso(-3), review_by: iso(27) }),
      ],
    });
    const r = analyzeCategory(b, 6, NOW);
    assert.equal(r.verdict, "severe");
    assert.match(
      r.reading,
      /Red line “Red line 1” has fired\. Review by 2026-09-29\. Decide, then close it\./,
    );
    assert.equal(r.headline, "red line fired: Red line 1");
    const overdue = analyzeCategory(
      bundle({
        interrupts: [
          interrupt(1, { category: 6, status: "open", fired_at: iso(-40), review_by: iso(-10) }),
        ],
      }),
      6,
      NOW,
    );
    assert.match(overdue.reading, /review deadline has passed/);
  });

  it("never reads calm over a passed cliff nobody decided on; a decision after it settles it", () => {
    const undecided = analyzeCategory(
      bundle({ signals: [signal(1)], cliffs: [cliff(1, -247)] }),
      5,
      NOW,
    );
    assert.equal(undecided.verdict, "high");
    assert.match(undecided.reading, /passed 247 days ago with no decision logged since/);
    const decided = analyzeCategory(
      bundle({
        signals: [signal(1)],
        cliffs: [cliff(1, -247)],
        decisions: [decision("cliff-1", 5)],
      }),
      5,
      NOW,
    );
    assert.equal(decided.verdict, "quiet");
    assert.match(decided.also, /passed 247 days ago \(decided 2026-08-28\)/);
    const unwatched = analyzeCategory(bundle({ cliffs: [cliff(1, -400)] }), 5, NOW);
    assert.equal(unwatched.verdict, "high", "a passed cliff overrides the gap");
    assert.match(unwatched.reading, /^No watchpoint in this room, and the fiscal cliff/);
  });

  it("keeps an unwatched room a gap when only armed red lines and horizon cliffs sit there, and names them", () => {
    const r = analyzeCategory(
      bundle({ interrupts: [interrupt(1, { category: 5 })], cliffs: [cliff(1, 60)] }),
      5,
      NOW,
    );
    assert.equal(r.verdict, "gap");
    assert.equal(r.pressure, null);
    assert.match(
      r.reading,
      /No watchpoint in this room\. It is not silent: red line “Red line 1” is armed; the fiscal cliff “Cliff 1” falls in 60 days\./,
    );
    assert.equal(r.headline, "1 red line armed");
    assert.equal(
      roomsWithoutWatchpoint(analyzeAllCategories(bundle({ interrupts: [interrupt(1)] }), NOW))
        .length,
      10,
    );
  });

  it("raises a watched room on a cliff inside 90 days, moderately inside 180, and not beyond", () => {
    assert.equal(
      analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 60)] }), 5, NOW).verdict,
      "high",
    );
    assert.equal(
      analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 150)] }), 5, NOW).verdict,
      "moderate",
    );
    const far = analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 483)] }), 5, NOW);
    assert.equal(far.verdict, "quiet");
    assert.equal(far.also, "", "a cliff beyond 180 days is listed, not announced");
    assert.equal(far.cliffs.length, 1);
  });

  it("raises the verdict when a reading has crossed a threshold, whatever the pressure, through either room", () => {
    const r = analyzeCategory(
      bundle({ signals: [signal(1, { crossed_level: "refresh", current_value: "2.0" })] }),
      5,
      NOW,
    );
    assert.equal(r.verdict, "severe");
    assert.equal(r.crossed?.id, 1);
    assert.match(r.reading, /crossed its refresh threshold/);
    assert.equal(
      analyzeCategory(bundle({ signals: [signal(1, { crossed_level: "amend" })] }), 5, NOW).verdict,
      "high",
    );
    const filed = bundle({
      signals: [signal(1, { category: 2, secondary_category: 8, crossed_level: "reset" })],
    });
    assert.equal(analyzeCategory(filed, 8, NOW).verdict, "severe", "a filed crossing still counts");
  });

  it("names the pre-committed intensity of a broken bet, not a guess", () => {
    const b = bundle({
      signals: [signal(1, { category: 6 })],
      assumptions: [assumption(4, "broken", [1], { implied_intensity: "amend" })],
      queue: [{ id: "asm-4" } as QueueItem],
    });
    const r = analyzeCategory(b, 6, NOW);
    assert.equal(r.verdict, "severe");
    assert.equal(
      r.reading,
      "1 bet watched from this room is broken. The pre-committed intensity is amend: use it, not a quiet watch. It is #1 in the queue.",
    );
  });

  it("calls a reading with no baseline unmeasured, not calm", () => {
    const r = analyzeCategory(
      bundle({ signals: [signal(1, { current_value: "NO BASELINE" })] }),
      5,
      NOW,
    );
    assert.equal(r.verdict, "quiet");
    assert.match(r.reading, /has no baseline reading\. That is unmeasured, not calm\./);
  });
});

describe("the reviewed record", () => {
  it("stands on an unwatched room for a while, then the room asks again", () => {
    const fresh = analyzeCategory(bundle({ decisions: [decision("room-9", 3)] }), 9, NOW);
    assert.equal(fresh.verdict, "gap");
    assert.equal(fresh.reviewed?.author, "Ana");
    assert.match(fresh.reading, /Reviewed on 2026-08-30 by Ana: nothing to watch\.$/);
    const old = analyzeCategory(
      bundle({ decisions: [decision("room-9", ROOM_REVIEW_DAYS + 1)] }),
      9,
      NOW,
    );
    assert.equal(old.reviewed, null);
  });
});
