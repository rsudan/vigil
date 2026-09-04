import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkPages, chunkText, joinChunks } from "./chunk.ts";

describe("chunkText", () => {
  it("splits on paragraph boundaries and headlines each chunk with its first line", () => {
    const text = `Chapter 1\n${"a".repeat(2000)}\n\nChapter 2\n${"b".repeat(2000)}`;
    const chunks = chunkText(text, 2500);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.heading, "Chapter 1");
    assert.equal(chunks[1]!.heading, "Chapter 2");
  });
  it("returns nothing for blank input", () => {
    assert.deepEqual(chunkText("  \n "), []);
  });
});

describe("chunkPages", () => {
  it("labels chunks with the page range they cover", () => {
    const pages = ["Intro text", "8. Monitoring\nAnnual reporting.", "Annex 1\n" + "x".repeat(4000)];
    const chunks = chunkPages(pages, 3500);
    assert.equal(chunks[0]!.heading, "p. 1–2 · Intro text");
    assert.ok(chunks.slice(1).every((c) => c.heading.startsWith("p. 3")));
    assert.ok(chunks.length >= 3, "a long page is split with the same label");
  });
});

describe("joinChunks", () => {
  it("prefixes each chunk with its heading", () => {
    const joined = joinChunks([{ index: 0, heading: "p. 4 · Title", body: "Body" }]);
    assert.equal(joined, "----- p. 4 · Title -----\nBody");
  });
});
