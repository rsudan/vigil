import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkChars, extractionNote, mergePartials, windowsOf } from "./extract-plan.ts";

const chunk = (i: number, size: number) => ({ index: i, heading: `p. ${i + 1} · Section ${i + 1}`, body: "x".repeat(size) });

describe("windowsOf", () => {
  it("packs chunks into windows under the budget and accounts for every character", () => {
    const chunks = [chunk(0, 3000), chunk(1, 3000), chunk(2, 3000), chunk(3, 1000)];
    const windows = windowsOf(chunks, 7000);
    assert.equal(windows.length, 2);
    const total = windows.reduce((n, w) => n + w.chars, 0);
    assert.equal(total, chunks.reduce((n, c) => n + chunkChars(c), 0));
    assert.ok(windows.every((w) => w.text.length <= 7000));
  });
  it("keeps a single oversized chunk rather than dropping it", () => {
    const windows = windowsOf([chunk(0, 10_000)], 4000);
    assert.equal(windows.length, 1);
    assert.equal(windows[0]!.text.length, 4000);
  });
});

describe("mergePartials", () => {
  it("deduplicates lists, keeps scalars from the first pass that has them, and re-points assumption indexes", () => {
    const merged = mergePartials([
      { title: "", vision: "V", assumptions: [{ claim: "A" }, { claim: "B" }], signals: [{ name: "S1", assumption_indexes: [1] }], cliffs: [] },
      { title: "T", assumptions: [{ claim: "b" }, { claim: "C" }], signals: [{ name: "s1" }, { name: "S2", assumption_indexes: [1] }], interrupts: [{ name: "I" }] },
    ]);
    assert.equal(merged.title, "T");
    assert.equal(merged.vision, "V");
    assert.deepEqual((merged.assumptions as { claim: string }[]).map((a) => a.claim), ["A", "B", "C"]);
    const signals = merged.signals as { name: string; assumption_indexes: number[] }[];
    assert.deepEqual(signals.map((s) => s.name), ["S1", "S2"]);
    assert.deepEqual(signals[1]!.assumption_indexes, [2], "second pass index 1 (C) maps to merged index 2");
    assert.equal((merged.interrupts as unknown[]).length, 1);
  });
});

describe("extractionNote", () => {
  it("says how much was read and how", () => {
    const note = extractionNote(
      { parsed: {}, chars_read: 1000, total_chars: 1000, passes: 3, consolidated: true, failed_parts: [] },
      12,
      { provider: "xai", model: "grok" },
    );
    assert.match(note, /read all 1,000 characters \(12 pages\) in 2 passes plus a consolidation pass with xai\/grok/);
    const partial = extractionNote(
      { parsed: {}, chars_read: 600, total_chars: 1000, passes: 2, consolidated: false, failed_parts: [2] },
      null,
      { provider: "xai", model: "grok" },
    );
    assert.match(partial, /read 600 of 1,000 characters in 2 passes, merged without a model/);
    assert.match(partial, /Part 2 failed and was skipped/);
  });
});
