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

  it("never moves anything: it returns hints, and the signal is untouched", () => {
    const s = signal({ category: 4 });
    roomFits([s]);
    assert.equal(s.category, 4);
  });
});
