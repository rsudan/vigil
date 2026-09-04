/**
 * Per-user token buckets for the calls that spend money (language models,
 * search, key tests). In-memory, so a serverless deployment enforces it per
 * warm instance; that still stops a runaway client or a scripted signup.
 */
export type RateLimitRule = { limit: number; windowMs: number };

export const RATE_LIMITS = {
  llm: { limit: 20, windowMs: 10 * 60_000 },
  search: { limit: 40, windowMs: 10 * 60_000 },
  keys: { limit: 30, windowMs: 10 * 60_000 },
  ingest: { limit: 40, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): { ok: true; remaining: number } | { ok: false; retryAfterMs: number } {
  const refillPerMs = rule.limit / rule.windowMs;
  const b = buckets.get(key) ?? { tokens: rule.limit, updated: now };
  b.tokens = Math.min(rule.limit, b.tokens + Math.max(0, now - b.updated) * refillPerMs);
  b.updated = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(key, b);
    return { ok: true, remaining: Math.floor(b.tokens) };
  }
  buckets.set(key, b);
  return { ok: false, retryAfterMs: Math.ceil((1 - b.tokens) / refillPerMs) };
}

/** Throw a readable error when `userId` has exhausted `bucket`. */
export function assertRateLimit(userId: string, bucket: RateLimitBucket, now = Date.now()) {
  const res = checkRateLimit(`${bucket}:${userId}`, RATE_LIMITS[bucket], now);
  if (!res.ok) {
    const seconds = Math.max(1, Math.ceil(res.retryAfterMs / 1000));
    throw new Error(`Too many ${bucket} requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
