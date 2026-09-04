/**
 * Lexical retrieval over stored document chunks, and verification that a quoted
 * excerpt really appears in the stored text. No model in the loop.
 */
const STOP = new Set(
  "the a an and or of to in on for with by is are be been that this it as at from not will shall its their which was were has have had but if then than into over under per any all no nor do does can may would should could we our you your they them these those there here also such more most other some each every one two new".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Rank chunks against a set of query strings (BM25) and return the best `take`
 * in document order, so the excerpt still reads as the document does.
 */
export function rankChunks<T extends { heading: string; body: string }>(
  chunks: T[],
  queries: string[],
  take: number,
): T[] {
  if (!chunks.length || take <= 0) return [];
  const docs = chunks.map((c) => tokenize(`${c.heading} ${c.body}`));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / n || 1;
  const terms = new Set(queries.flatMap(tokenize));
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const dfT = df.get(t) ?? 0;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    return { i, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, c) => c.score - a.score)
    .slice(0, take)
    .sort((a, c) => a.i - c.i)
    .map((x) => chunks[x.i]!);
}

export function normalizeForMatch(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”"„«»]/g, "")
    .replace(/[‘’`´']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the excerpt reads like "the original is silent" rather than a quotation. */
export function isSilenceMarker(excerpt: string) {
  const e = excerpt.trim().toLowerCase();
  if (!e) return true;
  return /^(not in (the )?(original )?text|not in the original|the (original|document) is silent|silent|none|n\/a|—|-)\.?$/.test(e);
}

/**
 * Does `excerpt` appear in `corpus`? Whitespace, quotes and dashes are
 * normalized. An excerpt with elisions ("…" or "...") matches when each piece of
 * at least 20 characters appears in order.
 */
export function excerptFound(excerpt: string, corpus: string): boolean {
  const c = normalizeForMatch(corpus);
  const whole = normalizeForMatch(excerpt.replace(/(?:…|\.\.\.)/g, " "));
  if (whole.length < 12) return false;
  if (c.includes(whole)) return true;
  const pieces = excerpt
    .split(/(?:…|\.\.\.)/)
    .map(normalizeForMatch)
    .filter((p) => p.length >= 20);
  if (pieces.length < 2) return false;
  let pos = 0;
  for (const piece of pieces) {
    const idx = c.indexOf(piece, pos);
    if (idx < 0) return false;
    pos = idx + piece.length;
  }
  return true;
}
