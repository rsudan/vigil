import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertRateLimit, checkRateLimit, resetRateLimits } from "./rate-limit.ts";

describe("rate limit", () => {
  it("allows the bucket size, then refuses until the window refills", () => {
    resetRateLimits();
    const rule = { limit: 3, windowMs: 60_000 };
    const t0 = 1_000_000;
    assert.equal(checkRateLimit("k", rule, t0).ok, true);
    assert.equal(checkRateLimit("k", rule, t0).ok, true);
    assert.equal(checkRateLimit("k", rule, t0).ok, true);
    const blocked = checkRateLimit("k", rule, t0);
    assert.equal(blocked.ok, false);
    assert.equal(checkRateLimit("k", rule, t0 + 20_000).ok, true, "one token refills after a third of the window");
  });
  it("throws a readable message from assertRateLimit", () => {
    resetRateLimits();
    for (let i = 0; i < 20; i += 1) assertRateLimit("u1", "llm", 0);
    assert.throws(() => assertRateLimit("u1", "llm", 0), /Too many llm requests/);
    assert.doesNotThrow(() => assertRateLimit("u2", "llm", 0), "limits are per user");
  });
});
