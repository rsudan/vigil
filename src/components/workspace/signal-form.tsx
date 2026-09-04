import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { upsertSignal } from "@/lib/server/strategies";
import {
  BUDGET,
  CADENCES,
  CATEGORIES,
  CROSSED_LEVELS,
  PRESSURE_RANGE,
  SIGNAL_LAYERS,
  SIGNAL_STATUSES,
  pressure,
  pressureBand,
} from "@/lib/taxonomy";
import type { CrossedLevel, Signal, StrategyBundle } from "@/lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Field, NativeSelect } from "./shared";

type Draft = {
  name: string;
  category: number;
  secondary_category: number | null;
  layer: Signal["layer"];
  materiality: number;
  velocity: number;
  confidence: number;
  cadence: (typeof CADENCES)[number];
  baseline: string;
  current_value: string;
  unit: string;
  threshold_watch: string;
  threshold_amend: string;
  threshold_refresh: string;
  threshold_reset: string;
  false_positive_guard: string;
  owner_label: string;
  status: Signal["status"];
  crossed_level: CrossedLevel;
  linked_assumption_ids: number[];
};

function draftFrom(bundle: StrategyBundle, initial?: Signal): Draft {
  const linked = initial ? bundle.assumptions.filter((a) => a.linked_signal_ids.includes(initial.id)).map((a) => a.id) : [];
  const cadence = CADENCES.includes(initial?.cadence as (typeof CADENCES)[number])
    ? (initial!.cadence as (typeof CADENCES)[number])
    : "quarterly";
  return {
    name: initial?.name ?? "",
    category: initial?.category ?? 1,
    secondary_category: initial?.secondary_category ?? null,
    layer: initial?.layer ?? "rotating",
    materiality: initial?.materiality ?? 3,
    velocity: initial?.velocity ?? 3,
    confidence: initial?.confidence ?? 3,
    cadence,
    baseline: initial?.baseline ?? "",
    current_value: initial?.current_value ?? "",
    unit: initial?.unit ?? "",
    threshold_watch: initial?.threshold_watch ?? "",
    threshold_amend: initial?.threshold_amend ?? "",
    threshold_refresh: initial?.threshold_refresh ?? "",
    threshold_reset: initial?.threshold_reset ?? "",
    false_positive_guard: initial?.false_positive_guard ?? "",
    owner_label: initial?.owner_label ?? "",
    status: initial?.status ?? "active",
    crossed_level: initial?.crossed_level ?? "none",
    linked_assumption_ids: linked,
  };
}

const SCALE = [1, 2, 3, 4, 5];

export function SignalForm({
  bundle,
  initial,
  onSaved,
  onCancel,
}: {
  bundle: StrategyBundle;
  initial?: Signal;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(bundle, initial));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const p = pressure(d.materiality, d.velocity, d.confidence);
  const save = useMutation({
    mutationFn: () =>
      upsertSignal({
        data: { strategy_id: bundle.strategy.id, id: initial?.id, ...d },
      }),
    onSuccess: () => {
      toast.success(initial ? "Signal updated" : "Signal added");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="sig-name">
        <Input id="sig-name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="What is being watched" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Room" htmlFor="sig-cat">
          <NativeSelect id="sig-cat" value={d.category} onChange={(e) => set("category", Number(e.target.value))}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}. {c.short}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Second room" htmlFor="sig-cat2">
          <NativeSelect
            id="sig-cat2"
            value={d.secondary_category ?? ""}
            onChange={(e) => set("secondary_category", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">none</option>
            {CATEGORIES.filter((c) => c.id !== d.category).map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}. {c.short}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Layer" htmlFor="sig-layer" hint={`At most ${BUDGET.maxSentinels} sentinels.`}>
          <NativeSelect id="sig-layer" value={d.layer} onChange={(e) => set("layer", e.target.value as Signal["layer"])}>
            {SIGNAL_LAYERS.filter((l) => l !== "interrupt").map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["materiality", "velocity", "confidence"] as const).map((k) => (
          <Field key={k} label={k} htmlFor={`sig-${k}`}>
            <NativeSelect id={`sig-${k}`} value={d[k]} onChange={(e) => set(k, Number(e.target.value))}>
              {SCALE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ))}
        <div className="grid gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground">Pressure</span>
          <p className="font-mono text-lg tabular-nums">
            {p}
            <span className="text-xs text-muted-foreground">
              /{PRESSURE_RANGE.max} · {pressureBand(p).label}
            </span>
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cadence" htmlFor="sig-cadence">
          <NativeSelect id="sig-cadence" value={d.cadence} onChange={(e) => set("cadence", e.target.value as Draft["cadence"])}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status" htmlFor="sig-status" hint={`At most ${BUDGET.maxActiveSignals} active.`}>
          <NativeSelect id="sig-status" value={d.status} onChange={(e) => set("status", e.target.value as Signal["status"])}>
            {SIGNAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Owner" htmlFor="sig-owner">
          <Input id="sig-owner" value={d.owner_label} onChange={(e) => set("owner_label", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Baseline" htmlFor="sig-baseline">
          <Input id="sig-baseline" value={d.baseline} onChange={(e) => set("baseline", e.target.value)} placeholder="NO BASELINE if the text is silent" />
        </Field>
        <Field label="Current value" htmlFor="sig-current">
          <Input id="sig-current" value={d.current_value} onChange={(e) => set("current_value", e.target.value)} />
        </Field>
        <Field label="Unit" htmlFor="sig-unit">
          <Input id="sig-unit" value={d.unit} onChange={(e) => set("unit", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["watch", "amend", "refresh", "reset"] as const).map((k) => (
          <Field key={k} label={`${k} threshold`} htmlFor={`sig-th-${k}`}>
            <Input
              id={`sig-th-${k}`}
              value={d[`threshold_${k}`]}
              onChange={(e) => set(`threshold_${k}`, e.target.value)}
              placeholder="The reading that would justify this"
            />
          </Field>
        ))}
      </div>
      <Field label="False-positive guard" htmlFor="sig-guard">
        <Textarea
          id="sig-guard"
          className="min-h-16"
          value={d.false_positive_guard}
          onChange={(e) => set("false_positive_guard", e.target.value)}
          placeholder="The sentence that stops a local blip being read as national failure."
        />
      </Field>
      <Field label="Crossed threshold" htmlFor="sig-crossed" hint="Set from a reading, normally. Reset it here if it was marked in error.">
        <NativeSelect id="sig-crossed" value={d.crossed_level} onChange={(e) => set("crossed_level", e.target.value as CrossedLevel)}>
          {CROSSED_LEVELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">Bets this signal tests</span>
        {bundle.assumptions.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {bundle.assumptions.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={d.linked_assumption_ids.includes(a.id)}
                  onChange={(e) =>
                    set(
                      "linked_assumption_ids",
                      e.target.checked
                        ? [...d.linked_assumption_ids, a.id]
                        : d.linked_assumption_ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <span>{a.claim}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No assumptions yet.</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button disabled={save.isPending || !d.name.trim()} onClick={() => save.mutate()}>
          {initial ? "Save signal" : "Add signal"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
