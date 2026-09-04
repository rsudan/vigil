import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonObject } from "./json.ts";

describe("parseJsonObject", () => {
  it("reads a fenced block", () => {
    assert.deepEqual(parseJsonObject('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
  });
  it("reads an object wrapped in prose", () => {
    assert.deepEqual(parseJsonObject('Sure. {"a": [1, 2]} Hope that helps.'), { a: [1, 2] });
  });
  it("rejects arrays and non-JSON", () => {
    assert.throws(() => parseJsonObject("[1,2]"), /did not return JSON/);
    assert.throws(() => parseJsonObject('{"a": '), /incomplete JSON/);
  });
});
