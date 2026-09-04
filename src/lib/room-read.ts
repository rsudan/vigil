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
/** Derivations no suffix rule reaches, in the words strategies actually use. */
const DERIVED: Record<string, string> = {
  assume: "assumption",
  assumes: "assumption",
  assumed: "assumption",
  assuming: "assumption",
  assumption: "assumption",
  vulnerable: "vulnerability",
  vulnerability: "vulnerability",
  finance: "financing",
  financial: "financing",
  financing: "financing",
  financed: "financing",
  fund: "funding",
  funds: "funding",
  funded: "funding",
  funding: "funding",
  govern: "governance",
  governance: "governance",
  legal: "legal",
  legally: "legal",
  legislation: "legal",
  legislative: "legal",
  institution: "institutional",
  institutions: "institutional",
  institutional: "institutional",
  coordinate: "coordination",
  coordinates: "coordination",
  coordinating: "coordination",
  coordination: "coordination",
  participate: "participation",
  participation: "participation",
  evaluate: "evaluation",
  evaluating: "evaluation",
  evaluation: "evaluation",
  implement: "implementation",
  implementing: "implementation",
  implementation: "implementation",
};

export function fold(token: string): string {
  const derived = DERIVED[token];
  if (derived) return derived;
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

/** Words a wrapped line of prose ends on; a heading never does. */
const DANGLING = /\b(?:of|the|a|an|in|on|at|to|for|and|or|with|by|as|is|are|was|were|that|which|from|into|than|then|its|their|this|these|those|be|been|has|have|had|not|no|but|per|over|under|between)$/i;

/**
 * A line that titles what follows rather than saying anything itself. Getting
 * this right is what stops "4.5. Poverty, Inclusion, and Social Cohesion" being
 * welded onto the sentence beneath it and quoted as one.
 */
function isHeading(line: string, next?: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const words = t.split(/\s+/).length;
  if (/[,;]$/.test(t)) return false;
  if (words <= 12 && /:$/.test(t)) return true;
  if (words <= 12 && /^\d+(\.\d+)*\.?\s+\S/.test(t) && !/[.!?]$/.test(t)) return true;
  if (words <= 14 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) return true;
  // A short line that ends no sentence, dangles on no word, and is followed by a
  // fresh capital is a title: "Legislative Framework and Institutional Development".
  if (words <= 10 && !/[.!?:;]$/.test(t) && /^[A-Z0-9]/.test(t) && !DANGLING.test(t) && next && /^[A-Z]/.test(next.trim())) {
    return true;
  }
  return false;
}

/** A line that opens a new item in a list, rather than continuing the last one. */
function isListItem(line: string): boolean {
  return /^\s*(?:\d+[.)]|[-*\u2022\u25cf\u25aa\u2013])\s+\S/.test(line);
}

function stripMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]|[-*\u2022\u25cf\u25aa\u2013])\s+/, "").trim();
}

/**
 * Table rows, column headers and all-caps titles read as prose once a PDF has
 * been flattened, and quoting one as what the document says would be worse than
 * saying nothing. Keep only text that reads like a sentence a person wrote.
 */
export function readsLikeProse(text: string, fromList = false): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  if (!/\b[a-z]{4,}\b/.test(text)) return false;
  // A sentence starts where a sentence starts. A fragment carved out of a table
  // cell begins in the middle of a phrase; only a list item may begin lowercase.
  if (!fromList && !/^[A-Z0-9"“(]/.test(text)) return false;
  const shouty = tokens.filter((t) => /^[A-Z][A-Z/.-]{1,7}$/.test(t)).length;
  if (shouty / tokens.length > 0.25) return false;
  // "Implementation Period Expected Results Evaluation Stages Indicators Targets
  // Funding Sources" is a column-header strip, not a sentence.
  const titled = tokens.filter((t) => /^[A-Z][a-z]/.test(t)).length;
  if (tokens.length >= 8 && titled / tokens.length >= 0.4) return false;
  const numbers = text.match(/\d{2,}/g) ?? [];
  if (numbers.length >= 4) return false;
  const lower = tokens.filter((t) => /^[a-z]/.test(t)).length;
  return lower / tokens.length >= 0.35;
}

/**
 * The quotable sentences in one chunk. Lines are honoured before anything is
 * flattened: a heading titles what follows rather than belonging to it, a list
 * item stands on its own, and a wrapped paragraph is rejoined before it is
 * split. Sentences end at a full stop, never at a semicolon or a colon, because
 * a clause cut off from "the strategy does not provide for the following:"
 * would assert the opposite of the document.
 */
function splitSentences(body: string, furniture: Set<string> = new Set()): string[] {
  const out: { text: string; fromList: boolean }[] = [];
  let para: string[] = [];
  let fromList = false;
  const flush = () => {
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    const wasList = fromList;
    para = [];
    fromList = false;
    if (!text) return;
    let buf = "";
    let first = true;
    for (const piece of text.split(/(?<=[.!?])\s+/)) {
      buf = buf ? `${buf} ${piece}` : piece;
      // "Decision No. 566/2024" is one sentence, not two.
      if (ABBREVIATION.test(buf)) continue;
      out.push({ text: buf, fromList: wasList && first });
      first = false;
      buf = "";
    }
    if (buf) out.push({ text: buf, fromList: wasList && first });
  };
  const lines = body.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || furniture.has(normalizeRepeat(line)) || isHeading(line, lines[i + 1])) {
      flush();
      return;
    }
    if (isListItem(line)) {
      flush();
      fromList = true;
      para.push(stripMarker(line));
      return;
    }
    para.push(line);
  });
  flush();
  return out
    .map((x) => ({ ...x, text: x.text.trim().replace(/[;,]$/, "") }))
    .filter((x) => x.text.length >= 60 && x.text.length <= 400 && readsLikeProse(x.text, x.fromList))
    .map((x) => x.text);
}

/**
 * Lines that recur across the document are running headers, page furniture or
 * boilerplate: the masthead of an official journal carries the page number, so
 * every occurrence differs until the digits are stripped. Quoting one as what
 * the document says about resources would be worse than saying nothing.
 */
export function boilerplate(chunks: ReadChunk[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of chunks) {
    const lines = new Set(
      c.body
        .split("\n")
        .map((l) => normalizeRepeat(l))
        .filter((l) => l.length >= 8),
    );
    for (const key of lines) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const floor = Math.max(2, Math.ceil(chunks.length * 0.25));
  return new Set([...counts.entries()].filter(([, n]) => n >= floor).map(([k]) => k));
}

/**
 * Where a quote came from, in as few words as carry a reader back to it.
 *
 * A paged chunk heading is "p. 16 · <first line of the page>", and on a gazette
 * that first line is the running masthead, so the page alone is the honest
 * locator. A Word, text or pasted document has no pages, and its heading is
 * only the chunk's first line, which is as likely to be furniture as a title:
 * there, the position in the document is the one thing that carries a reader
 * back, so say that instead of quoting a masthead as a citation.
 */
export function locatorOf(heading: string, position?: { index: number; total: number }): string {
  const page = heading.match(/^p\.\s*[0-9]+(?:\s*[–-]\s*[0-9]+)?/);
  if (page) return page[0].trim();
  const title = heading.trim();
  if (title && title.length <= 70 && isHeading(title, "A")) return title;
  return position ? `part ${position.index + 1} of ${position.total}` : title.slice(0, 70);
}

type Candidate = { quote: string; locator: string; hits: number; key: string; documentId: number | null };

/** Read every room out of one document. Deterministic: the same text gives the same rows. */
export function readRooms(chunks: ReadChunk[]): RoomRead[] {
  const junk = boilerplate(chunks);
  const corpus = new Set(chunks.flatMap((c) => tokenize(`${c.heading} ${c.body}`)).map(fold));

  // Does the rooms' vocabulary fit this text at all? Decided over all ten rooms
  // together, so one quiet room is never mistaken for a failed search.
  const index = new Map(chunks.map((c, i) => [c, i] as const));
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
      const at = index.get(chunk) ?? 0;
      for (const sentence of splitSentences(chunk.body, junk)) {
        const key = normalizeRepeat(sentence);
        if (seen.has(key)) continue;
        const words = new Set(tokenize(sentence).map(fold));
        let hits = 0;
        for (const t of terms) if (words.has(t)) hits += 1;
        if (hits < MIN_TERMS) continue;
        seen.add(key);
        found.push({
          quote: sentence,
          locator: locatorOf(chunk.heading, { index: at, total: chunks.length }),
          hits,
          key,
          documentId: chunk.documentId ?? null,
        });
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
