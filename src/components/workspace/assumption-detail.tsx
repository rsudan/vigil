import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { searchEvidence } from "@/lib/server/ai";
import { deleteAssumption, setAssumptionStatus, upsertAssumption } from "@/lib/server/strategies";
import { readSessionKeys } from "@/lib/session-keys";
import { ASSUMPTION_STATUSES, REVISION_INTENSITIES } from "@/lib/taxonomy";
import type { Assumption, StrategyBundle } from "@/lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Field, NativeSelect } from "./shared";
import { canEdit, day, statusTone } from "./util";

type Direction = "supporting" | "weakening" | "neutral";

function defaultDirection(status: Assumption["status"]): Direction {
  return status === "holding" ? "supporting" : status === "untested" ? "neutral" : "weakening";
}

function directionTone(direction: Direction) {
  return direction === "supporting" ? "holding" : direction === "weakening" ? "weakening" : "untested";
}

export function AssumptionDetail({
  bundle,
  assumption,
  onChanged,
  onClose,
}: {
  bundle: StrategyBundle;
  assumption: Assumption;
  onChanged: () => void;
  onClose: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const strategyId = bundle.strategy.id;
  const [status, setStatus] = useState(assumption.status);
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<Direction>(defaultDirection(assumption.status));
  const [sourceUrl, setSourceUrl] = useState("");
  const [claim, setClaim] = useState(assumption.claim);
  const [origin, setOrigin] = useState(assumption.origin);
  const [intensity, setIntensity] = useState(assumption.implied_intensity);
  const [owner, setOwner] = useState(assumption.owner_label);
  const [query, setQuery] = useState(assumption.claim);
  const [hits, setHits] = useState<{ title: string; url: string; text: string }[] | null>(null);
  const evidence = bundle.evidence.filter((e) => e.assumption_id === assumption.id);
  const linked = bundle.signals.filter((s) => assumption.linked_signal_ids.includes(s.id));
  const changed = status !== assumption.status;

  const save = useMutation({
    mutationFn: () =>
      setAssumptionStatus({
        data: {
          strategy_id: strategyId,
          id: assumption.id,
          status,
          note,
          direction,
          source_url: sourceUrl || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.changed ? `Status set to ${status}` : "Evidence added");
      setNote("");
      setSourceUrl("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: () =>
      upsertAssumption({
        data: {
          strategy_id: strategyId,
          id: assumption.id,
          claim,
          origin,
          implied_intensity: intensity,
          owner_label: owner,
        },
      }),
    onSuccess: () => {
      toast.success("Assumption updated");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteAssumption({ data: { strategy_id: strategyId, id: assumption.id } }),
    onSuccess: () => {
      toast.success("Assumption retired");
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const search = useMutation({
    mutationFn: () => searchEvidence({ data: { query, sessionKeys: readSessionKeys() } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
      else setHits(res.results);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-2">
        <p className="text-base">{assumption.claim}</p>
        <div className="flex flex-wrap gap-2">
          <Badge>{assumption.origin}</Badge>
          <Badge tone={statusTone(assumption.status)}>{assumption.status}</Badge>
          <Badge>{assumption.implied_intensity} if broken</Badge>
        </div>
        <p className="text-muted-foreground">
          Owner · {assumption.owner_label || "unassigned"} · status since {day(assumption.status_changed_at)} · last
          evidence {day(assumption.last_evidence_at)}
        </p>
      </div>

      {editable ? (
        <section className="space-y-3 rounded-md border border-border p-4">
          <h3 className="font-medium">Update status</h3>
          <Field label="Status" htmlFor="asm-status">
            <NativeSelect
              id="asm-status"
              value={status}
              onChange={(e) => {
                const next = e.target.value as Assumption["status"];
                setStatus(next);
                setDirection(defaultDirection(next));
              }}
            >
              {ASSUMPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={changed ? "Evidence for the change (required)" : "Evidence note (optional)"}
            htmlFor="asm-note"
          >
            <Textarea
              id="asm-note"
              className="min-h-20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was observed, by whom, and where it is written down."
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Direction" htmlFor="asm-direction">
              <NativeSelect
                id="asm-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
              >
                <option value="supporting">supports the bet</option>
                <option value="weakening">weakens the bet</option>
                <option value="neutral">a note, neither way</option>
              </NativeSelect>
            </Field>
            <Field label="Source URL" htmlFor="asm-source">
              <Input
                id="asm-source"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://"
              />
            </Field>
          </div>
          <Button
            size="sm"
            disabled={save.isPending || (changed ? note.trim().length < 10 : !note.trim())}
            onClick={() => save.mutate()}
          >
            {changed ? `Set to ${status} and record evidence` : "Record evidence"}
          </Button>
        </section>
      ) : null}

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Watched by</p>
        {linked.length ? (
          <ul className="space-y-1">
            {linked.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {s.layer} · {s.pressure}/125{s.stale ? " · stale" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No signal is linked to this bet. Without a sentinel it is a slogan.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Evidence on file</p>
        {evidence.length ? (
          <ul className="space-y-2">
            {evidence.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={directionTone(e.direction)}>{e.direction === "neutral" ? "note" : e.direction}</Badge>
                  <span>{day(e.created_at)}</span>
                  {e.author ? <span>· {e.author}</span> : null}
                  {e.method === "desk" ? <Badge>model-drafted</Badge> : null}
                </div>
                <p className="mt-2">{e.note}</p>
                {e.source_url ? (
                  <a href={e.source_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-muted-foreground hover:underline">
                    {e.source_url}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <Field label="Search adjacent evidence (Exa)" htmlFor="asm-query">
          <div className="flex gap-2">
            <Input id="asm-query" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button size="sm" variant="outline" disabled={search.isPending} onClick={() => search.mutate()}>
              Search
            </Button>
          </div>
        </Field>
        {hits?.map((h) => (
          <a key={h.url} href={h.url} target="_blank" rel="noreferrer" className="block border-t border-border pt-3">
            <p className="font-medium">{h.title}</p>
            <p className="text-xs text-muted-foreground">{h.text}</p>
          </a>
        ))}
      </section>

      {editable ? (
        <details className="rounded-md border border-border p-4">
          <summary className="cursor-pointer font-medium">Edit the bet</summary>
          <div className="mt-3 space-y-3">
            <Field label="Claim" htmlFor="asm-claim">
              <Textarea id="asm-claim" className="min-h-20" value={claim} onChange={(e) => setClaim(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Origin" htmlFor="asm-origin">
                <NativeSelect id="asm-origin" value={origin} onChange={(e) => setOrigin(e.target.value as Assumption["origin"])}>
                  <option value="stated">stated</option>
                  <option value="implicit">implicit</option>
                </NativeSelect>
              </Field>
              <Field label="If broken" htmlFor="asm-intensity">
                <NativeSelect
                  id="asm-intensity"
                  value={intensity}
                  onChange={(e) => setIntensity(e.target.value as Assumption["implied_intensity"])}
                >
                  {REVISION_INTENSITIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Owner" htmlFor="asm-owner">
                <Input id="asm-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={edit.isPending || claim.trim().length < 3} onClick={() => edit.mutate()}>
                Save changes
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm("Retire this assumption? Its evidence stays on file; its links to signals are removed.")) {
                    remove.mutate();
                  }
                }}
              >
                Retire
              </Button>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function NewAssumptionForm({
  bundle,
  onSaved,
  onCancel,
}: {
  bundle: StrategyBundle;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [claim, setClaim] = useState("");
  const [origin, setOrigin] = useState<Assumption["origin"]>("implicit");
  const [intensity, setIntensity] = useState<Assumption["implied_intensity"]>("amend");
  const [owner, setOwner] = useState("");
  const add = useMutation({
    mutationFn: () =>
      upsertAssumption({
        data: { strategy_id: bundle.strategy.id, claim, origin, implied_intensity: intensity, owner_label: owner },
      }),
    onSuccess: () => {
      toast.success("Assumption added as untested");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <Field
        label="Claim"
        htmlFor="new-claim"
        hint="A bet the strategy depends on, not an activity. It starts as untested; set its status once you have evidence."
      >
        <Textarea id="new-claim" className="min-h-20" value={claim} onChange={(e) => setClaim(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Origin" htmlFor="new-origin">
          <NativeSelect id="new-origin" value={origin} onChange={(e) => setOrigin(e.target.value as Assumption["origin"])}>
            <option value="stated">stated in the text</option>
            <option value="implicit">implicit</option>
          </NativeSelect>
        </Field>
        <Field label="If broken" htmlFor="new-intensity">
          <NativeSelect
            id="new-intensity"
            value={intensity}
            onChange={(e) => setIntensity(e.target.value as Assumption["implied_intensity"])}
          >
            {REVISION_INTENSITIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Owner" htmlFor="new-owner">
          <Input id="new-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button disabled={add.isPending || claim.trim().length < 3} onClick={() => add.mutate()}>
          Add assumption
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
