import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { excerptFound, isSilenceMarker, rankChunks, tokenize } from "./retrieval.ts";

const chunks = [
  { heading: "p. 1 · Vision", body: "A resilient Romania where communities are prepared for hazards." },
  { heading: "p. 40 · Financing", body: "Implementation draws on the National Recovery and Resilience Plan and the Multiannual Financial Framework 2021–2027. No successor envelope is named after 2027." },
  { heading: "p. 55 · Monitoring", body: "The strategy is monitored through annual reporting and a revision of the action plan every three years." },
];

describe("rankChunks", () => {
  it("returns the chunks that match the query, in document order", () => {
    const picked = rankChunks(chunks, ["successor funding envelope after 2027", "annual reporting revision"], 2);
    assert.deepEqual(
      picked.map((c) => c.heading),
      ["p. 40 · Financing", "p. 55 · Monitoring"],
    );
  });
  it("returns nothing when no term matches", () => {
    assert.deepEqual(rankChunks(chunks, ["zebra"], 3), []);
  });
  it("tokenizes without stop words or accents", () => {
    assert.deepEqual(tokenize("The Strategy of Resilience — Strategia națională"), ["strategy", "resilience", "strategia", "nationala"]);
  });
});

describe("excerptFound", () => {
  const corpus = chunks.map((c) => c.body).join("\n");
  it("accepts an exact quotation and one with different quotes, dashes and spacing", () => {
    assert.equal(excerptFound("No successor envelope is named after 2027.", corpus), true);
    assert.equal(excerptFound("“Multiannual Financial Framework 2021-2027.   No successor envelope”", corpus), true);
  });
  it("accepts an elided quotation whose pieces appear in order", () => {
    assert.equal(excerptFound("Implementation draws on the National Recovery … No successor envelope is named after 2027.", corpus), true);
    assert.equal(excerptFound("No successor envelope is named after 2027 … Implementation draws on the National Recovery", corpus), false);
  });
  it("rejects a paraphrase", () => {
    assert.equal(excerptFound("Funding after 2027 has not been identified in the plan.", corpus), false);
  });
});

describe("isSilenceMarker", () => {
  it("recognises the ways a model says the document is silent", () => {
    assert.equal(isSilenceMarker("NOT IN TEXT"), true);
    assert.equal(isSilenceMarker("Not in the original text."), true);
    assert.equal(isSilenceMarker(""), true);
    assert.equal(isSilenceMarker("The strategy is monitored through annual reporting"), false);
  });
});
