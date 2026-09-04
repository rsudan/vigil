import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSignal, recordSignalReading } from "@/lib/server/strategies";
import { CROSSED_LEVELS, PRESSURE_RANGE, categoryById } from "@/lib/taxonomy";
import type { CrossedLevel, Signal, StrategyBundle } from "@/lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Field, NativeSelect } from "./shared";
import { canEdit, day } from "./util";
import { SignalForm } from "./signal-form";

export function SignalDetail({
  bundle,
  signal,
  onChanged,
  onClose,
}: {
  bundle: StrategyBundle;
  signal: Signal;
  onChanged: () => void;
  onClose: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const strategyId = bundle.strategy.id;
  const [value, setValue] = useState(signal.current_value);
  const [crossed, setCrossed] = useState<CrossedLevel>(signal.crossed_level);
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<"supporting" | "weakening">("weakening");
  const [sourceUrl, setSourceUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const readings = bundle.evidence.filter((e) => e.signal_id === signal.id);
  const bets = bundle.assumptions.filter((a) => a.linked_signal_ids.includes(signal.id));

  const record = useMutation({
    mutationFn: () =>
      recordSignalReading({
        data: {
          strategy_id: strategyId,
          signal_id: signal.id,
          current_value: value,
          note,
          direction,
          crossed_level: crossed,
          source_url: sourceUrl || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(crossed !== "none" ? `Reading recorded · ${crossed} threshold crossed` : "Reading recorded");
      setNote("");
      setSourceUrl("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteSignal({ data: { strategy_id: strategyId, id: signal.id } }),
    onSuccess: () => {
      toast.success("Signal deleted");
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <SignalForm
        bundle={bundle}
        initial={signal}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const thresholdFor = (level: CrossedLevel) =>
    level === "none" ? "" : signal[`threshold_${level}`] || "not written";

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-2">
        <p className="text-base">{signal.name}</p>
        <div className="flex flex-wrap gap-2">
          <Badge>{categoryById(signal.category).short}</Badge>
          <Badge>{signal.layer}</Badge>
          <Badge tone={signal.status === "active" ? "holding" : "untested"}>{signal.status}</Badge>
          {signal.stale ? <Badge tone="weakening">stale</Badge> : null}
          {signal.crossed_level !== "none" ? <Badge tone="broken">crossed {signal.crossed_level}</Badge> : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Pressure {signal.pressure}/{PRESSURE_RANGE.max} = M{signal.materiality} × V{signal.velocity} × (6−C
          {signal.confidence}) · cadence {signal.cadence} · last evidence {day(signal.last_evidence_at ?? signal.created_at)}
        </p>
        <p className="text-muted-foreground">Owner · {signal.owner_label || "unassigned"}</p>
      </div>

      {editable ? (
        <section className="space-y-3 rounded-md border border-border p-4">
          <h3 className="font-medium">Record a reading</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Current value${signal.unit ? ` (${signal.unit})` : ""}`} htmlFor="sig-value">
              <Input id="sig-value" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Field label="Threshold crossed" htmlFor="sig-crossed-level">
              <NativeSelect id="sig-crossed-level" value={crossed} onChange={(e) => setCrossed(e.target.value as CrossedLevel)}>
                {CROSSED_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c === "none" ? "none crossed" : `${c}: ${thresholdFor(c)}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Evidence (required)" htmlFor="sig-note">
            <Textarea
              id="sig-note"
              className="min-h-20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Where the number comes from and what it means against the guard."
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Direction" htmlFor="sig-direction">
              <NativeSelect id="sig-direction" value={direction} onChange={(e) => setDirection(e.target.value as "supporting" | "weakening")}>
                <option value="supporting">supports the linked bets</option>
                <option value="weakening">weakens the linked bets</option>
              </NativeSelect>
            </Field>
            <Field label="Source URL" htmlFor="sig-source">
              <Input id="sig-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
            </Field>
          </div>
          {signal.false_positive_guard ? (
            <p className="text-xs text-muted-foreground">Guard: {signal.false_positive_guard}</p>
          ) : null}
          <Button size="sm" disabled={record.isPending || note.trim().length < 3} onClick={() => record.mutate()}>
            Record reading
          </Button>
        </section>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Baseline</dt>
          <dd>{signal.baseline || "NO BASELINE"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Current</dt>
          <dd>{signal.current_value || "—"}</dd>
        </div>
        {(["watch", "amend", "refresh", "reset"] as const).map((k) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd>{signal[`threshold_${k}`] || "—"}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">False-positive guard</dt>
          <dd>{signal.false_positive_guard || "—"}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Bets this signal tests</p>
        {bets.length ? (
          <ul className="space-y-1">
            {bets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>{a.claim}</span>
                <Badge tone={a.status}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Not linked to any bet.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Readings on file</p>
        {readings.length ? (
          <ul className="space-y-2">
            {readings.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {e.reading ? <span className="font-mono text-foreground">{e.reading}</span> : null}
                  <Badge tone={e.direction === "supporting" ? "holding" : "weakening"}>{e.direction}</Badge>
                  <span>{day(e.created_at)}</span>
                  {e.author ? <span>· {e.author}</span> : null}
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
          <p className="text-muted-foreground">No readings recorded yet.</p>
        )}
      </section>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit signal
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm("Delete this signal and its readings? Parking or retiring keeps the history.")) remove.mutate();
            }}
          >
            Delete
          </Button>
        </div>
      ) : null}
    </div>
  );
}
