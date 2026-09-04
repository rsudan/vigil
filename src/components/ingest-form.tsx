import { useState } from "react";
import { toast } from "sonner";
import { extractStrategy, ingestUrl, parseDocuments, type ParsedDocument } from "@/lib/server/ai";
import { readExtractPref, readSessionKeys } from "@/lib/session-keys";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export function IngestForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const pref = readExtractPref();

  async function filesToBase64(list: File[]) {
    const out: { name: string; base64: string }[] = [];
    for (const file of list) {
      if (file.size > 12 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 12 MB`);
        continue;
      }
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      out.push({ name: file.name, base64: btoa(binary) });
    }
    return out;
  }

  async function ingestFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter((f) => /\.(pdf|txt|md|markdown|docx|xlsx|xls|csv)$/i.test(f.name));
    if (!files.length) {
      toast.error("Use PDF, Word, spreadsheet, Markdown, or plain text.");
      return;
    }
    setBusy(true);
    try {
      const payload = await filesToBase64(files);
      if (!payload.length) return;
      const res = await parseDocuments({ data: { files: payload } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${res.preview}` : res.preview));
      setDocuments((prev) => [...prev, ...res.documents]);
      toast.success(
        res.documents.length === 1 ? `Read ${res.documents[0]!.name}` : `Read ${res.documents.length} files`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read files");
    } finally {
      setBusy(false);
    }
  }

  async function runExtract() {
    setBusy(true);
    try {
      let docs = documents;
      let body = text;
      if (url.trim()) {
        const pulled = await ingestUrl({ data: { url: url.trim(), sessionKeys: readSessionKeys() } });
        if (!pulled.ok) {
          toast.error(pulled.error);
          return;
        }
        // A pulled page becomes a document of its own so it is stored and searchable like a file.
        docs = [
          ...docs,
          {
            name: url.trim().slice(0, 180),
            kind: "url",
            pages: null,
            chars: pulled.markdown.length,
            chunks: chunkClient(pulled.markdown),
          },
        ];
        body = docs.length ? text : `${pulled.markdown}\n\n${text}`;
      }
      const res = await extractStrategy({
        data: {
          text: body,
          documents: docs.length ? docs.map((d) => ({ name: d.name, kind: d.kind, pages: d.pages, chunks: d.chunks })) : undefined,
          language: language || undefined,
          sessionKeys: readSessionKeys(),
          provider: pref?.provider,
          model: pref?.model,
        },
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.note ? `Architecture extracted. ${res.note}` : "Architecture extracted", { duration: 8000 });
        onCreated(res.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  const totalChars = documents.reduce((n, d) => n + d.chars, 0);

  return (
    <div className="space-y-3">
      <Label>Upload documents</Label>
      <label
        htmlFor="strategy-files"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingestFiles(e.dataTransfer.files);
        }}
        className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center text-sm ${
          dragging ? "border-foreground bg-muted" : "border-border bg-muted/40"
        }`}
      >
        <input
          id="strategy-files"
          type="file"
          className="hidden"
          accept=".pdf,.txt,.md,.markdown,.docx,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,text/markdown"
          multiple
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="font-medium">Drop PDF, Word, spreadsheet, or text here</span>
        <span className="mt-1 text-xs text-muted-foreground">
          Click to choose — up to eight files, 12 MB each. Whole documents are stored in chunks with their page numbers.
        </span>
      </label>
      {documents.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {documents.map((d, i) => (
            <li key={`${d.name}-${i}`}>
              {d.name}
              {d.pages ? ` · ${d.pages} pages` : ""} · {d.chars.toLocaleString()} characters · {d.chunks.length} chunks
            </li>
          ))}
          <li>
            {totalChars.toLocaleString()} characters in total. The whole text is read: in one pass when it fits the
            model’s window, otherwise in several passes that are then consolidated.
          </li>
        </ul>
      ) : null}
      <Label htmlFor="url">Or a public URL (Jina Reader)</Label>
      <Input id="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Label htmlFor="language">Document language (optional)</Label>
      <Input
        id="language"
        placeholder="Detected from the text if left blank; amendments are drafted in it"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
      />
      <Label htmlFor="body">Text to extract</Label>
      <Textarea
        id="body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Uploads preview here. You can also paste."
      />
      <Button disabled={busy || (!text.trim() && !url.trim() && !documents.length)} onClick={() => void runExtract()}>
        {busy ? "Working…" : "Extract monitoring architecture"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Extraction uses the language-model pair on the Keys page. URL ingest needs Jina. Scanned image-only PDFs
        will not yield text.
      </p>
    </div>
  );
}

/** Minimal client-side chunking for a pulled URL; mirrors the server's paragraph-aware splitter. */
function chunkClient(text: string, size = 3500) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  const out: { index: number; heading: string; body: string }[] = [];
  let i = 0;
  while (i < cleaned.length) {
    let end = Math.min(i + size, cleaned.length);
    if (end < cleaned.length) {
      const para = cleaned.lastIndexOf("\n\n", end);
      if (para > i + size * 0.4) end = para;
    }
    const body = cleaned.slice(i, end).trim();
    if (body) {
      const heading = body.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? `Chunk ${out.length + 1}`;
      out.push({ index: out.length, heading, body });
    }
    i = Math.max(end, i + 1);
  }
  return out;
}
