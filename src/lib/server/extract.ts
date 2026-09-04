import type { ParsedChunk } from "@/lib/chunk";
import { parseJsonObject } from "@/lib/server/json";
import { chatComplete } from "@/lib/server/llm";
import type { LlmProviderId } from "@/lib/taxonomy";
import {
  consolidationPrompt,
  extractBudget,
  extractionPrompt,
  mergePartials,
  windowsOf,
  type ExtractionRun,
} from "@/lib/server/extract-plan";

export { extractionNote, type ExtractionRun } from "@/lib/server/extract-plan";

type Llm = { provider: LlmProviderId; key: string; model: string };

/**
 * Read the whole document: one pass when it fits the provider's window,
 * otherwise one pass per window followed by a consolidation pass (falling back
 * to a deterministic merge if the model cannot consolidate).
 */
export async function runExtraction(llm: Llm, chunks: ParsedChunk[]): Promise<ExtractionRun> {
  const budget = extractBudget(llm.provider);
  const windows = windowsOf(chunks, budget);
  if (!windows.length) throw new Error("There is no text to extract from.");
  const total = windows.reduce((n, w) => n + w.chars, 0);
  if (windows.length === 1) {
    const completion = await chatComplete({
      provider: llm.provider,
      key: llm.key,
      model: llm.model,
      json: true,
      maxTokens: 8000,
      task: "extract",
      messages: [{ role: "user", content: extractionPrompt(windows[0]!.text) }],
    });
    if (!completion.content.trim()) throw new Error("Extraction returned nothing.");
    return {
      parsed: parseJsonObject(completion.content),
      chars_read: total,
      total_chars: total,
      passes: 1,
      consolidated: false,
      failed_parts: [],
    };
  }

  const partials: Record<string, unknown>[] = [];
  const failed: number[] = [];
  let charsRead = 0;
  let lastError: unknown = null;
  for (let i = 0; i < windows.length; i += 1) {
    try {
      const completion = await chatComplete({
        provider: llm.provider,
        key: llm.key,
        model: llm.model,
        json: true,
        maxTokens: 8000,
        task: "extract",
        messages: [{ role: "user", content: extractionPrompt(windows[i]!.text, { index: i + 1, total: windows.length }) }],
      });
      partials.push(parseJsonObject(completion.content));
      charsRead += windows[i]!.chars;
    } catch (err) {
      failed.push(i + 1);
      lastError = err;
    }
  }
  if (!partials.length) {
    throw lastError instanceof Error ? lastError : new Error("Every pass over the document failed.");
  }

  let parsed: Record<string, unknown>;
  let consolidated = true;
  try {
    const completion = await chatComplete({
      provider: llm.provider,
      key: llm.key,
      model: llm.model,
      json: true,
      maxTokens: 8000,
      task: "consolidate",
      messages: [{ role: "user", content: consolidationPrompt(partials) }],
    });
    parsed = parseJsonObject(completion.content);
    if (!Array.isArray(parsed.assumptions) || !Array.isArray(parsed.signals)) throw new Error("no lists");
  } catch {
    parsed = mergePartials(partials);
    consolidated = false;
  }
  return {
    parsed,
    chars_read: charsRead,
    total_chars: total,
    passes: partials.length + (consolidated ? 1 : 0),
    consolidated,
    failed_parts: failed,
  };
}
