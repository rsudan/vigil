import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { categoryGuide } from "@/lib/category-guide";
import { readRooms } from "@/lib/room-read";
import { assertAccess } from "@/lib/server/access";
import { exaSearch } from "@/lib/server/exa";
import { parseJsonObject } from "@/lib/server/json";
import { resolveKey, resolveLlm } from "@/lib/server/keys";
import { chatComplete } from "@/lib/server/llm";
import { assertRateLimit } from "@/lib/server/rate-limit";
import { excerptFound, isSilenceMarker } from "@/lib/server/retrieval";
import { rooms as schema, validate } from "@/lib/server/schemas";
import type { Strategy } from "@/lib/types";

function clip(value: unknown, max: number) {
  return String(value ?? "").slice(0, max);
}

function normalizeUrl(u: string) {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * The search a room asks the world. It names the jurisdiction first, because
 * "has the money moved" is unanswerable without saying whose money, then the
 * sector, then what this room watches for. Kept short: Exa truncates at 400.
 */
export function roomQuery(strategy: Pick<Strategy, "jurisdiction" | "domain">, categoryId: number): string {
  const guide = categoryGuide(categoryId);
  const terms = guide.terms.split(" ").slice(0, 8).join(" ");
  return [strategy.jurisdiction, strategy.domain, guide.question, terms]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 380);
}

/**
 * Read the uploaded document into the ten rooms. No key, no model, no money:
 * lexical search over the stored chunks, so every line is a verbatim sentence
 * with the page it sits on. Replaces the previous read wholesale.
 */
export const readDocumentIntoRooms = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.read))
  .handler(async ({ context, data }) => {
    // Free of money, not of work: a full read is about half a second on a very
    // long strategy, so it is bounded like the other bulk operations.
    assertRateLimit(context.userId, "ingest");
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    // Every passage keeps the id of the document it was quoted from, not of the
    // newest one: a strategy can have several documents on file.
    const chunks = await sql<{ heading: string; body: string; documentId: number }>`
      select c.heading, c.body, d.id as "documentId" from document_chunks c
      join strategy_documents d on d.id = c.document_id
      where d.strategy_id = ${data.strategy_id}
      order by d.id, c.chunk_index
    `;
    if (!chunks.length) {
      const any = await sql<{ id: number }>`select id from strategy_documents where strategy_id = ${data.strategy_id} limit 1`;
      return {
        ok: false as const,
        error: any[0] ? "The stored document has no text to read." : "No document is stored for this strategy. Upload the strategy first.",
      };
    }
    const reads = readRooms(chunks);
    await sql.transaction(async (tx) => {
      await tx`delete from room_passages where strategy_id = ${data.strategy_id}`;
      await tx`delete from room_reads where strategy_id = ${data.strategy_id}`;
      for (const room of reads) {
        for (const p of room.passages) {
          if (p.documentId == null) continue;
          await tx`
            insert into room_passages (strategy_id, document_id, category, rank, locator, quote, terms_hit)
            values (${data.strategy_id}, ${p.documentId}, ${p.category}, ${p.rank}, ${p.locator}, ${p.quote}, ${p.terms_hit})
          `;
        }
        await tx`
          insert into room_reads (strategy_id, category, passages, terms_matched)
          values (${data.strategy_id}, ${room.category}, ${room.passages.length}, ${room.terms_matched})
          on conflict (strategy_id, category) do update
            set read_at = now(), passages = excluded.passages, terms_matched = excluded.terms_matched
        `;
      }
    });
    const spoke = reads.filter((r) => r.passages.length).length;
    const unmatched = reads.filter((r) => !r.terms_matched).length;
    return {
      ok: true as const,
      rooms: reads.length,
      spoke,
      silent: reads.length - spoke - unmatched,
      unmatched,
      passages: reads.reduce((n, r) => n + r.passages.length, 0),
    };
  });

/**
 * Ask the world about one room. One search and one model call, on the person's
 * own keys, only ever from an explicit click. Every candidate must cite one of
 * the sources the search returned; the rest are dropped and counted. Nothing
 * here colours the room: a candidate is a proposal until a person keeps it and
 * turns it into a watchpoint.
 */
export const searchRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.search))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "search");
    assertRateLimit(context.userId, "llm");
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const rows = await sql<Pick<Strategy, "jurisdiction" | "domain" | "title">>`
      select jurisdiction, domain, title from strategies where id = ${data.strategy_id}
    `;
    const strategy = rows[0];
    if (!strategy) throw new Error("Strategy not found");
    if (!strategy.jurisdiction.trim()) {
      return {
        ok: false as const,
        error:
          "Set the jurisdiction in Settings first. A room cannot ask the world what has changed here without naming whose country or organisation this strategy belongs to.",
      };
    }
    const guide = categoryGuide(data.category);
    const exa = await resolveKey(context.userId, "exa", data.sessionKeys);
    if (!exa) {
      return { ok: false as const, error: "Add an Exa key to search what has changed in this room." };
    }
    const llm = await resolveLlm(context.userId, data.sessionKeys);
    if (!llm) {
      return { ok: false as const, error: "Add a language-model key to read the search results into this room." };
    }

    const since = new Date();
    since.setFullYear(since.getFullYear() - data.recency_years);
    const sinceIso = since.toISOString().slice(0, 10);
    const query = roomQuery(strategy, data.category);
    const search = await exaSearch(exa.key, query, {
      numResults: 6,
      maxCharacters: 1600,
      startPublishedDate: sinceIso,
      tag: guide.short,
    });
    if (!search.ok) {
      return { ok: false as const, error: `Exa search failed (${search.status}). Check the Exa key.` };
    }
    const seen = new Set<string>();
    const sources = search.results.filter((r) => {
      if (!r.url || seen.has(normalizeUrl(r.url))) return false;
      seen.add(normalizeUrl(r.url));
      return true;
    });
    if (!sources.length) {
      return { ok: false as const, error: `Nothing published since ${sinceIso} came back for this room. Try a longer window.` };
    }

    const prompt = `You are reading search results into one room of a strategy monitor. Use ONLY the numbered sources below. Do not invent URLs, documents or facts.

ROOM ${guide.id}. ${guide.short} — ${guide.name}
The room asks: ${guide.question}
It looks for: ${guide.looksFor}

STRATEGY UNDER REVIEW
Jurisdiction: ${strategy.jurisdiction}
Title: ${strategy.title}
Sector: ${strategy.domain}

Return ONLY JSON:
{
  "findings": [{
    "source_index": 1-based index of the source you used,
    "title": "the source's title",
    "published_date": "YYYY-MM-DD or the year, or empty if the source gives none",
    "quote": "a sentence copied verbatim from that source's text",
    "why": "one or two sentences: what this bears on in this room, and which part of the strategy it touches. Do not say what should change."
  }]
}

Rules:
- At most 3 findings. Fewer is better. Return an empty list rather than a weak one.
- Every finding must come from one of the numbered sources, and quote it verbatim.
- Keep only what bears on ${strategy.jurisdiction} and on this room's question. A general explainer, a vendor page, or a piece about another country is not a finding here.
- Do not recommend a revision. Say what changed and what it bears on. A person decides.

SOURCES:
${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.publishedDate ?? "date unknown"})\nURL: ${s.url}\n${s.text}`).join("\n\n")}`;

    let parsed: Record<string, unknown>;
    try {
      const completion = await chatComplete({
        provider: llm.provider,
        key: llm.key,
        model: llm.model,
        json: true,
        maxTokens: 2500,
        task: "room",
        messages: [{ role: "user", content: prompt }],
      });
      parsed = parseJsonObject(completion.content);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Reading the results failed." };
    }

    const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]));
    const raw = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 6) : [];
    const kept: { title: string; url: string; published: string; quote: string; verified: boolean | null; why: string }[] = [];
    let dropped = 0;
    for (const item of raw) {
      const f = item as Record<string, unknown>;
      const idx = Number(f.source_index);
      const byIndex = Number.isInteger(idx) && idx >= 1 && idx <= sources.length ? sources[idx - 1] : undefined;
      const matched = byUrl.get(normalizeUrl(clip(f.url, 500))) ?? byIndex;
      if (!matched) {
        dropped += 1;
        continue;
      }
      const quote = clip(f.quote, 700);
      kept.push({
        title: clip(f.title, 240) || matched.title,
        url: matched.url,
        // The search knows the real publication date; the model's is a claim.
        published: (matched.publishedDate ?? "") || clip(f.published_date, 40),
        quote,
        // Checked against the text the search returned, so a sentence the model
        // invented and hung on a real URL is flagged rather than displayed as a
        // quotation.
        verified: isSilenceMarker(quote) ? null : excerptFound(quote, matched.text),
        why: clip(f.why, 700),
      });
    }
    // A source this room has already kept or dismissed does not come back as a
    // fresh proposal: that would quietly undo the decision.
    const decided = await sql<{ url: string }>`
      select url from room_findings where strategy_id = ${data.strategy_id} and category = ${data.category}
    `;
    const already = new Set(decided.map((r) => normalizeUrl(r.url)));
    const fresh = kept.filter((f) => !already.has(normalizeUrl(f.url)));
    const repeats = kept.length - fresh.length;
    // Only the first three are kept: a room may never look full.
    const shown = fresh.slice(0, 3);
    const beyond = fresh.length - shown.length;
    if (!shown.length) {
      return {
        ok: false as const,
        error:
          repeats && !dropped
            ? `Nothing new for this room: all ${repeats} result${repeats === 1 ? " was" : "s were"} already kept or dismissed here.`
            : `Nothing came back for this room that cites a returned source${dropped ? ` (${dropped} dropped)` : ""}${repeats ? `, ${repeats} already in this room` : ""}.`,
      };
    }
    await sql.transaction(async (tx) => {
      for (const f of shown) {
        await tx`
          insert into room_findings (strategy_id, user_id, category, title, url, published_date, quote, quote_verified, why, query)
          values (
            ${data.strategy_id}, ${context.userId}, ${data.category}, ${f.title}, ${f.url},
            ${f.published}, ${f.quote}, ${f.verified}, ${f.why}, ${query}
          )
        `;
      }
      await tx`update strategies set updated_at = now() where id = ${data.strategy_id}`;
    });
    return {
      ok: true as const,
      found: shown.length,
      sources: sources.length,
      dropped,
      beyond,
      repeats,
      unverified: shown.filter((f) => f.verified === false).length,
      query,
    };
  });

/** Keep or dismiss one candidate. Dated, attributed, and never deleted. */
export const decideRoomFinding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.decide))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      update room_findings
      set status = ${data.status}, decided_by = ${context.userId}, decided_at = now(),
          rationale = ${data.rationale ?? ""}
      where id = ${data.id} and strategy_id = ${data.strategy_id}
    `;
    await sql`update strategies set updated_at = now() where id = ${data.strategy_id}`;
    return { ok: true as const };
  });
