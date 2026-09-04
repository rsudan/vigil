import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertAccess } from "@/lib/server/access";
import { parseJsonObject } from "@/lib/server/json";
import { resolveKey, resolveLlm } from "@/lib/server/keys";
import { chatComplete } from "@/lib/server/llm";
import { exaSearch } from "@/lib/server/exa";
import { assertRateLimit } from "@/lib/server/rate-limit";
import { excerptFound, isSilenceMarker, rankChunks } from "@/lib/server/retrieval";
import { research as schema, validate } from "@/lib/server/schemas";
import { loadBundle } from "@/lib/server/strategies";
import { analyzeAllCategories } from "@/lib/category-analysis";
import { thresholdText } from "@/lib/compute";
import { CATEGORY_GUIDE } from "@/lib/category-guide";
import { REVISION_INTENSITIES } from "@/lib/taxonomy";

type Chunk = { heading: string; body: string };

async function loadChunks(strategyId: number): Promise<Chunk[]> {
  const sql = await getSql();
  return sql<Chunk>`
    select c.heading, c.body from document_chunks c
    join strategy_documents d on d.id = c.document_id
    where d.strategy_id = ${strategyId}
    order by d.id, c.chunk_index
  `;
}

function clip(s: unknown, n: number) {
  return String(s ?? "").slice(0, n);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeUrl(u: string) {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

export const draftAmendments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.draft))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "llm");
    const role = await assertAccess(context.userId, data.strategy_id, "editor");
    const bundle = await loadBundle(context.userId, data.strategy_id, { role });
    const chunks = await loadChunks(data.strategy_id);
    const llm = await resolveLlm(context.userId, data.sessionKeys);
    if (!llm) {
      return { ok: false as const, error: "Add a language-model key to draft changes against the original text." };
    }

    const moving = bundle.assumptions.filter((a) => a.status === "weakening" || a.status === "broken");
    const rooms = analyzeAllCategories(bundle);
    const gaps = rooms.filter((c) => c.verdict === "gap" || c.verdict === "high" || c.verdict === "severe");
    const crossed = bundle.signals.filter((s) => s.status === "active" && s.crossed_level !== "none");
    const peerIdeas = bundle.peer_research?.findings ?? [];

    // Retrieve the passages that matter for what has moved, wherever they sit in the document.
    const queries = [
      ...moving.map((a) => a.claim),
      ...bundle.queue.map((q) => `${q.title} ${q.reason}`),
      ...gaps.map((g) => `${g.question} ${g.looksFor}`),
      ...crossed.map((s) => `${s.name} ${s.baseline} ${thresholdText(s, s.crossed_level)}`),
      ...peerIdeas.map((f) => f.idea),
      "monitoring evaluation review revision financing budget",
    ];
    const selected = chunks.length ? rankChunks(chunks, queries, 14) : [];
    const excerpt = selected
      .map((c) => `### ${c.heading}\n${c.body.slice(0, 2400)}`)
      .join("\n\n")
      .slice(0, 40000);
    const language = bundle.strategy.language.trim();

    const prompt = `You draft specific textual amendments to a national strategy. Cite the original. Do not invent chapters that are not in the excerpts.

Return ONLY JSON:
{
  "amendments": [{
    "intensity": "watch"|"amend"|"refresh"|"reset",
    "location": "chapter / annex / section / page as labelled in the excerpts",
    "original_excerpt": "an exact quotation copied from the excerpts, or 'NOT IN TEXT' if the document is silent",
    "proposed_text": "the replacement or inserted paragraph, written as it should appear in the official document",
    "rationale": "why this intensity, in one or two sentences",
    "source": "monitor" or "peer"
  }]
}

Rules:
- Every amendment points at a location in the excerpts, or says the original is silent.
- original_excerpt must be copied verbatim from the excerpts (you may shorten with …). Never paraphrase a quotation.
- Prefer amend over refresh. Reset only if a load-bearing bet is broken.
- 3–8 amendments. No generic advice. Write the words that would go in the gazette.
- Write proposed_text in ${language || "the language of the excerpts"}. Write location and rationale in English.
- Where an amendment adopts an idea from the PEER IDEAS list, set source to "peer" and still write it as text for this document.

STRATEGY TITLE: ${bundle.strategy.title}
DOMAIN: ${bundle.strategy.domain}
VISION: ${bundle.strategy.vision}

WEAKENING OR BROKEN BETS:
${moving.map((a) => `- [${a.status} / if broken: ${a.implied_intensity}] ${a.claim}`).join("\n") || "(none)"}

THRESHOLDS CROSSED:
${crossed.map((s) => `- ${s.name}: reading "${s.current_value}" crossed the ${s.crossed_level} threshold (${thresholdText(s, s.crossed_level)})`).join("\n") || "(none)"}

QUEUE:
${bundle.queue.map((q) => `- ${q.intensity_hint}: ${q.title} — ${q.reason}`).join("\n") || "(empty)"}

ROOMS THAT ARE GAPS OR HIGH PRESSURE:
${gaps.map((g) => `- ${g.short}: ${g.reading}`).join("\n") || "(none)"}

PEER IDEAS:
${peerIdeas.map((f, i) => `[${i + 1}] ${f.country} — ${f.title}: ${f.idea}`).join("\n") || "(none)"}

ORIGINAL EXCERPTS:
${excerpt || "(no source text on file — use the bets and baselines as the original and mark every excerpt NOT IN TEXT)"}`;

    let parsed: Record<string, unknown>;
    try {
      const completion = await chatComplete({
        provider: llm.provider,
        key: llm.key,
        model: llm.model,
        json: true,
        maxTokens: 6000,
        task: "draft",
        messages: [{ role: "user", content: prompt }],
      });
      parsed = parseJsonObject(completion.content);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Drafting failed" };
    }

    const rows = Array.isArray(parsed.amendments) ? parsed.amendments.slice(0, 10) : [];
    if (!rows.length) return { ok: false as const, error: "The model returned no amendments." };

    const corpus = chunks.map((c) => c.body).join("\n");
    const sql = await getSql();
    let n = 0;
    let unverified = 0;
    await sql.transaction(async (tx) => {
      await tx`delete from amendments where strategy_id = ${data.strategy_id}`;
      for (const raw of rows) {
        const a = raw as Record<string, unknown>;
        const proposed = clip(a.proposed_text, 2000).trim();
        if (!proposed) continue;
        const excerptText = clip(a.original_excerpt, 1200).trim();
        const silent = isSilenceMarker(excerptText);
        const verified = silent ? null : corpus.length ? excerptFound(excerptText, corpus) : false;
        if (verified === false) unverified += 1;
        await tx`
          insert into amendments (
            strategy_id, user_id, intensity, location, original_excerpt, proposed_text, rationale, source, excerpt_verified
          ) values (
            ${data.strategy_id}, ${context.userId}, ${oneOf(a.intensity, REVISION_INTENSITIES, "amend")},
            ${clip(a.location, 240)}, ${silent ? "" : excerptText}, ${proposed}, ${clip(a.rationale, 800)},
            ${a.source === "peer" ? "peer" : "monitor"}, ${verified}
          )
        `;
        n += 1;
      }
      await tx`update strategies set updated_at = now() where id = ${data.strategy_id}`;
    });
    return { ok: true as const, count: n, unverified, grounded: selected.length };
  });

export const researchPeers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.peers))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "search");
    assertRateLimit(context.userId, "llm");
    const role = await assertAccess(context.userId, data.strategy_id, "editor");
    const years = [1, 2, 3, 5, 10].includes(data.recency_years) ? data.recency_years : 5;
    const since = new Date();
    since.setFullYear(since.getFullYear() - years);
    const sinceIso = since.toISOString().slice(0, 10);

    const bundle = await loadBundle(context.userId, data.strategy_id, { role });
    const domain = bundle.strategy.domain.trim() || "national development";
    const title = bundle.strategy.title;
    const query = `national ${domain} strategy or roadmap`;

    const exa = await resolveKey(context.userId, "exa", data.sessionKeys);
    if (!exa) {
      return {
        ok: false as const,
        error: "Add an Exa key to search other countries’ recent strategies. The research brief is grounded in those results, not in memory.",
      };
    }
    const llm = await resolveLlm(context.userId, data.sessionKeys);
    if (!llm) {
      return { ok: false as const, error: "Add a language-model key to write the peer research brief." };
    }

    const search = await exaSearch(exa.key, query, { numResults: 10, maxCharacters: 1600, startPublishedDate: sinceIso });
    if (!search.ok) {
      return { ok: false as const, error: `Exa search failed (${search.status}). Check the Exa key.` };
    }
    const seen = new Set<string>();
    const sources: { title: string; url: string; text: string; publishedDate: string | null }[] = [];
    for (const r of search.results) {
      if (!r.url || seen.has(normalizeUrl(r.url))) continue;
      seen.add(normalizeUrl(r.url));
      sources.push(r);
    }
    if (!sources.length) {
      return { ok: false as const, error: `No peer strategies found since ${sinceIso}. Try a longer recency.` };
    }

    const rooms = CATEGORY_GUIDE.map((c) => `${c.id}. ${c.short}: ${c.question}`).join("\n");
    const snapshot = [
      `Title: ${title}`,
      `Domain: ${domain}`,
      `Vision: ${bundle.strategy.vision}`,
      `Weakening/broken bets:`,
      ...bundle.assumptions
        .filter((a) => a.status === "weakening" || a.status === "broken")
        .map((a) => `- ${a.claim}`),
      `Rooms with no watchpoint:`,
      ...analyzeAllCategories(bundle)
        .filter((c) => c.verdict === "gap")
        .map((c) => `- ${c.short}`),
    ].join("\n");

    const sourceBlock = sources
      .map(
        (s, i) =>
          `[${i + 1}] ${s.title} (${s.publishedDate ?? "date unknown"})\nURL: ${s.url}\n${s.text}`,
      )
      .join("\n\n");

    const prompt = `Compare this country's strategy with peer national strategies found in the search results. Use ONLY those sources. Do not invent URLs or documents.

Return ONLY JSON:
{
  "summary": "2–4 paragraphs: what peers are doing that this strategy is not, and what not to copy",
  "findings": [{
    "source_index": 1-based index of the search result,
    "country": "country or institution",
    "title": "document title from the source",
    "year": "YYYY or unknown",
    "url": "url copied from that source",
    "idea": "one concrete idea that could be incorporated",
    "relevance": "why this matters for the strategy under review, citing the gap or bet",
    "intensity": "watch"|"amend"|"refresh"|"reset",
    "category": 1-10
  }]
}

Rules:
- 4–8 findings. Each must come from one of the numbered sources; copy its URL exactly.
- Skip a source that is the strategy under review itself, or not an official strategy, roadmap, or evaluation.
- Map each idea to one of the ten rooms and an intensity.
- Recency window: documents from ${sinceIso} onward.

TEN ROOMS:
${rooms}

STRATEGY UNDER REVIEW:
${snapshot}

SEARCH RESULTS:
${sourceBlock}`;

    let parsed: Record<string, unknown>;
    try {
      const completion = await chatComplete({
        provider: llm.provider,
        key: llm.key,
        model: llm.model,
        json: true,
        maxTokens: 5000,
        task: "peers",
        messages: [{ role: "user", content: prompt }],
      });
      parsed = parseJsonObject(completion.content);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Research synthesis failed" };
    }

    const byUrl = new Map(sources.map((s) => [normalizeUrl(s.url), s]));
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 12) : [];
    const findings: {
      country: string;
      title: string;
      year: string;
      url: string;
      idea: string;
      relevance: string;
      intensity: string;
      category: number | null;
    }[] = [];
    let dropped = 0;
    for (const raw of rawFindings) {
      const f = raw as Record<string, unknown>;
      const idx = Number(f.source_index);
      const byIndex = Number.isInteger(idx) && idx >= 1 && idx <= sources.length ? sources[idx - 1] : undefined;
      const matched = byUrl.get(normalizeUrl(clip(f.url, 500))) ?? byIndex;
      if (!matched) {
        dropped += 1;
        continue;
      }
      const cat = Number(f.category);
      findings.push({
        country: clip(f.country, 80),
        title: clip(f.title, 240) || matched.title,
        year: clip(f.year, 12),
        url: matched.url,
        idea: clip(f.idea, 800),
        relevance: clip(f.relevance, 800),
        intensity: oneOf(f.intensity, REVISION_INTENSITIES, "watch"),
        category: Number.isFinite(cat) && cat >= 1 && cat <= 10 ? cat : null,
      });
    }
    const summary = clip(parsed.summary, 4000);
    if (!findings.length) {
      return { ok: false as const, error: "The model returned no findings tied to the sources. Try again or widen the window." };
    }

    const sql = await getSql();
    const researchId = await sql.transaction(async (tx) => {
      const research = await tx<{ id: number }>`
        insert into peer_research (strategy_id, user_id, recency_years, query, summary)
        values (${data.strategy_id}, ${context.userId}, ${years}, ${query}, ${summary})
        returning id
      `;
      const id = research[0]!.id;
      for (const f of findings) {
        await tx`
          insert into peer_findings (research_id, country, title, year, url, idea, relevance, intensity, category)
          values (${id}, ${f.country}, ${f.title}, ${f.year}, ${f.url}, ${f.idea}, ${f.relevance}, ${f.intensity}, ${f.category})
        `;
      }
      // Peer findings are ideas, not gazette text. Earlier versions copied them
      // straight into amendments; clear those so the brief stops presenting them as drafts.
      await tx`delete from amendments where strategy_id = ${data.strategy_id} and source = 'peer' and excerpt_verified is null and original_excerpt like 'Not in the original text%'`;
      await tx`update strategies set updated_at = now() where id = ${data.strategy_id}`;
      return id;
    });

    return { ok: true as const, id: researchId, sources: sources.length, findings: findings.length, dropped };
  });
