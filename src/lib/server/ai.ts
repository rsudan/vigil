import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { chunkPages, chunkText, joinChunks, type ParsedChunk } from "@/lib/chunk";
import { getSql } from "@/lib/db";
import { assertAccess } from "@/lib/server/access";
import { exaSearch } from "@/lib/server/exa";
import { extractionNote, runExtraction, type ExtractionRun } from "@/lib/server/extract";
import { resolveKey, resolveLlm } from "@/lib/server/keys";
import { MOCK_JINA_MARKDOWN, isMockKey } from "@/lib/server/mock";
import { assertRateLimit } from "@/lib/server/rate-limit";
import { ai as schema, validate } from "@/lib/server/schemas";
import { CADENCES, CLIFF_KINDS, REVISION_INTENSITIES, SIGNAL_LAYERS } from "@/lib/taxonomy";

function asDate(value: unknown, fallbackDay: "01" | "12-31" = "01"): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  const ymd = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const year = t.match(/^(\d{4})$/);
  if (year) return fallbackDay === "01" ? `${year[1]}-01-01` : `${year[1]}-12-31`;
  return null;
}

function clip(value: unknown, max: number) {
  return String(value ?? "").slice(0, max);
}

function asInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

async function readUrl(url: string, jinaKey: string) {
  if (isMockKey(jinaKey)) return MOCK_JINA_MARKDOWN;
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${jinaKey}`,
      Accept: "text/markdown",
      "X-Timeout": "30",
    },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`Jina Reader returned ${res.status}`);
  return (await res.text()).slice(0, 400_000);
}

export const ingestUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.ingestUrl))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "ingest");
    const resolved = await resolveKey(context.userId, "jina", data.sessionKeys);
    if (!resolved) {
      return { ok: false as const, error: "Add a Jina key to pull a URL." };
    }
    try {
      const markdown = await readUrl(data.url.trim(), resolved.key);
      return { ok: true as const, markdown, source: resolved.source };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Jina request failed" };
    }
  });

export type ParsedDocument = {
  name: string;
  kind: string;
  pages: number | null;
  chars: number;
  chunks: ParsedChunk[];
};

export const parseDocuments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.parseDocuments))
  .handler(async ({ context, data }): Promise<
    { ok: false; error: string } | { ok: true; preview: string; documents: ParsedDocument[] }
  > => {
    assertRateLimit(context.userId, "ingest");
    const documents: ParsedDocument[] = [];
    for (const file of data.files) {
      const name = file.name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
      const buffer = Buffer.from(file.base64, "base64");
      if (!buffer.length) return { ok: false as const, error: `${name} is empty` };
      if (buffer.length > 12 * 1024 * 1024) {
        return { ok: false as const, error: `${name} is larger than 12 MB` };
      }
      const lower = name.toLowerCase();
      try {
        if (lower.endsWith(".pdf")) {
          const { extractText, getDocumentProxy } = await import("unpdf");
          const pdf = await getDocumentProxy(new Uint8Array(buffer));
          const result = await extractText(pdf);
          const pages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
          const chunks = chunkPages(pages);
          documents.push({
            name,
            kind: "pdf",
            pages: result.totalPages ?? pages.length,
            chars: pages.reduce((n, p) => n + p.length, 0),
            chunks,
          });
        } else if (lower.endsWith(".docx")) {
          const mammoth = await import("mammoth");
          const extracted = await mammoth.extractRawText({ buffer });
          documents.push({
            name,
            kind: "docx",
            pages: null,
            chars: extracted.value.length,
            chunks: chunkText(extracted.value),
          });
        } else if (/\.(xlsx|xls|csv)$/.test(lower)) {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buffer, { type: "buffer" });
          const chunks: ParsedChunk[] = [];
          let chars = 0;
          for (const sheet of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet]!);
            chars += csv.length;
            for (const c of chunkText(csv)) {
              chunks.push({ index: chunks.length, heading: `Sheet ${sheet} · ${c.heading}`, body: c.body });
            }
          }
          documents.push({ name, kind: "sheet", pages: wb.SheetNames.length, chars, chunks });
        } else if (/\.(txt|md|markdown)$/.test(lower)) {
          const text = buffer.toString("utf8");
          documents.push({ name, kind: "text", pages: null, chars: text.length, chunks: chunkText(text) });
        } else {
          return { ok: false as const, error: `${name}: use PDF, Word, spreadsheet, or text` };
        }
      } catch (err) {
        return {
          ok: false as const,
          error: `${name} could not be read${err instanceof Error ? `: ${err.message}` : ""}`,
        };
      }
      const last = documents[documents.length - 1]!;
      if (!last.chunks.length) {
        return {
          ok: false as const,
          error: `${name} yielded no text. Scanned image-only PDFs need OCR before upload.`,
        };
      }
    }
    const preview = documents
      .map((d) => `----- ${d.name} -----\n${joinChunks(d.chunks.slice(0, 3), 4000)}`)
      .join("\n\n")
      .slice(0, 12000);
    return { ok: true as const, preview, documents };
  });

export const extractStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.extract))
  .handler(async ({ context, data }) => {
    try {
      assertRateLimit(context.userId, "llm");
      const sql = await getSql();
      if (data.strategy_id) await assertAccess(context.userId, data.strategy_id, "editor", sql);

      const llm = await resolveLlm(context.userId, data.sessionKeys, {
        provider: data.provider,
        model: data.model,
      });
      if (!llm) {
        return {
          ok: false as const,
          error: "Add a language-model key (xAI, OpenAI, Anthropic, OpenRouter, Gemini, or Perplexity) on the Keys page.",
        };
      }

      // Source of truth for the text, in order: parsed documents, loose chunks, pasted text.
      const documents = data.documents?.length
        ? data.documents
        : data.chunks?.length
          ? [{ name: data.title || "Uploaded strategy", kind: "text", pages: null, chunks: data.chunks }]
          : data.text.trim().length >= 200
            ? [{ name: data.title || "Pasted strategy", kind: "text", pages: null, chunks: chunkText(data.text) }]
            : [];
      const allChunks = documents.flatMap((d) => d.chunks);
      const fullText = allChunks.length ? joinChunks(allChunks, Number.MAX_SAFE_INTEGER) : data.text.trim();
      if (fullText.length < 200) {
        return { ok: false as const, error: "Need more of the strategy — at least a couple of hundred characters." };
      }

      let run: ExtractionRun;
      try {
        run = await runExtraction(llm, allChunks);
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "The language model call failed." };
      }
      const parsed = run.parsed;
      const pages = documents.reduce((n, d) => n + (d.pages ?? 0), 0) || null;
      const note = extractionNote(run, pages, llm);

      const title = clip(data.title || parsed.title || documents[0]?.name || "Untitled strategy", 240);
      const language = clip(data.language || parsed.language, 60);
      const jurisdiction = clip(data.jurisdiction || parsed.jurisdiction, 120);
      const horizonStart = asDate(data.horizon_start ?? parsed.horizon_start, "01");
      const horizonEnd = asDate(data.horizon_end ?? parsed.horizon_end, "12-31");

      const strategyId = await sql.transaction(async (tx) => {
        let id = data.strategy_id;
        if (!id) {
          const created = await tx<{ id: number }>`
            insert into strategies (user_id, title, domain, vision, language, jurisdiction, horizon_start, horizon_end, extraction_note)
            values (
              ${context.userId}, ${title}, ${clip(data.domain || parsed.domain, 120)},
              ${clip(data.vision || parsed.vision, 2000)}, ${language}, ${jurisdiction},
              ${horizonStart}, ${horizonEnd}, ${note}
            ) returning id
          `;
          id = created[0]!.id;
        } else {
          await tx`
            update strategies set
              language = case when language = '' then ${language} else language end,
              jurisdiction = case when jurisdiction = '' then ${jurisdiction} else jurisdiction end,
              extraction_note = ${note}
            where id = ${id}
          `;
        }

        const existing = await tx<{ n: number; next: number }>`
          select count(*)::int as n, coalesce(max(sort_order), 0) as next from assumptions where strategy_id = ${id}
        `;
        const room = Math.max(0, 12 - (existing[0]?.n ?? 0));
        const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, room) : [];
        const assumptionIds: number[] = [];
        let sort = (existing[0]?.next ?? 0) + 1;
        for (const raw of assumptions) {
          const a = raw as Record<string, unknown>;
          const claim = clip(a.claim, 800).trim();
          if (!claim) continue;
          const row = await tx<{ id: number }>`
            insert into assumptions (strategy_id, user_id, claim, origin, status, implied_intensity, owner_label, sort_order)
            values (
              ${id}, ${context.userId}, ${claim},
              ${a.origin === "stated" ? "stated" : "implicit"}, 'untested',
              ${oneOf(a.implied_intensity, REVISION_INTENSITIES, "amend")}, ${clip(a.owner_label, 80)}, ${sort}
            ) returning id
          `;
          assumptionIds.push(row[0]!.id);
          sort += 1;
        }

        const counts = await tx<{ active: number; sentinels: number }>`
          select
            count(*) filter (where status = 'active')::int as active,
            count(*) filter (where status = 'active' and layer = 'sentinel')::int as sentinels
          from signals where strategy_id = ${id}
        `;
        let active = counts[0]?.active ?? 0;
        let sentinels = counts[0]?.sentinels ?? 0;
        const signals = Array.isArray(parsed.signals) ? parsed.signals.slice(0, 30) : [];
        for (const raw of signals) {
          if (active >= 30) break;
          const s = raw as Record<string, unknown>;
          const name = clip(s.name, 180).trim();
          if (!name) continue;
          let layer = oneOf(s.layer, SIGNAL_LAYERS, "rotating");
          if (layer === "interrupt") layer = "rotating";
          if (layer === "sentinel") {
            if (sentinels >= 8) layer = "rotating";
            else sentinels += 1;
          }
          const cat = asInt(s.category, 1, 10, 1);
          const secondary =
            s.secondary_category == null || s.secondary_category === "" ? null : asInt(s.secondary_category, 1, 10, cat);
          const row = await tx<{ id: number }>`
            insert into signals (
              strategy_id, user_id, name, category, secondary_category, layer,
              materiality, velocity, confidence, cadence, baseline, current_value,
              threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
              false_positive_guard, owner_label, status
            ) values (
              ${id}, ${context.userId}, ${name},
              ${cat}, ${secondary === cat ? null : secondary}, ${layer},
              ${asInt(s.materiality, 1, 5, 3)},
              ${asInt(s.velocity, 1, 5, 3)},
              ${asInt(s.confidence, 1, 5, 3)},
              ${oneOf(s.cadence, CADENCES, "quarterly")}, ${clip(s.baseline, 400)}, ${clip(s.current_value, 400)},
              ${clip(s.threshold_watch, 240)}, ${clip(s.threshold_amend, 240)},
              ${clip(s.threshold_refresh, 240)}, ${clip(s.threshold_reset, 240)},
              ${clip(s.false_positive_guard, 400)}, ${clip(s.owner_label, 80)}, 'active'
            ) returning id
          `;
          active += 1;
          const indexes = Array.isArray(s.assumption_indexes) ? (s.assumption_indexes as unknown[]) : [];
          for (const i of indexes) {
            const aId = assumptionIds[Number(i)];
            if (!aId) continue;
            await tx`
              insert into assumption_signals (assumption_id, signal_id)
              values (${aId}, ${row[0]!.id}) on conflict do nothing
            `;
          }
        }

        const interrupts = Array.isArray(parsed.interrupts) ? parsed.interrupts.slice(0, 8) : [];
        for (const raw of interrupts) {
          const i = raw as Record<string, unknown>;
          const name = clip(i.name, 180).trim();
          if (!name) continue;
          // The room the model named, or null: a value outside 1–10 is not a room, and
          // reads as Risks with "room not set" rather than being clamped into a real one.
          const named = Math.round(Number(i.category));
          const room = Number.isInteger(named) && named >= 1 && named <= 10 ? named : null;
          await tx`
            insert into interrupts (strategy_id, user_id, name, red_line, category, status)
            values (${id}, ${context.userId}, ${name}, ${clip(i.red_line, 400)}, ${room}, 'armed')
          `;
        }
        const cliffs = Array.isArray(parsed.cliffs) ? parsed.cliffs.slice(0, 8) : [];
        // A dated event more than a year in the past is history, not a condition to watch.
        const oldestCliff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        for (const raw of cliffs) {
          const c = raw as Record<string, unknown>;
          const cliffDate = asDate(c.cliff_date, "01");
          const name = clip(c.name, 180).trim();
          if (!cliffDate || !name || cliffDate < oldestCliff) continue;
          await tx`
            insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
            values (${id}, ${context.userId}, ${name}, ${cliffDate}, ${oneOf(c.kind, CLIFF_KINDS, "review")})
          `;
        }

        for (const doc of documents) {
          const row = await tx<{ id: number }>`
            insert into strategy_documents (strategy_id, user_id, filename, kind, char_count, page_count)
            values (
              ${id}, ${context.userId}, ${doc.name.slice(0, 180)}, ${doc.kind ?? "text"},
              ${doc.chunks.reduce((n, c) => n + c.body.length, 0)}, ${doc.pages ?? null}
            ) returning id
          `;
          let idx = 0;
          for (const c of doc.chunks) {
            await tx`
              insert into document_chunks (document_id, chunk_index, heading, body)
              values (${row[0]!.id}, ${idx}, ${c.heading.slice(0, 180)}, ${c.body})
            `;
            idx += 1;
          }
        }
        await tx`update strategies set updated_at = now() where id = ${id}`;
        return id;
      });

      return {
        ok: true as const,
        id: strategyId,
        source: llm.source,
        model: llm.model,
        note,
        chars_read: run.chars_read,
        total_chars: run.total_chars,
        passes: run.passes,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      return { ok: false as const, error: message.slice(0, 280) };
    }
  });

export const searchEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.search))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "search");
    const resolved = await resolveKey(context.userId, "exa", data.sessionKeys);
    if (!resolved) {
      return { ok: false as const, error: "Add an Exa key to search adjacent evidence." };
    }
    const search = await exaSearch(resolved.key, data.query, { numResults: 5, maxCharacters: 1200 });
    if (!search.ok) {
      return { ok: false as const, error: `Exa error ${search.status}` };
    }
    return {
      ok: true as const,
      source: resolved.source,
      results: search.results.map((r) => ({ ...r, text: r.text.slice(0, 600) })),
    };
  });
