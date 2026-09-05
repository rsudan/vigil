import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roomFits } from "./room-fit.ts";
import type { Signal } from "./types.ts";

function signal(over: Partial<Signal>): Signal {
  return {
    id: 1,
    name: "Budget allocation and co-financing for the youth programmes",
    category: 4,
    secondary_category: null,
    status: "active",
    threshold_watch: "allocation below the budgeted expenditure",
    threshold_amend: "financing for the action plan cut",
    threshold_refresh: "",
    threshold_reset: "",
    created_at: "2026-01-15T10:00:00Z",
    ...over,
  } as unknown as Signal;
}

describe("roomFits", () => {
  it("names the room a watchpoint's own words point to, when it sits elsewhere", () => {
    const fits = roomFits([signal({ category: 4 })]);
    assert.equal(fits.length, 1);
    assert.equal(fits[0]!.suggested, 5, "money words point to Resources");
    assert.ok(fits[0]!.hits >= 2);
  });

  it("says nothing when the watchpoint already sits in that room, or files there second", () => {
    assert.equal(roomFits([signal({ category: 5 })]).length, 0);
    assert.equal(roomFits([signal({ category: 4, secondary_category: 5 })]).length, 0);
  });

  it("ignores retired watchpoints and ones whose words point nowhere in particular", () => {
    assert.equal(roomFits([signal({ status: "retired" })]).length, 0);
    const vague = signal({
      name: "Annual report published on time",
      category: 4,
      threshold_watch: "late",
      threshold_amend: "not published",
    });
    assert.equal(roomFits([vague]).length, 0);
  });

  it("needs a clear margin over the watchpoint's own room before it speaks", () => {
    // Two Resources words, three Mandate words: not enough of a margin.
    const close = signal({ category: 5, name: "Budget and staff for the ministry council under the law", threshold_watch: "", threshold_amend: "" });
    assert.equal(roomFits([close]).length, 0, "three against two is within the margin");
    // A fourth Mandate word clears it.
    const clear = signal({ category: 5, name: "Budget and staff for the ministry council under the law and its mandate", threshold_watch: "", threshold_amend: "" });
    const fits = roomFits([clear]);
    assert.equal(fits.length, 1);
    assert.equal(fits[0]!.suggested, 6);
    assert.equal(fits[0]!.own, 2);
    assert.equal(fits[0]!.hits, 4);
  });

  it("leaves parked watchpoints and ones filed after the re-scope alone", () => {
    assert.equal(roomFits([signal({ status: "parked" })]).length, 0);
    assert.equal(roomFits([signal({ created_at: "2026-09-08T09:00:00Z" })]).length, 0, "filed under the new rooms already");
  });

  it("never moves anything: it returns hints, and the signal is untouched", () => {
    const s = signal({ category: 4 });
    roomFits([s]);
    assert.equal(s.category, 4);
  });
});
