export type ParsedChunk = {
  index: number;
  heading: string;
  body: string;
};

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
      const heading = body.split("\n").find((l) => l.trim())?.slice(0, 120) ?? `Chunk ${index + 1}`;
      parts.push({ index, heading, body });
      index += 1;
    }
    i = Math.max(end, i + 1);
  }
  return parts;
}

export function joinChunks(chunks: ParsedChunk[], limit = 100000) {
  const joined = chunks.map((c) => `----- ${c.heading} -----\n${c.body}`).join("\n\n");
  return joined.slice(0, limit);
}
