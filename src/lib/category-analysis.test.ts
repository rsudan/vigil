import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeCategory } from "./category-analysis.ts";
import { withPressure } from "./compute.ts";
import type { Assumption, Signal, StrategyBundle } from "./types.ts";

const NOW = Date.parse("2026-09-02T12:00:00Z");

function signal(id: number, over: Partial<Omit<Signal, "pressure" | "stale">>): Signal {
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
      current_value: "",
      unit: "",
      threshold_watch: "",
      threshold_amend: "",
      threshold_refresh: "",
      threshold_reset: "",
      false_positive_guard: "",
      owner_label: "",
      status: "active",
      crossed_level: "none",
      last_evidence_at: new Date(NOW).toISOString(),
      created_at: new Date(NOW).toISOString(),
      updated_at: new Date(NOW).toISOString(),
      ...over,
    },
    NOW,
  );
}

function bundle(signals: Signal[], assumptions: Assumption[] = []): StrategyBundle {
  return { signals, assumptions } as unknown as StrategyBundle;
}

describe("analyzeCategory", () => {
  it("counts a signal in its secondary room too", () => {
    const b = bundle([signal(1, { category: 2, secondary_category: 9 })]);
    assert.equal(analyzeCategory(b, 9).verdict, "quiet");
    assert.equal(analyzeCategory(b, 2).verdict, "quiet");
    assert.equal(analyzeCategory(b, 5).verdict, "gap");
  });

  it("raises the verdict when a reading has crossed a threshold, whatever the pressure", () => {
    const quiet = bundle([signal(1, { crossed_level: "refresh", current_value: "2.0" })]);
    const r = analyzeCategory(quiet, 5);
    assert.equal(r.verdict, "severe");
    assert.equal(r.crossed?.id, 1);
    assert.match(r.reading, /crossed its refresh threshold/);
    assert.equal(analyzeCategory(bundle([signal(1, { crossed_level: "amend" })]), 5).verdict, "high");
  });

  it("ignores parked signals", () => {
    assert.equal(analyzeCategory(bundle([signal(1, { status: "parked" })]), 5).verdict, "gap");
  });
});
