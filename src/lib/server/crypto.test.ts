import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, isEncrypted, keyFromSecret } from "./crypto.ts";

describe("secret encryption", () => {
  it("round-trips and never stores the plaintext", async () => {
    const key = await keyFromSecret("test-secret");
    const stored = await encryptSecret("sk-live-1234567890", key);
    assert.ok(isEncrypted(stored));
    assert.ok(!stored.includes("1234567890"));
    assert.equal(await decryptSecret(stored, key), "sk-live-1234567890");
  });
  it("uses a fresh nonce every time", async () => {
    const key = await keyFromSecret("test-secret");
    assert.notEqual(await encryptSecret("same", key), await encryptSecret("same", key));
  });
  it("passes legacy plaintext rows through unchanged", async () => {
    const key = await keyFromSecret("test-secret");
    assert.equal(await decryptSecret("plain-old-key", key), "plain-old-key");
  });
  it("refuses a value encrypted under another secret", async () => {
    const stored = await encryptSecret("abc", await keyFromSecret("test-secret"));
    await assert.rejects(decryptSecret(stored, await keyFromSecret("other")));
  });
});
