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
import type { Assumption, Cliff, Decision, Interrupt, QueueItem, Signal, StrategyBundle } from "./types.ts";

const NOW = Date.parse("2026-09-02T12:00:00Z");
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();
const date = (daysFromNow: number) => iso(daysFromNow).slice(0, 10);

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

function assumption(id: number, status: Assumption["status"], linked: number[], over: Partial<Assumption> = {}): Assumption {
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
  return { id, strategy_id: 1, name: `Cliff ${id}`, cliff_date: date(daysFromNow), kind };
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
    assert.equal(analyzeCategory(bundle({ signals: [signal(1, { status: "parked" })] }), 5, NOW).verdict, "gap");
  });

  it("shows a bet only through a home watchpoint, never through a filing or a parked signal", () => {
    const b = bundle({
      signals: [signal(1, { category: 2, secondary_category: 9 }), signal(2, { category: 4, status: "parked" })],
      assumptions: [assumption(1, "weakening", [1]), assumption(2, "broken", [2])],
    });
    const home = analyzeCategory(b, 2, NOW);
    assert.deepEqual(home.assumptions.map((a) => a.id), [1]);
    assert.equal(home.bets[0]!.via[0]!.id, 1);
    assert.equal(home.verdict, "high", "weakening through the home room colours it");
    const filing = analyzeCategory(b, 9, NOW);
    assert.equal(filing.assumptions.length, 0);
    assert.equal(filing.verdict, "quiet", "a filing carries pressure, not bet status");
    assert.equal(analyzeCategory(b, 4, NOW).assumptions.length, 0, "a parked signal places no bet");
    assert.deepEqual(unwatchedBets(b).map((a) => a.id), [2]);
  });

  it("places red lines by their room, or in Risks when none was named, and cliffs by kind", () => {
    assert.equal(roomOfInterrupt(interrupt(1)), 8);
    assert.equal(roomOfInterrupt(interrupt(1, { category: 6 })), 6);
    assert.equal(roomOfInterrupt(interrupt(1, { category: 11 })), 8, "a room outside 1–10 is not a room");
    assert.equal(roomOfCliff(cliff(1, 10, "fiscal")), 5);
    assert.equal(roomOfCliff(cliff(1, 10, "legal")), 6);
    assert.equal(roomOfCliff(cliff(1, 10, "review")), 3);
    assert.equal(roomOfCliff(cliff(1, 10, "scenario")), 8);
    const b = bundle({ interrupts: [interrupt(1), interrupt(2, { category: 6, status: "closed" })], cliffs: [cliff(1, 40, "legal")] });
    assert.equal(analyzeCategory(b, 8, NOW).interrupts.length, 1);
    assert.equal(analyzeCategory(b, 8, NOW).interrupts[0]!.room_set, false);
    assert.equal(analyzeCategory(b, 6, NOW).interrupts.length, 0, "closed red lines are history");
    assert.equal(analyzeCategory(b, 6, NOW).cliffs[0]!.days, 40);
  });

  it("says a red line filed under Risks by fallback has no room set", () => {
    const out = analyzeCategory(bundle({ interrupts: [interrupt(1, { category: 11 })] }), 8, NOW);
    assert.equal(out.interrupts[0]!.room_set, false);
  });
});

describe("what a room must never do", () => {
  it("never reads calm over a fired red line, even with no watchpoint", () => {
    const b = bundle({ interrupts: [interrupt(1, { category: 6, status: "open", fired_at: iso(-3), review_by: iso(27) })] });
    const r = analyzeCategory(b, 6, NOW);
    assert.equal(r.verdict, "severe");
    assert.equal(
      r.reading,
      "No watchpoint in this room. Red line “Red line 1” has fired. Review by 2026-09-29. Decide, then close it.",
    );
    assert.equal(r.headline, "red line fired: Red line 1");
    const overdue = analyzeCategory(
      bundle({ interrupts: [interrupt(1, { category: 6, status: "open", fired_at: iso(-40), review_by: iso(-10) })] }),
      6,
      NOW,
    );
    assert.match(overdue.reading, /review deadline has passed/);
  });

  it("reads the overdue red line first when two have fired", () => {
    const b = bundle({
      interrupts: [
        interrupt(1, { category: 6, status: "open", fired_at: iso(-3), review_by: iso(27) }),
        interrupt(2, { category: 6, status: "open", fired_at: iso(-60), review_by: iso(-30) }),
      ],
    });
    const r = analyzeCategory(b, 6, NOW);
    assert.match(r.reading, /Red line “Red line 2” has fired and its review deadline has passed/);
    assert.match(r.also, /red line “Red line 1” has fired/);
  });

  it("never reads calm over a passed cliff nobody decided on; a decision after it settles it", () => {
    const undecided = analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, -247)] }), 5, NOW);
    assert.equal(undecided.verdict, "high");
    assert.match(undecided.reading, /passed 247 days ago with no decision logged since/);
    const decided = analyzeCategory(
      bundle({ signals: [signal(1)], cliffs: [cliff(1, -247)], decisions: [decision("cliff-1", 5)] }),
      5,
      NOW,
    );
    assert.equal(decided.verdict, "quiet");
    assert.match(decided.also, /passed 247 days ago \(decided 2026-08-28\)/);
    const unwatched = analyzeCategory(bundle({ cliffs: [cliff(1, -400)] }), 5, NOW);
    assert.equal(unwatched.verdict, "high", "a passed cliff overrides the gap");
    assert.match(unwatched.reading, /^No watchpoint in this room\. The fiscal cliff/);
  });

  it("keeps an unwatched room a gap when only armed red lines and horizon cliffs sit there, and names them", () => {
    const r = analyzeCategory(bundle({ interrupts: [interrupt(1, { category: 5 })], cliffs: [cliff(1, 600)] }), 5, NOW);
    assert.equal(r.verdict, "gap");
    assert.equal(r.pressure, null);
    assert.equal(
      r.reading,
      "No watchpoint in this room. It is not silent: red line “Red line 1” is armed; the fiscal cliff “Cliff 1” falls in 600 days. The fiscal cliff will arrive whether or not you named it.",
    );
    assert.equal(r.headline, "no watchpoint", "one word for the state, the same as the badge");
    assert.equal(r.also, "", "the notes were read inline, so nothing is repeated");
    assert.equal(roomsWithoutWatchpoint(analyzeAllCategories(bundle({ interrupts: [interrupt(1)] }), NOW)).length, 10);
  });

  it("raises a watched room on a cliff inside 90 days, moderately inside 180, and reads the cliff either way", () => {
    const near = analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 60)] }), 5, NOW);
    assert.equal(near.verdict, "high");
    assert.match(near.reading, /60 days to the fiscal cliff “Cliff 1”/);
    const horizon = analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 150)] }), 5, NOW);
    assert.equal(horizon.verdict, "moderate");
    assert.match(horizon.reading, /150 days to the fiscal cliff “Cliff 1”/, "the fact that raised the verdict is the fact that is read");
    const far = analyzeCategory(bundle({ signals: [signal(1)], cliffs: [cliff(1, 483)] }), 5, NOW);
    assert.equal(far.verdict, "quiet");
    assert.match(far.also, /falls in 483 days/, "a far cliff is named, not announced");
    assert.equal(far.cliffs.length, 1);
  });

  it("raises the verdict when a reading has crossed a threshold, whatever the pressure, through either room", () => {
    const r = analyzeCategory(bundle({ signals: [signal(1, { crossed_level: "refresh", current_value: "2.0" })] }), 5, NOW);
    assert.equal(r.verdict, "severe");
    assert.equal(r.crossed?.id, 1);
    assert.match(r.reading, /crossed its refresh threshold/);
    assert.equal(analyzeCategory(bundle({ signals: [signal(1, { crossed_level: "amend" })] }), 5, NOW).verdict, "high");
    const filed = bundle({ signals: [signal(1, { category: 2, secondary_category: 8, crossed_level: "reset" })] });
    assert.equal(analyzeCategory(filed, 8, NOW).verdict, "severe", "a filed crossing still counts");
  });

  it("reads the strongest fact, not the first kind: a broken bet outranks a watch-level crossing", () => {
    const b = bundle({
      signals: [signal(1, { category: 6 }), signal(2, { category: 6, crossed_level: "watch" })],
      assumptions: [assumption(4, "broken", [1])],
    });
    const r = analyzeCategory(b, 6, NOW);
    assert.match(r.reading, /^1 bet watched from this room is broken/);
    assert.match(r.also, /has crossed its watch threshold/);
    const reset = analyzeCategory(
      bundle({
        signals: [signal(1, { category: 6 }), signal(2, { category: 6, crossed_level: "reset" })],
        assumptions: [assumption(4, "broken", [1])],
      }),
      6,
      NOW,
    );
    assert.match(reset.reading, /crossed its reset threshold/, "a reset crossing outranks a broken bet");
    assert.match(reset.also, /1 bet broken/);
  });

  it("names the pre-committed intensity of a broken bet, and does not tell you to watch a broken bet", () => {
    const b = bundle({
      signals: [signal(1, { category: 6 })],
      assumptions: [assumption(4, "broken", [1], { implied_intensity: "amend" })],
      queue: [{ id: "asm-4" } as QueueItem],
    });
    assert.equal(
      analyzeCategory(b, 6, NOW).reading,
      "1 bet watched from this room is broken. The pre-committed intensity is amend: use it, not a quiet watch. It is #1 in the queue.",
    );
    const onlyWatch = analyzeCategory(
      bundle({ signals: [signal(1, { category: 6 })], assumptions: [assumption(4, "broken", [1], { implied_intensity: "watch" })] }),
      6,
      NOW,
    );
    assert.match(onlyWatch.reading, /Only a watch was pre-committed, and a broken bet needs more than a watch/);
  });

  it("says a quiet band rests on no baseline without denying the band", () => {
    const r = analyzeCategory(bundle({ signals: [signal(1, { current_value: "NO BASELINE" })] }), 5, NOW);
    assert.equal(r.verdict, "quiet");
    assert.equal(
      r.reading,
      "Pressure 8/125 (quiet) rests on a watchpoint with no baseline reading. Record a first reading before you call this room calm.",
    );
  });

  it("survives a bundle with no red lines, cliffs, decisions or queue", () => {
    const r = analyzeCategory({ signals: [signal(1)], assumptions: [] } as unknown as StrategyBundle, 5, NOW);
    assert.equal(r.verdict, "quiet");
    assert.equal(r.also, "");
  });
});

describe("what the document says, and what the world says", () => {
  const passage = (category: number, locator: string, id = category) => ({
    id,
    category,
    rank: 0,
    locator,
    quote: "The budget allocated to youth programmes covers staff and infrastructure at the central level.",
    terms_hit: 3,
    read_at: iso(-1),
  });
  const finding = (category: number, status: "proposed" | "kept" | "dismissed") => ({
    id: category * 10 + (status === "dismissed" ? 1 : 0),
    category,
    title: "Ministry budget circular 2027",
    url: "https://example.org/circular",
    published_date: "2026-06-01",
    quote: "The youth envelope is not carried into the next programming period.",
    quote_verified: true,
    why: "The successor envelope this strategy assumes is not named.",
    query: "q",
    searched_at: iso(-2),
    status,
    decided_at: null,
    rationale: "",
    author: "Ana",
    decided_author: null,
  });

  it("never changes a verdict, a headline or a pressure, however much material is loaded", () => {
    const register = {
      signals: [signal(1, { category: 5 }), signal(2, { category: 6, crossed_level: "amend" as const })],
      assumptions: [assumption(1, "weakening" as const, [1])],
      interrupts: [interrupt(1, { category: 8, status: "open" as const, fired_at: iso(-2) })],
      cliffs: [cliff(1, -40, "legal")],
    };
    const bare = analyzeAllCategories(bundle(register), NOW);
    const loaded = analyzeAllCategories(
      bundle({
        ...register,
        room_passages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => passage(c, `p. ${c}`)),
        room_findings: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => finding(c, "proposed")),
      }),
      NOW,
    );
    for (let i = 0; i < bare.length; i += 1) {
      assert.equal(loaded[i]!.verdict, bare[i]!.verdict, `room ${bare[i]!.id} changed verdict`);
      assert.equal(loaded[i]!.headline, bare[i]!.headline, `room ${bare[i]!.id} changed headline`);
      assert.equal(loaded[i]!.pressure, bare[i]!.pressure, `room ${bare[i]!.id} changed pressure`);
      assert.equal(loaded[i]!.also, bare[i]!.also, `room ${bare[i]!.id} changed its second sentence`);
    }
  });

  it("makes an unwatched room read worse, not fuller, when the document speaks there", () => {
    const r = analyzeCategory(bundle({ room_passages: [passage(9, "p. 41"), passage(9, "p. 63", 99)] }), 9, NOW);
    assert.equal(r.verdict, "gap");
    assert.match(r.reading, /The document speaks here on p\. 41, p\. 63, and nothing watches it\.$/);
  });

  it("says nothing extra in a watched room", () => {
    const r = analyzeCategory(bundle({ signals: [signal(1)], room_passages: [passage(5, "p. 12")] }), 5, NOW);
    assert.ok(!/nothing watches it/.test(r.reading));
    assert.equal(r.passages.length, 1);
  });

  it("keeps dismissed candidates out of the room but not out of the record", () => {
    const r = analyzeCategory(
      bundle({ room_findings: [finding(5, "proposed"), finding(5, "dismissed"), finding(6, "kept")] }),
      5,
      NOW,
    );
    assert.deepEqual(
      r.findings.map((f) => f.status),
      ["proposed"],
    );
    assert.deepEqual(
      r.dismissed.map((f) => f.status),
      ["dismissed"],
    );
  });

  it("carries the read record so a room can tell not-read from silent", () => {
    assert.equal(analyzeCategory(bundle({}), 5, NOW).read, null);
    const silent = analyzeCategory(
      bundle({ room_reads: [{ category: 5, read_at: iso(-1), passages: 0, terms_matched: true }] }),
      5,
      NOW,
    );
    assert.equal(silent.read?.terms_matched, true);
    assert.equal(silent.read?.passages, 0);
  });
});

describe("the reviewed record", () => {
  it("stands on an unwatched room for a while, then the room asks again", () => {
    const fresh = analyzeCategory(bundle({ decisions: [decision("room-9", 3)] }), 9, NOW);
    assert.equal(fresh.verdict, "gap");
    assert.equal(fresh.reviewed?.author, "Ana");
    assert.match(fresh.reading, /Reviewed on 2026-08-30 by Ana: nothing to watch\.$/);
    const old = analyzeCategory(bundle({ decisions: [decision("room-9", ROOM_REVIEW_DAYS + 1)] }), 9, NOW);
    assert.equal(old.reviewed, null);
  });

  it("does not stand once the room has a watchpoint, a fired red line or a passed cliff", () => {
    const watched = analyzeCategory(bundle({ signals: [signal(1)], decisions: [decision("room-5", 3)] }), 5, NOW);
    assert.equal(watched.reviewed, null);
    const fired = analyzeCategory(
      bundle({
        interrupts: [interrupt(1, { category: 5, status: "open", fired_at: iso(-1) })],
        decisions: [decision("room-5", 3)],
      }),
      5,
      NOW,
    );
    assert.equal(fired.reviewed, null);
    const passed = analyzeCategory(bundle({ cliffs: [cliff(1, -30)], decisions: [decision("room-5", 3)] }), 5, NOW);
    assert.equal(passed.reviewed, null);
  });
});

describe("days are calendar days", () => {
  it("counts a cliff dated today as today, whatever the hour", () => {
    const noon = analyzeCategory(bundle({ cliffs: [cliff(1, 0)] }), 5, NOW);
    assert.equal(noon.cliffs[0]!.days, 0);
    assert.equal(noon.cliffs[0]!.passed, false);
    const lateEvening = analyzeCategory(
      bundle({ cliffs: [{ id: 1, strategy_id: 1, name: "Cliff 1", cliff_date: "2026-09-02", kind: "fiscal" }] }),
      5,
      Date.parse("2026-09-02T23:30:00Z"),
    );
    assert.equal(lateEvening.cliffs[0]!.days, 0, "still today at 23:30");
    const tomorrow = analyzeCategory(
      bundle({ cliffs: [{ id: 1, strategy_id: 1, name: "Cliff 1", cliff_date: "2026-09-02", kind: "fiscal" }] }),
      5,
      Date.parse("2026-09-03T00:30:00Z"),
    );
    assert.equal(tomorrow.cliffs[0]!.days, -1, "passed once the day turns");
  });
});
