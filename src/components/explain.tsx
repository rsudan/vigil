import type { ReactNode } from "react";
import { INTENSITY_HELP, RAG_HELP, STATUS_HELP, TERMS, type TermId } from "@/lib/glossary";
import { PRESSURE_RANGE, pressureBand } from "@/lib/taxonomy";
import { Badge } from "./ui/badge";

export function Term({ id }: { id: TermId }) {
  const t = TERMS[id];
  return (
    <span className="cursor-help border-b border-dotted border-muted-foreground" title={t.body}>
      {t.title.toLowerCase()}
    </span>
  );
}

export function PageGuide({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-xl border border-border bg-muted/40 p-4">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

export function ColorLegend() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Assumption status</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {STATUS_HELP.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <Badge tone={s.tone}>{s.id}</Badge>
              <span className="text-muted-foreground">{s.meaning}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Delivery colour</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {RAG_HELP.map((s) => (
            <li key={s.id}>
              <span className="font-medium uppercase text-foreground">{s.id}</span> — {s.meaning}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function IntensityLegend() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 text-sm">
      {INTENSITY_HELP.map((i) => (
        <li key={i.id}>
          <span className="font-medium uppercase">{i.label}</span>
          <span className="text-muted-foreground"> — {i.meaning}</span>
        </li>
      ))}
    </ul>
  );
}

export function GlossaryStrip({ ids }: { ids: TermId[] }) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {ids.map((id) => (
        <div key={id} className="rounded-md border border-border p-3">
          <dt className="text-sm font-medium">{TERMS[id].title}</dt>
          <dd className="mt-1 text-xs text-muted-foreground">{TERMS[id].body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PressureScale() {
  return (
    <p className="text-xs text-muted-foreground">
      Scale {PRESSURE_RANGE.min}–{PRESSURE_RANGE.max}. Quiet 1–15 · moderate 16–39 · high 40–79 · severe 80–125.
    </p>
  );
}

export function PressureReading({ value }: { value: number }) {
  const band = pressureBand(value);
  const pct = Math.max(0, Math.min(100, (value / PRESSURE_RANGE.max) * 100));
  return (
    <div>
      <p className="font-mono text-lg tabular-nums">
        {value}
        <span className="text-xs text-muted-foreground"> / {PRESSURE_RANGE.max}</span>
      </p>
      <div className="mt-1 h-1 rounded-full bg-muted" aria-hidden>
        <div className="h-1 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{band.label}</p>
    </div>
  );
}
