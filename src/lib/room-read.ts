import { CATEGORY_GUIDE } from "./category-guide.ts";
import { rankChunks, tokenize } from "./server/retrieval.ts";

/**
 * Reading the uploaded document into the ten rooms, with no model in the loop.
 *
 * Lexical search picks the chunks that answer a room's question; inside those
 * chunks a sentence is kept only if it carries at least two of that room's
 * terms. What comes out is a verbatim sentence and the page it sits on, so
 * every line is quotable and locatable: "if you cannot cite it, you did not
 * extract it". Nothing here is interpreted, and nothing here colours a room.
 *
 * Three outcomes, and they mean different things:
 *   passages         the document speaks here.
 *   silent           we searched the document and it does not.
 *   terms unmatched  the ten rooms' vocabulary barely appears in this text at
 *                    all, so the search failed rather than the document being
 *                    quiet. That is a fact about the document, usually its
 *                    language, so it is decided once for the whole document and
 *                    never inferred from one room's silence.
 */

export type RoomPassage = {
  category: number;
  rank: number;
  locator: string;
  quote: string;
  terms_hit: number;
  /** The document the sentence was quoted from, when several are stored. */
  documentId: number | null;
};
export type RoomRead = { category: number; passages: RoomPassage[]; terms_matched: boolean };
export type ReadChunk = { heading: string; body: string; documentId?: number | null };

/** At most this many passages per room. A room may never look full. */
export const MAX_PASSAGES = 2;
/** A sentence must carry this many distinct room terms to be worth quoting. */
export const MIN_TERMS = 2;
/**
 * The share of the ten rooms' whole vocabulary that must appear somewhere in the
 * document before any room may be called silent. This is a judgment about the
 * document, not about one room: an English strategy with nothing to say about
 * hazards is silent on that room, while a Romanian document fails every room at
 * once because the terms are in the wrong language.
 */
export const MIN_VOCABULARY_SHARE = 0.15;
/**
 * A sentence that answers more rooms than this answers none of them. The guard
 * belongs at the sentence, not the chunk: a well-written chapter legitimately
 * speaks to several rooms, but a sentence that fits everywhere is a foreword.
 */
export const MAX_ROOMS_PER_SENTENCE = 3;
/** Chunks searched per room before sentence selection. */
const CHUNKS_PER_ROOM = 8;

/**
 * Fold a word to the stem this matching cares about, so a room's term meets the
 * document's word however either was inflected: ministry meets ministries,
 * fund meets funding, allocation meets allocations. Both sides are folded the
 * same way, so the rule needs to be consistent rather than linguistically
 * correct.
 */
export function fold(token: string): string {
  let t = token;
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  return t;
}

/** A term plus the shapes a document is likely to write it in, for ranking. */
function variants(term: string): string[] {
  const stem = fold(term);
  return [...new Set([term, stem, `${stem}s`, `${stem}ing`, term.endsWith("y") ? `${term.slice(0, -1)}ies` : `${term}es`])];
}

function normalizeRepeat(s: string) {
  return s
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Abbreviations whose full stop ends a word, not a sentence. */
const ABBREVIATION = /\b(?:no|nr|art|alin|lit|para|pp?|cf|etc|vs|dr|mr|mrs|ms|fig|vol|ch|sec|ed|approx)\.$/i;

function splitSentences(body: string): string[] {
  const flat = body.replace(/\s+/g, " ");
  const out: string[] = [];
  let buf = "";
  for (const piece of flat.split(/(?<=[.;:!?])\s+|[•●]/)) {
    buf = buf ? `${buf} ${piece}` : piece;
    // "Decision No. 566/2024" is one sentence, not two.
    if (ABBREVIATION.test(buf)) continue;
    out.push(buf);
    buf = "";
  }
  if (buf) out.push(buf);
  return out
    .map((x) => x.trim())
    .filter((x) => x.length >= 60 && x.length <= 400 && /[a-z]{4}/i.test(x));
}

/**
 * A sentence repeated across half the document is a running header, page
 * furniture or boilerplate. Quoting a gazette masthead as what the document
 * says about resources would be worse than saying nothing.
 */
export function boilerplate(chunks: ReadChunk[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of chunks) {
    for (const key of new Set(splitSentences(c.body).map(normalizeRepeat))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const floor = Math.max(2, Math.ceil(chunks.length * 0.5));
  return new Set([...counts.entries()].filter(([, n]) => n >= floor).map(([k]) => k));
}

/**
 * Where a quote came from, in as few words as carry a reader back to it. A
 * paged chunk heading is "p. 16 · <first line of the page>", and on a gazette
 * or an official journal that first line is the running masthead, so the page
 * alone is the honest locator. Unpaged documents keep their heading.
 */
export function locatorOf(heading: string): string {
  const page = heading.match(/^p\.\s*[0-9]+(?:\s*[–-]\s*[0-9]+)?/);
  return (page ? page[0] : heading.slice(0, 80)).trim();
}

type Candidate = { quote: string; locator: string; hits: number; key: string; documentId: number | null };

/** Read every room out of one document. Deterministic: the same text gives the same rows. */
export function readRooms(chunks: ReadChunk[]): RoomRead[] {
  const junk = boilerplate(chunks);
  const corpus = new Set(chunks.flatMap((c) => tokenize(`${c.heading} ${c.body}`)).map(fold));

  // Does the rooms' vocabulary fit this text at all? Decided over all ten rooms
  // together, so one quiet room is never mistaken for a failed search.
  const vocabulary = new Set(CATEGORY_GUIDE.flatMap((g) => tokenize(g.terms).map(fold)));
  const present = [...vocabulary].filter((t) => corpus.has(t)).length;
  const fits = vocabulary.size > 0 && present / vocabulary.size >= MIN_VOCABULARY_SHARE;

  // Candidate sentences per room, before anything is chosen.
  const candidates = new Map<number, Candidate[]>();
  const matched = new Map<number, boolean>();
  const spread = new Map<string, number>();
  for (const guide of CATEGORY_GUIDE) {
    const terms = new Set(tokenize(guide.terms).map(fold));
    const found: Candidate[] = [];
    const seen = new Set<string>();
    for (const chunk of rankChunks(chunks, [guide.terms.split(" ").flatMap(variants).join(" ")], CHUNKS_PER_ROOM)) {
      for (const sentence of splitSentences(chunk.body)) {
        const key = normalizeRepeat(sentence);
        if (junk.has(key) || seen.has(key)) continue;
        const words = new Set(tokenize(sentence).map(fold));
        let hits = 0;
        for (const t of terms) if (words.has(t)) hits += 1;
        if (hits < MIN_TERMS) continue;
        seen.add(key);
        found.push({ quote: sentence, locator: locatorOf(chunk.heading), hits, key, documentId: chunk.documentId ?? null });
      }
    }
    candidates.set(guide.id, found);
    // Finding something to quote is itself proof the search reached the text.
    matched.set(guide.id, fits || found.length > 0);
    for (const key of seen) spread.set(key, (spread.get(key) ?? 0) + 1);
  }

  return CATEGORY_GUIDE.map((guide) => {
    const passages: RoomPassage[] = [];
    const found = (candidates.get(guide.id) ?? [])
      .filter((c) => (spread.get(c.key) ?? 0) <= MAX_ROOMS_PER_SENTENCE)
      .sort((a, b) => b.hits - a.hits || a.quote.length - b.quote.length);
    for (const c of found) {
      passages.push({
        category: guide.id,
        rank: passages.length,
        locator: c.locator,
        quote: c.quote,
        terms_hit: c.hits,
        documentId: c.documentId,
      });
      if (passages.length >= MAX_PASSAGES) break;
    }
    return { category: guide.id, passages, terms_matched: matched.get(guide.id) ?? false };
  });
}
