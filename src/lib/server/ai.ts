import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { chunkText, joinChunks, type ParsedChunk } from "@/lib/chunk";
import { resolveKey, resolveLlm } from "@/lib/server/keys";
import { chatComplete } from "@/lib/server/llm";
import { getSql } from "@/lib/db";
import type { SessionKeys } from "@/lib/types";

function parseJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0) throw new Error("The model did not return JSON");
  const slice = end > start ? raw.slice(start, end + 1) : raw.slice(start);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    throw new Error("The model returned incomplete JSON. Try a shorter excerpt of the strategy.");
  }
}

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

function trimStrategyText(text: string, limit = 100000) {
  return text.trim().slice(0, limit);
}

async function readUrl(url: string, jinaKey: string) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${jinaKey}`,
      Accept: "text/markdown",
      "X-Timeout": "30",
    },
  });
  if (!res.ok) throw new Error(`Jina Reader returned ${res.status}`);
  return (await res.text()).slice(0, 60000);
}

export const ingestUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { url: string; sessionKeys?: SessionKeys }) => input)
  .handler(async ({ context, data }) => {
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

export const parseDocuments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { files: { name: string; base64: string }[] }) => input)
  .handler(async ({ data }): Promise<
    | { ok: false; error: string }
    | {
        ok: true;
        combined: string;
        preview: string;
        chunks: ParsedChunk[];
        files: { name: string; chars: number; pages: number | null; chunks: number }[];
      }
  > => {
    if (!data.files.length) return { ok: false as const, error: "No files received" };
    if (data.files.length > 8) return { ok: false as const, error: "Up to eight files at a time." };

    const parts: { name: string; text: string; pages: number | null }[] = [];
    for (const file of data.files) {
      const name = file.name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
      let buffer: Buffer;
      try {
        buffer = Buffer.from(file.base64, "base64");
      } catch {
        return { ok: false as const, error: `Could not read ${name}` };
      }
      if (buffer.length > 12 * 1024 * 1024) {
        return { ok: false as const, error: `${name} is larger than 12 MB` };
      }
      const lower = name.toLowerCase();
      try {
        if (lower.endsWith(".pdf")) {
          const { extractText, getDocumentProxy } = await import("unpdf");
          const pdf = await getDocumentProxy(new Uint8Array(buffer));
          const result = await extractText(pdf, { mergePages: true });
          const raw = result.text;
          const text = Array.isArray(raw) ? raw.join("\n\n") : String(raw ?? "");
          parts.push({ name, text, pages: result.totalPages ?? null });
        } else if (lower.endsWith(".docx")) {
          const mammoth = await import("mammoth");
          const extracted = await mammoth.extractRawText({ buffer });
          parts.push({ name, text: extracted.value, pages: null });
        } else if (/\.(xlsx|xls|csv)$/.test(lower)) {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buffer, { type: "buffer" });
          const sheets = wb.SheetNames.map((n) => {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]!);
            return `## Sheet: ${n}\n${csv}`;
          });
          parts.push({ name, text: sheets.join("\n\n"), pages: wb.SheetNames.length });
        } else if (/\.(txt|md|markdown)$/.test(lower)) {
          parts.push({ name, text: buffer.toString("utf8"), pages: null });
        } else {
          return { ok: false as const, error: `${name}: use PDF, Word, spreadsheet, or text` };
        }
      } catch (err) {
        return {
          ok: false as const,
          error: `${name} could not be read${err instanceof Error ? `: ${err.message}` : ""}`,
        };
      }
    }

    const combined = parts.map((p) => `----- ${p.name} -----\n${p.text.trim()}`).join("\n\n");
    const chunks: ParsedChunk[] = [];
    for (const p of parts) {
      const fileChunks = chunkText(p.text);
      for (const c of fileChunks) {
        chunks.push({ ...c, heading: `${p.name} · ${c.heading}` });
      }
    }

    return {
      ok: true as const,
      combined,
      preview: combined.slice(0, 8000),
      chunks,
      files: parts.map((p) => ({
        name: p.name,
        chars: p.text.length,
        pages: p.pages,
        chunks: chunkText(p.text).length,
      })),
    };
  });

export const extractStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    strategy_id?: number;
    title?: string;
    domain?: string;
    vision?: string;
    horizon_start?: string;
    horizon_end?: string;
    text: string;
    chunks?: ParsedChunk[];
    files?: { name: string; kind?: string; pages?: number | null }[];
    provider?: string;
    model?: string;
    sessionKeys?: SessionKeys;
  }) => input)
  .handler(async ({ context, data }) => {
    try {
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
      const fromChunks = data.chunks?.length ? joinChunks(data.chunks, 100000) : "";
      const text = trimStrategyText(fromChunks || data.text, 100000);
      if (text.length < 200) {
        return { ok: false as const, error: "Need more of the strategy — at least a couple of hundred characters." };
      }

      const prompt = `Extract a living-strategy monitoring architecture from this national or sectoral strategy.

Return ONLY JSON with this shape:
{
  "title": string,
  "domain": string,
  "vision": string,
  "horizon_start": "YYYY-MM-DD" or null,
  "horizon_end": "YYYY-MM-DD" or null,
  "assumptions": [{ "claim": string, "origin": "stated" or "implicit", "implied_intensity": "watch"|"amend"|"refresh"|"reset", "owner_label": string }],
  "signals": [{ "name": string, "category": 1-10, "secondary_category": null or 1-10, "layer": "sentinel"|"rotating"|"interrupt", "materiality":1-5, "velocity":1-5, "confidence":1-5, "cadence":"monthly"|"quarterly"|"annual"|"event-driven"|"continuous", "baseline": string, "current_value": string, "threshold_watch": string, "threshold_amend": string, "threshold_refresh": string, "threshold_reset": string, "false_positive_guard": string, "owner_label": string, "assumption_indexes": number[] }],
  "interrupts": [{ "name": string, "red_line": string }],
  "cliffs": [{ "name": string, "cliff_date": "YYYY-MM-DD", "kind": "fiscal"|"legal"|"scenario"|"review" }]
}

Rules:
- 6–8 load-bearing assumptions.
- 8 signals, of which at most 8 sentinels. Prefer 6 sentinels + 2 rotating.
- Categories: 1 External, 2 Technology/data, 3 Assumptions/ToC, 4 Delivery, 5 Resources, 6 Mandate/legal, 7 Legitimacy, 8 Risks, 9 Evidence/adjacent, 10 Opportunity.
- Technology (cat 2) is first-class.
- Dates MUST be full YYYY-MM-DD (use 01 January / 31 December if the text only gives a year). Never a year alone.
- origin must be stated or implicit. implied_intensity must be one of watch/amend/refresh/reset.
- Mark NO BASELINE when the document is silent.
- assumption_indexes are 0-based indexes into assumptions.
- Ground claims in the text.

STRATEGY TEXT:
${text}`;

      let content = "";
      try {
        const completion = await chatComplete({
          provider: llm.provider,
          key: llm.key,
          model: llm.model,
          json: true,
          maxTokens: 6000,
          messages: [{ role: "user", content: prompt }],
        });
        content = completion.content;
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "The language model call failed." };
      }
      if (!content.trim()) {
        return { ok: false as const, error: "Extraction returned nothing." };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = parseJson(content);
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Could not parse extraction" };
      }

      const sql = await getSql();
      let strategyId = data.strategy_id;
      const title = clip(parsed.title || data.title || "Untitled strategy", 240);
      const horizonStart = asDate(parsed.horizon_start ?? data.horizon_start, "01");
      const horizonEnd = asDate(parsed.horizon_end ?? data.horizon_end, "12-31");
      if (!strategyId) {
        const created = await sql<{ id: number }>`
          insert into strategies (user_id, title, domain, vision, horizon_start, horizon_end)
          values (
            ${context.userId}, ${title}, ${clip(data.domain || parsed.domain, 120)},
            ${clip(data.vision || parsed.vision, 800)},
            ${horizonStart}, ${horizonEnd}
          ) returning id
        `;
        strategyId = created[0]!.id;
      }

      const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 12) : [];
      const assumptionIds: number[] = [];
      let sort = 1;
      for (const raw of assumptions) {
        const a = raw as Record<string, string>;
        const intensity = ["watch", "amend", "refresh", "reset"].includes(a.implied_intensity)
          ? a.implied_intensity
          : "amend";
        const row = await sql<{ id: number }>`
          insert into assumptions (strategy_id, user_id, claim, origin, status, implied_intensity, owner_label, sort_order)
          values (
            ${strategyId}, ${context.userId}, ${clip(a.claim, 800)},
            ${a.origin === "stated" ? "stated" : "implicit"}, 'untested',
            ${intensity}, ${clip(a.owner_label, 80)}, ${sort}
          ) returning id
        `;
        assumptionIds.push(row[0]!.id);
        sort += 1;
      }

      const signals = Array.isArray(parsed.signals) ? parsed.signals.slice(0, 30) : [];
      let sentinels = 0;
      for (const raw of signals) {
        const s = raw as Record<string, unknown>;
        let layer = String(s.layer ?? "rotating");
        if (layer === "sentinel") {
          if (sentinels >= 8) layer = "rotating";
          else sentinels += 1;
        }
        if (!["sentinel", "rotating", "interrupt"].includes(layer)) layer = "rotating";
        const cat = asInt(s.category, 1, 10, 1);
        const secondary = s.secondary_category == null || s.secondary_category === ""
          ? null
          : asInt(s.secondary_category, 1, 10, cat);
        const cadenceRaw = String(s.cadence ?? "monthly");
        const cadence = ["monthly", "quarterly", "annual", "event-driven", "continuous"].includes(cadenceRaw)
          ? cadenceRaw
          : "monthly";
        const row = await sql<{ id: number }>`
          insert into signals (
            strategy_id, user_id, name, category, secondary_category, layer,
            materiality, velocity, confidence, cadence, baseline, current_value,
            threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
            false_positive_guard, owner_label, status
          ) values (
            ${strategyId}, ${context.userId}, ${clip(s.name ?? "Signal", 180)},
            ${cat}, ${secondary}, ${layer},
            ${asInt(s.materiality, 1, 5, 3)},
            ${asInt(s.velocity, 1, 5, 3)},
            ${asInt(s.confidence, 1, 5, 3)},
            ${cadence}, ${clip(s.baseline, 400)}, ${clip(s.current_value, 400)},
            ${clip(s.threshold_watch, 240)}, ${clip(s.threshold_amend, 240)},
            ${clip(s.threshold_refresh, 240)}, ${clip(s.threshold_reset, 240)},
            ${clip(s.false_positive_guard, 400)}, ${clip(s.owner_label, 80)}, 'active'
          ) returning id
        `;
        const indexes = Array.isArray(s.assumption_indexes) ? (s.assumption_indexes as number[]) : [];
        for (const i of indexes) {
          const aId = assumptionIds[i];
          if (!aId) continue;
          await sql`
            insert into assumption_signals (assumption_id, signal_id)
            values (${aId}, ${row[0]!.id}) on conflict do nothing
          `;
        }
      }

      const interrupts = Array.isArray(parsed.interrupts) ? parsed.interrupts.slice(0, 8) : [];
      for (const raw of interrupts) {
        const i = raw as Record<string, string>;
        const name = clip(i.name, 180);
        if (!name) continue;
        await sql`
          insert into interrupts (strategy_id, user_id, name, red_line, status)
          values (${strategyId}, ${context.userId}, ${name}, ${clip(i.red_line, 400)}, 'armed')
        `;
      }
      const cliffs = Array.isArray(parsed.cliffs) ? parsed.cliffs.slice(0, 8) : [];
      for (const raw of cliffs) {
        const c = raw as Record<string, string>;
        const cliffDate = asDate(c.cliff_date, "01");
        if (!cliffDate) continue;
        const kind = ["fiscal", "legal", "scenario", "review"].includes(c.kind) ? c.kind : "review";
        await sql`
          insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
          values (${strategyId}, ${context.userId}, ${clip(c.name, 180)}, ${cliffDate}, ${kind})
        `;
      }

      const toStore: { name: string; kind: string; pages: number | null; chunks: ParsedChunk[] }[] = [];
      if (data.chunks?.length) {
        toStore.push({
          name: data.files?.[0]?.name ?? data.title ?? "Uploaded strategy",
          kind: "text",
          pages: data.files?.[0]?.pages ?? null,
          chunks: data.chunks,
        });
      } else if (data.text.trim().length >= 200) {
        toStore.push({
          name: data.title ?? "Pasted strategy",
          kind: "text",
          pages: null,
          chunks: chunkText(data.text),
        });
      }
      for (const doc of toStore) {
        const row = await sql<{ id: number }>`
          insert into strategy_documents (strategy_id, user_id, filename, kind, char_count, page_count)
          values (
            ${strategyId}, ${context.userId}, ${doc.name.slice(0, 180)}, ${doc.kind},
            ${doc.chunks.reduce((n, c) => n + c.body.length, 0)}, ${doc.pages}
          ) returning id
        `;
        let idx = 0;
        for (const c of doc.chunks) {
          await sql`
            insert into document_chunks (document_id, chunk_index, heading, body)
            values (${row[0]!.id}, ${idx}, ${c.heading.slice(0, 180)}, ${c.body})
          `;
          idx += 1;
        }
      }

      return { ok: true as const, id: strategyId, source: llm.source, model: llm.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      return { ok: false as const, error: message.slice(0, 280) };
    }
  });

export const searchEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { query: string; sessionKeys?: SessionKeys }) => input)
  .handler(async ({ context, data }) => {
    const resolved = await resolveKey(context.userId, "exa", data.sessionKeys);
    if (!resolved) {
      return { ok: false as const, error: "Add an Exa key to search adjacent evidence." };
    }
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolved.key,
      },
      body: JSON.stringify({
        query: data.query.slice(0, 400),
        numResults: 5,
        type: "auto",
        contents: { text: { maxCharacters: 1200 } },
      }),
    });
    if (!res.ok) {
      return { ok: false as const, error: `Exa error ${res.status}` };
    }
    const body = (await res.json()) as {
      results?: { title?: string; url?: string; text?: string; publishedDate?: string }[];
    };
    return {
      ok: true as const,
      source: resolved.source,
      results: (body.results ?? []).map((r) => ({
        title: r.title ?? "Untitled",
        url: r.url ?? "",
        text: (r.text ?? "").slice(0, 600),
        publishedDate: r.publishedDate ?? null,
      })),
    };
  });
