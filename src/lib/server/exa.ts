import { isMockKey, mockExaResults } from "@/lib/server/mock";

export type ExaResult = { title: string; url: string; text: string; publishedDate: string | null };

/** One Exa search, or the canned results when the mock is on. */
export async function exaSearch(
  key: string,
  query: string,
  /**
   * `tag` never reaches Exa. It shapes the offline mock only, so a test can
   * prove that a search was built for one particular room rather than ten
   * identical searches.
   */
  opts: { numResults: number; maxCharacters: number; startPublishedDate?: string; tag?: string },
): Promise<{ ok: true; results: ExaResult[] } | { ok: false; status: number }> {
  if (isMockKey(key)) {
    return { ok: true, results: mockExaResults(opts.tag, opts.numResults) };
  }
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query: query.slice(0, 400),
      numResults: opts.numResults,
      type: "auto",
      startPublishedDate: opts.startPublishedDate,
      contents: { text: { maxCharacters: opts.maxCharacters } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; text?: string; publishedDate?: string }[];
  };
  return {
    ok: true,
    results: (body.results ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: (r.url ?? "").trim(),
      text: (r.text ?? "").slice(0, opts.maxCharacters),
      publishedDate: r.publishedDate ?? null,
    })),
  };
}
