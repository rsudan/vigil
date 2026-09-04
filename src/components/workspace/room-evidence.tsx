import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { CategoryResult } from "@/lib/category-analysis";
import { decideRoomFinding, searchRoom } from "@/lib/server/rooms";
import { readSessionKeys } from "@/lib/session-keys";
import type { StrategyBundle } from "@/lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { NativeSelect } from "./shared";
import { canEdit, day } from "./util";

/**
 * What the uploaded document says in a room, and what a search found about it.
 * Neither colours the room. In a room nobody watches, both are open by default,
 * because that is the room where the material matters and the one where a
 * search is worth running; in a watched room both are folded away, so the chair
 * is not reading Chapter 5 while a red line burns.
 */
export function RoomEvidence({
  bundle,
  room,
  onChanged,
}: {
  bundle: StrategyBundle;
  room: CategoryResult;
  onChanged: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const gap = !room.signals.length;
  // "p. 4" says nothing when a strategy has a document and an annex on file.
  const files =
    bundle.documents.length > 1 ? new Map(bundle.documents.map((d) => [d.id, d.filename] as const)) : null;
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      <DocumentSection room={room} gap={gap} files={files} />
      <WorldSection bundle={bundle} room={room} gap={gap} editable={editable} onChanged={onChanged} />
    </div>
  );
}

function DocumentSection({
  room,
  gap,
  files,
}: {
  room: CategoryResult;
  gap: boolean;
  files: Map<number, string> | null;
}) {
  const summary = !room.read
    ? "What the document says — not read yet"
    : !room.read.terms_matched
      ? "What the document says — this room’s words do not match this text"
      : room.passages.length
        ? `What the document says (${room.passages.length})`
        : "What the document says — nothing quotable here";
  return (
    <details open={gap} className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">{summary}</summary>
      <div className="mt-3 space-y-3">
        {!room.read ? (
          <p className="text-sm text-muted-foreground">
            The document has not been read into the rooms yet. Use “Read the document into the rooms” at the top of
            this page. It costs nothing and needs no key.
          </p>
        ) : !room.read.terms_matched ? (
          <p className="text-sm text-muted-foreground">
            Too few of this room’s words appear anywhere in the stored text for a search to mean anything, so the
            search failed rather than the document being silent. This usually means the stored document is in another
            language than the room’s terms.
          </p>
        ) : !room.passages.length ? (
          <p className="text-sm text-muted-foreground">
            Nothing in the stored text scored high enough to quote for {room.short}. That may be because the strategy
            is silent here, or because it says it in words this room does not use. Check the document before you call
            this a blind spot — and if the strategy really is silent, that is a finding.
          </p>
        ) : (
          room.passages.map((p) => (
            <figure key={p.id} className="border-l-2 border-border pl-3">
              <blockquote className="text-sm text-pretty">{p.quote}</blockquote>
              <figcaption className="mt-1 font-mono text-xs text-muted-foreground">
                {files ? `${files.get(p.document_id) ?? "unknown file"} · ` : ""}
                {p.locator} · found by lexical search, not interpreted
              </figcaption>
            </figure>
          ))
        )}
        {room.read ? (
          <p className="text-xs text-muted-foreground">Read from the stored document on {day(room.read.read_at)}.</p>
        ) : null}
      </div>
    </details>
  );
}

function WorldSection({
  bundle,
  room,
  gap,
  editable,
  onChanged,
}: {
  bundle: StrategyBundle;
  room: CategoryResult;
  gap: boolean;
  editable: boolean;
  onChanged: () => void;
}) {
  const [years, setYears] = useState(2);
  const strategyId = bundle.strategy.id;
  const onError = (e: Error) => toast.error(e.message);
  const search = useMutation({
    mutationFn: () =>
      searchRoom({
        data: { strategy_id: strategyId, category: room.id, recency_years: years, sessionKeys: readSessionKeys() },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${res.found} candidate${res.found === 1 ? "" : "s"} from ${res.sources} sources` +
          (res.dropped ? `, ${res.dropped} dropped for citing no source` : "") +
          (res.beyond ? `, ${res.beyond} beyond the three this room keeps` : "") +
          (res.unverified ? `, ${res.unverified} with a quotation not found in the source` : ""),
      );
      onChanged();
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: (v: { id: number; status: "kept" | "dismissed" }) =>
      decideRoomFinding({ data: { strategy_id: strategyId, ...v } }),
    onSuccess: onChanged,
    onError,
  });
  const all = [...room.findings, ...room.dismissed];
  const searched = all.length > 0;
  const latest = all.map((f) => f.searched_at).sort()[all.length - 1] ?? null;
  const summary = !searched
    ? "From the world — not searched yet"
    : room.findings.length
      ? `From the world (${room.findings.length})`
      : "From the world — searched, nothing kept";
  return (
    <details open={gap} className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
        {summary}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          One search and one reading of the results, on your own keys, only when you ask. Every candidate must cite a
          source the search returned, and its quotation is checked against that source. Nothing here changes this
          room’s colour: to act on one, make it a watchpoint.
        </p>
        {room.findings.map((f) => (
          <div key={f.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={f.status === "kept" ? "holding" : "neutral"}>{f.status}</Badge>
              {f.quote_verified === true ? <Badge tone="holding">quote verified</Badge> : null}
              {f.quote_verified === false ? <Badge tone="broken">quote not found in the source</Badge> : null}
              {f.published_date ? <span className="font-mono text-xs text-muted-foreground">{f.published_date}</span> : null}
            </div>
            <p className="mt-2 text-sm font-medium">{f.title}</p>
            {f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-muted-foreground hover:underline">
                {f.url}
              </a>
            ) : null}
            {f.quote ? <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-pretty">{f.quote}</blockquote> : null}
            <p className="mt-2 text-sm text-muted-foreground text-pretty">{f.why}</p>
            {editable && f.status === "proposed" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: f.id, status: "kept" })}>
                  Keep
                </Button>
                <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: f.id, status: "dismissed" })}>
                  Dismiss
                </Button>
              </div>
            ) : null}
            {f.status === "kept" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Kept {day(f.decided_at)}
                {f.decided_author ? ` by ${f.decided_author}` : ""}. It is not a watchpoint until you add one on the
                Signals tab.
              </p>
            ) : null}
          </div>
        ))}
        {room.dismissed.length ? (
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
              {room.dismissed.length} dismissed here, kept in the record
            </summary>
            <ul className="mt-2 space-y-2">
              {room.dismissed.map((f) => (
                <li key={f.id} className="text-sm">
                  {f.title}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    dismissed {day(f.decided_at)}
                    {f.decided_author ? ` by ${f.decided_author}` : ""}
                  </span>
                  {f.rationale ? <p className="text-xs text-muted-foreground">{f.rationale}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              How recent
              <NativeSelect
                aria-label={`How recent, room ${room.id}`}
                className="h-8 w-auto text-xs"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
              >
                <option value={1}>Last 12 months</option>
                <option value={2}>Last 2 years</option>
                <option value={3}>Last 3 years</option>
                <option value={5}>Last 5 years</option>
              </NativeSelect>
            </label>
            <Button size="sm" variant="outline" disabled={search.isPending} onClick={() => search.mutate()}>
              {search.isPending ? "Searching…" : `Search the world about ${room.short}`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {latest ? `Last searched ${day(latest)}.` : "One search and one model call on your keys."}
            </span>
          </div>
        ) : null}
      </div>
    </details>
  );
}
