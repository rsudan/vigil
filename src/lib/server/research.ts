import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { resolveKey, resolveLlm } from "@/lib/server/keys";
import { chatComplete } from "@/lib/server/llm";
import { analyzeAllCategories } from "@/lib/category-analysis";
import { getStrategyBundle } from "@/lib/server/strategies";
import { CATEGORY_GUIDE } from "@/lib/category-guide";
import type { SessionKeys } from "@/lib/types";

function parseJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0) throw new Error("The model did not return JSON");
  return JSON.parse(end > start ? raw.slice(start, end + 1) : raw.slice(start)) as Record<string, unknown>;
}

async function loadChunks(strategyId: number, userId: string, limit = 24) {
  const sql = await getSql();
  return sql<{ heading: string; body: string }>`
    select c.heading, c.body from document_chunks c
    join strategy_documents d on d.id = c.document_id
    where d.strategy_id = ${strategyId} and d.user_id = ${userId}
    order by d.id, c.chunk_index
    limit ${limit}
  `;
}

function clip(s: unknown, n: number) {
  return String(s ?? "").slice(0, n);
}

export const draftAmendments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { strategy_id: number; sessionKeys?: SessionKeys }) => input)
  .handler(async ({ context, data }) => {
    const bundle = await getStrategyBundle({ data: { id: data.strategy_id } });
    const chunks = await loadChunks(data.strategy_id, context.userId);
    const llm = await resolveLlm(context.userId, data.sessionKeys);
    if (!llm) {
      return { ok: false as const, error: "Add a language-model key to draft changes against the original text." };
    }

    const weakening = bundle.assumptions.filter((a) => a.status === "weakening" || a.status === "broken");
    const gaps = analyzeAllCategories(bundle).filter((c) => c.verdict === "gap" || c.verdict === "high" || c.verdict === "severe");
    const excerpt = chunks
      .map((c) => `### ${c.heading}\n${c.body.slice(0, 1200)}`)
      .join("\n\n")
      .slice(0, 24000);

    const prompt = `You draft specific textual amendments to a national strategy. Cite the original. Do not invent chapters that are not in the excerpts.

Return ONLY JSON:
{
  "amendments": [{
    "intensity": "watch"|"amend"|"refresh"|"reset",
    "location": "chapter / annex / section as named in the original",
    "original_excerpt": "short quote from the original, or 'NOT IN TEXT' if the document is silent",
    "proposed_text": "the replacement or inserted paragraph, written as it should appear in the official document",
    "rationale": "why this intensity, in one or two sentences",
    "source": "monitor"
  }]
}

Rules:
- Every amendment must point at a location in the original (or say the original is silent).
- Prefer amend over refresh. Reset only if a load-bearing bet is broken.
- 3–8 amendments. No generic advice. Write the words that would go in the gazette.

STRATEGY TITLE: ${bundle.strategy.title}
DOMAIN: ${bundle.strategy.domain}
VISION: ${bundle.strategy.vision}

WEAKENING OR BROKEN BETS:
${weakening.map((a) => `- [${a.status} / if broken: ${a.implied_intensity}] ${a.claim}`).join("\n") || "(none)"}

QUEUE:
${bundle.queue.map((q) => `- ${q.intensity_hint}: ${q.title} — ${q.reason}`).join("\n") || "(empty)"}

ROOMS THAT ARE GAPS OR HIGH PRESSURE:
${gaps.map((g) => `- ${g.short}: ${g.reading}`).join("\n")}

ORIGINAL EXCERPTS:
${excerpt || "(no source text on file — use the bets and baselines as the original)"}`;

    let parsed: Record<string, unknown>;
    try {
      const completion = await chatComplete({
        provider: llm.provider,
        key: llm.key,
        model: llm.model,
        json: true,
        maxTokens: 5000,
        messages: [{ role: "user", content: prompt }],
      });
      parsed = parseJson(completion.content);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Drafting failed" };
    }

    const rows = Array.isArray(parsed.amendments) ? parsed.amendments.slice(0, 10) : [];
    if (!rows.length) return { ok: false as const, error: "The model returned no amendments." };

    const sql = await getSql();
    await sql`delete from amendments where strategy_id = ${data.strategy_id} and user_id = ${context.userId} and source = 'monitor'`;
    let n = 0;
    for (const raw of rows) {
      const a = raw as Record<string, string>;
      const intensity = ["watch", "amend", "refresh", "reset"].includes(a.intensity) ? a.intensity : "amend";
      const proposed = clip(a.proposed_text, 2000);
      if (!proposed) continue;
      await sql`
        insert into amendments (
          strategy_id, user_id, intensity, location, original_excerpt, proposed_text, rationale, source
        ) values (
          ${data.strategy_id}, ${context.userId}, ${intensity}, ${clip(a.location, 240)},
          ${clip(a.original_excerpt, 1200)}, ${proposed}, ${clip(a.rationale, 800)}, 'monitor'
        )
      `;
      n += 1;
    }
    return { ok: true as const, count: n };
  });

export const researchPeers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { strategy_id: number; recency_years: number; sessionKeys?: SessionKeys }) => input)
  .handler(async ({ context, data }) => {
    const years = [1, 2, 3, 5, 10].includes(data.recency_years) ? data.recency_years : 5;
    const since = new Date();
    since.setFullYear(since.getFullYear() - years);
    const sinceIso = since.toISOString().slice(0, 10);

    const bundle = await getStrategyBundle({ data: { id: data.strategy_id } });
    const domain = bundle.strategy.domain || "national strategy";
    const title = bundle.strategy.title;
    const query = `national ${domain} strategy OR roadmap published after ${sinceIso}`;

    const exa = await resolveKey(context.userId, "exa", data.sessionKeys);
    const sources: { title: string; url: string; text: string; publishedDate: string | null }[] = [];

    if (exa) {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": exa.key },
        body: JSON.stringify({
          query,
          numResults: 8,
          type: "auto",
          startPublishedDate: sinceIso,
          contents: { text: { maxCharacters: 1400 } },
        }),
      });
      if (!res.ok) {
        return { ok: false as const, error: `Exa search failed (${res.status}). Check the Exa key.` };
      }
      const body = (await res.json()) as {
        results?: { title?: string; url?: string; text?: string; publishedDate?: string }[];
      };
      for (const r of body.results ?? []) {
        sources.push({
          title: r.title ?? "Untitled",
          url: r.url ?? "",
          text: (r.text ?? "").slice(0, 1400),
          publishedDate: r.publishedDate ?? null,
        });
      }
    }

    const llm = await resolveLlm(context.userId, data.sessionKeys);
    if (!llm) {
      return { ok: false as const, error: "Add a language-model key to write the peer research brief." };
    }
    if (!sources.length && !exa) {
      return {
        ok: false as const,
        error: "Add an Exa key to search other countries’ recent strategies. The research brief is grounded in those results, not in memory.",
      };
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
      `Gaps:`,
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
    "country": "country or institution",
    "title": "document title from the source",
    "year": "YYYY or unknown",
    "url": "url from the source",
    "idea": "one concrete idea that could be incorporated",
    "relevance": "why this matters for the strategy under review, citing the gap or bet",
    "intensity": "watch"|"amend"|"refresh"|"reset",
    "category": 1-10
  }]
}

Rules:
- 4–8 findings. Each must have a URL from the sources.
- Map each idea to one of the ten rooms and an intensity.
- If a source is not a national strategy, you may still use it if it is a comparable official roadmap, but say so.
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
        messages: [{ role: "user", content: prompt }],
      });
      parsed = parseJson(completion.content);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Research synthesis failed" };
    }

    const findings = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 10) : [];
    const summary = clip(parsed.summary, 4000);
    if (!findings.length) return { ok: false as const, error: "The model returned no peer findings." };

    const sql = await getSql();
    const research = await sql<{ id: number }>`
      insert into peer_research (strategy_id, user_id, recency_years, query, summary)
      values (${data.strategy_id}, ${context.userId}, ${years}, ${query}, ${summary})
      returning id
    `;
    const researchId = research[0]!.id;
    for (const raw of findings) {
      const f = raw as Record<string, unknown>;
      const cat = Number(f.category);
      await sql`
        insert into peer_findings (research_id, country, title, year, url, idea, relevance, intensity, category)
        values (
          ${researchId}, ${clip(f.country, 80)}, ${clip(f.title, 240)}, ${clip(f.year, 12)},
          ${clip(f.url, 500)}, ${clip(f.idea, 800)}, ${clip(f.relevance, 800)},
          ${["watch", "amend", "refresh", "reset"].includes(String(f.intensity)) ? String(f.intensity) : "watch"},
          ${Number.isFinite(cat) && cat >= 1 && cat <= 10 ? cat : null}
        )
      `;
    }

    // Peer-sourced amendment stubs so they appear in the revision brief.
    for (const raw of findings) {
      const f = raw as Record<string, unknown>;
      const intensity = ["watch", "amend", "refresh", "reset"].includes(String(f.intensity))
        ? String(f.intensity)
        : "watch";
      if (intensity === "watch") continue;
      await sql`
        insert into amendments (
          strategy_id, user_id, intensity, location, original_excerpt, proposed_text, rationale, source
        ) values (
          ${data.strategy_id}, ${context.userId}, ${intensity},
          ${`Peer: ${clip(f.country, 80)} — ${clip(f.title, 180)}`},
          ${"Not in the original text — learned from a peer strategy."},
          ${clip(f.idea, 2000)},
          ${clip(f.relevance, 800)},
          'peer'
        )
      `;
    }

    return { ok: true as const, id: researchId, sources: sources.length, findings: findings.length };
  });
