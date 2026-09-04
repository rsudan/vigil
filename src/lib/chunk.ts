export type ParsedChunk = {
  index: number;
  heading: string;
  body: string;
};

function firstLine(text: string) {
  return text
    .split("\n")
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 120);
}

export function chunkText(text: string, size = 3500): ParsedChunk[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  const parts: ParsedChunk[] = [];
  let i = 0;
  let index = 0;
  while (i < cleaned.length) {
    let end = Math.min(i + size, cleaned.length);
    if (end < cleaned.length) {
      const para = cleaned.lastIndexOf("\n\n", end);
      if (para > i + size * 0.4) end = para;
      else {
        const line = cleaned.lastIndexOf("\n", end);
        if (line > i + size * 0.5) end = line;
      }
    }
    const body = cleaned.slice(i, end).trim();
    if (body) {
      const heading = firstLine(body) ?? `Chunk ${index + 1}`;
      parts.push({ index, heading, body });
      index += 1;
    }
    i = Math.max(end, i + 1);
  }
  return parts;
}

/**
 * Chunk a paged document (one string per page) so every chunk carries its page
 * range in the heading, e.g. "p. 12–13 · 8.2 Monitoring". Pages are joined until
 * a chunk is full; a page longer than one chunk is split with the same label.
 */
export function chunkPages(pages: string[], size = 3500): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  let buf = "";
  let start = 0;
  let end = 0;
  const label = () => (start === end ? `p. ${start}` : `p. ${start}–${end}`);
  const flush = () => {
    const body = buf.trim();
    if (body) out.push({ index: out.length, heading: `${label()} · ${firstLine(body) ?? "Page"}`, body });
    buf = "";
  };
  pages.forEach((page, i) => {
    const text = (page ?? "").replace(/\r\n/g, "\n").trim();
    const n = i + 1;
    if (!text) return;
    if (text.length > size) {
      flush();
      for (const c of chunkText(text, size)) {
        out.push({ index: out.length, heading: `p. ${n} · ${c.heading}`, body: c.body });
      }
      return;
    }
    if (buf && buf.length + text.length + 2 > size) flush();
    if (!buf) start = n;
    end = n;
    buf = buf ? `${buf}\n\n${text}` : text;
  });
  flush();
  return out;
}

export function joinChunks(chunks: ParsedChunk[], limit = 100000) {
  const joined = chunks.map((c) => `----- ${c.heading} -----\n${c.body}`).join("\n\n");
  return joined.slice(0, limit);
}
