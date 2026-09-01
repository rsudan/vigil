import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { draftAmendments, researchPeers } from "@/lib/server/research";
import { addEvidence, fireInterrupt, getStrategyBundle, logDecision, updateStrategy } from "@/lib/server/strategies";
import { extractStrategy, ingestUrl, parseDocuments, searchEvidence } from "@/lib/server/ai";
import { analyzeAllCategories, type CategoryResult } from "@/lib/category-analysis";
import { analysisMarkdown, revisionBriefMarkdown } from "@/lib/brief";
import { BUDGET, CATEGORIES, PRESSURE_RANGE, categoryById } from "@/lib/taxonomy";
import { readExtractPref, readSessionKeys } from "@/lib/session-keys";
import { categoryGuide } from "@/lib/category-guide";
import type { Amendment, Assumption, Intensity, QueueItem, Signal, StrategyBundle } from "@/lib/types";
import { ColorLegend, GlossaryStrip, IntensityLegend, PageGuide, PressureReading, PressureScale } from "./explain";
import { MethodologySection } from "./methodology";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const VIEWS = ["overview", "categories", "assumptions", "signals", "queue", "log", "review", "peers"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  overview: "Overview",
  categories: "Categories",
  assumptions: "Assumptions",
  signals: "Signals",
  queue: "Queue",
  log: "Log",
  review: "Review",
  peers: "Peers",
};

function statusTone(s: Assumption["status"]) {
  return s;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Rag({ value }: { value: string }) {
  const tone =
    value === "green" ? "holding" : value === "amber" ? "weakening" : value === "red" ? "broken" : "untested";
  return <Badge tone={tone}>{value}</Badge>;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function StrategyWorkspace({ id }: { id: number }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => getStrategyBundle({ data: { id } }),
  });
  const [view, setView] = useState<View>("overview");
  const [selectedAssumption, setSelectedAssumption] = useState<number | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<number | null>(null);
  const [focusCategory, setFocusCategory] = useState<number | null>(null);

  if (q.isPending) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (q.error || !q.data) {
    return <p className="text-sm text-broken">Could not load this strategy.</p>;
  }
  const bundle = q.data;
  const assumption = bundle.assumptions.find((a) => a.id === selectedAssumption) ?? null;
  const signal = bundle.signals.find((s) => s.id === selectedSignal) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/app" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> All strategies
          </Link>
          <h1 className="font-serif text-3xl leading-tight">{bundle.strategy.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{bundle.strategy.vision}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Rag value={bundle.strategy.delivery_rag} />
          <select
            className="h-10 rounded-sm border border-border bg-background px-2 text-sm"
            value={bundle.strategy.delivery_rag}
            onChange={(e) =>
              updateStrategy({
                data: { id, delivery_rag: e.target.value as StrategyBundle["strategy"]["delivery_rag"] },
              }).then(() => qc.invalidateQueries({ queryKey: ["strategy", id] }))
            }
          >
            <option value="unrated">Delivery unrated — M&E not scored</option>
            <option value="green">Delivery green — plan is on track</option>
            <option value="amber">Delivery amber — slippage, plan still stands</option>
            <option value="red">Delivery red — published plan has failed</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(
                `${bundle.strategy.title.slice(0, 40)}-analysis.md`,
                analysisMarkdown(bundle),
              )
            }
          >
            Download analysis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(
                `${bundle.strategy.title.slice(0, 40)}-revision-brief.md`,
                revisionBriefMarkdown(bundle),
              )
            }
          >
            Download revision brief
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`h-11 shrink-0 border-b-2 px-3 text-sm ${
              view === v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <Overview
          bundle={bundle}
          onOpenAssumption={setSelectedAssumption}
          onOpenCategory={(id) => {
            setFocusCategory(id);
            setView("categories");
          }}
        />
      )}
      {view === "categories" && (
        <CategoriesView
          bundle={bundle}
          focusId={focusCategory}
          onOpenAssumption={setSelectedAssumption}
          onOpenSignal={setSelectedSignal}
        />
      )}
      {view === "assumptions" && (
        <AssumptionBoard
          bundle={bundle}
          onOpen={setSelectedAssumption}
        />
      )}
      {view === "signals" && <SignalTable bundle={bundle} onOpen={setSelectedSignal} />}
      {view === "queue" && <QueueView bundle={bundle} strategyId={id} onLogged={() => qc.invalidateQueries({ queryKey: ["strategy", id] })} />}
      {view === "log" && <LogView bundle={bundle} />}
      {view === "review" && <ReviewView bundle={bundle} strategyId={id} onLogged={() => qc.invalidateQueries({ queryKey: ["strategy", id] })} />}
      {view === "peers" && <PeersView bundle={bundle} strategyId={id} onDone={() => qc.invalidateQueries({ queryKey: ["strategy", id] })} />}

      {assumption ? (
        <DetailDrawer title="Assumption" onClose={() => setSelectedAssumption(null)}>
          <AssumptionDetail bundle={bundle} assumption={assumption} onClose={() => { setSelectedAssumption(null); void qc.invalidateQueries({ queryKey: ["strategy", id] }); }} />
        </DetailDrawer>
      ) : null}
      {signal ? (
        <DetailDrawer title="Signal" onClose={() => setSelectedSignal(null)}>
          <SignalDetail signal={signal} />
        </DetailDrawer>
      ) : null}
    </div>
  );
}

function Overview({
  bundle,
  onOpenAssumption,
  onOpenCategory,
}: {
  bundle: StrategyBundle;
  onOpenAssumption: (id: number) => void;
  onOpenCategory: (id: number) => void;
}) {
  const m = bundle.metrics;
  return (
    <div className="space-y-6">
      <PageGuide title="How to read this page">
        <p>
          This is the situation room for one living document. Conventional monitoring asks whether activities
          happened. This page asks whether the strategy needs to change.
        </p>
        <ColorLegend />
        <p className="pt-2">
          Gold / amber bars mean caution, not disaster. Green means the bet currently holds. Red means it is
          false. Grey means nobody has checked yet — that is not the same as green.
        </p>
      </PageGuide>
      <PageGuide title="Methodology">
        <MethodologySection compact />
      </PageGuide>
      <GlossaryStrip ids={["assumption", "sentinel", "interrupt", "cliff", "delivery", "validity", "coverage", "budget", "pressure"]} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Assumption integrity"
          value={`${m.holding} holding`}
          sub={`${m.weakening} weakening · ${m.broken} broken · ${m.untested} untested of ${bundle.assumptions.length}`}
        />
        <Stat label="Coverage" value={pct(m.coverage_ratio)} sub="share of assumptions with a live sentinel" />
        <Stat
          label="Signal budget"
          value={`${m.active_signals} / ${BUDGET.maxActiveSignals}`}
          sub={`${m.sentinel_count} / ${BUDGET.maxSentinels} sentinels · ${m.stale_count} stale`}
        />
        <Stat
          label="Next cliff"
          value={m.days_to_cliff == null ? "None" : `${m.days_to_cliff}d`}
          sub={m.next_cliff_name ?? "No named dated event"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Delivery versus validity</CardTitle>
          <CardDescription>
            Delivery is existing M&E (did we do the plan?). Validity is whether the bets still hold. The
            dangerous cell is green delivery over a weakening logic — on track and already wrong.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-3">
          <Strip label="Delivery (existing M&E)" tone={bundle.strategy.delivery_rag} />
          <Strip
            label="Validity (assumption integrity)"
            tone={m.broken ? "red" : m.weakening ? "amber" : m.holding ? "green" : "unrated"}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category pressure</CardTitle>
          <CardDescription>
            Ten watch-areas. The number is pressure on a scale of {PRESSURE_RANGE.min} to {PRESSURE_RANGE.max}:
            how much the hottest signal in that area matters, how fast it can move, and how little you trust the
            current figure. A dash means nothing is being watched there — a gap, not calm. Click a tile to open
            that room.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <PressureScale />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {CATEGORIES.map((c) => {
              const hot = bundle.signals
                .filter((s) => s.category === c.id && s.status === "active")
                .sort((a, b) => b.pressure - a.pressure)[0];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenCategory(c.id)}
                  className="rounded-md border border-border p-3 text-left hover:bg-muted"
                >
                  <p className="text-xs text-muted-foreground">{c.short}</p>
                  {hot ? <PressureReading value={hot.pressure} /> : <p className="mt-1 font-mono text-lg">—</p>}
                  <p className="mt-1 truncate text-xs text-muted-foreground">{hot?.name ?? "No active signal"}</p>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assumption health · {bundle.assumptions.length} of {BUDGET.maxAssumptions} allowed</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 p-0">
            {bundle.assumptions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpenAssumption(a.id)}
                className="flex w-full items-start justify-between gap-3 border-t border-border px-5 py-3 text-left hover:bg-muted"
              >
                <span className="text-sm">{a.claim}</span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </button>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Horizon and cliffs</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {bundle.strategy.horizon_start ?? "—"} → {bundle.strategy.horizon_end ?? "—"}
            </p>
            {bundle.cliffs.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{c.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {c.cliff_date} · {c.kind}
                </span>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Decision queue</p>
              <p className="font-mono text-2xl tabular-nums">
                {bundle.queue.length} / {BUDGET.maxQueue}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Items the monitor thinks you must decide this sitting. Open the Queue tab.
              </p>
            </div>
            {bundle.documents?.length ? (
              <div className="pt-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Documents stored</p>
                {bundle.documents.map((d) => (
                  <p key={d.id} className="text-xs text-muted-foreground">
                    {d.filename} · {d.char_count.toLocaleString()} characters · {d.chunk_count} chunks
                  </p>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-serif text-2xl">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardBody>
    </Card>
  );
}

function Strip({ label, tone }: { label: string; tone: string }) {
  const bg =
    tone === "green" ? "bg-holding" : tone === "amber" ? "bg-weakening" : tone === "red" ? "bg-broken" : "bg-muted";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="uppercase">{tone}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className={`h-2 w-full rounded-full ${bg}`} />
      </div>
    </div>
  );
}

function verdictTone(v: CategoryResult["verdict"]) {
  if (v === "gap") return "untested";
  if (v === "quiet") return "holding";
  if (v === "moderate") return "untested";
  if (v === "high") return "weakening";
  return "broken";
}

function CategoriesView({
  bundle,
  focusId,
  onOpenAssumption,
  onOpenSignal,
}: {
  bundle: StrategyBundle;
  focusId: number | null;
  onOpenAssumption: (id: number) => void;
  onOpenSignal: (id: number) => void;
}) {
  const results = analyzeAllCategories(bundle);
  const gaps = results.filter((r) => r.verdict === "gap").length;

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`category-${focusId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusId]);

  return (
    <div className="space-y-6">
      <PageGuide title="What this screen is">
        <p>
          Every strategy is read through the same ten rooms. This page fills each room with what this document
          is watching — and what it is not. A dash on Overview is a gap here. Click a signal or a bet to see
          the detail.
        </p>
        <PressureScale />
      </PageGuide>

      <p className="text-sm text-muted-foreground">
        {gaps === 0
          ? "Every room has at least one watchpoint."
          : `${gaps} of 10 rooms have no watchpoint — those are blind spots, not calm.`}
      </p>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {results.map((r) => (
          <a
            key={r.id}
            href={`#category-${r.id}`}
            className="shrink-0 rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            {r.short}
            <span className="ml-1 text-muted-foreground">
              {r.pressure == null ? "—" : r.pressure}
            </span>
          </a>
        ))}
      </div>

      <div className="space-y-4">
        {results.map((r) => (
          <article
            key={r.id}
            id={`category-${r.id}`}
            className={`scroll-mt-20 rounded-xl border p-5 ${
              focusId === r.id ? "border-foreground" : "border-border"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-2xl">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {r.id}. {r.short}
                </p>
                <h2 className="mt-1 font-serif text-2xl leading-snug">{r.name}</h2>
                <p className="mt-2 text-sm font-medium">{r.question}</p>
                <p className="mt-2 text-sm text-muted-foreground text-pretty">{r.why}</p>
              </div>
              <div className="w-36 shrink-0">
                {r.pressure != null ? <PressureReading value={r.pressure} /> : <p className="font-mono text-lg">—</p>}
                <Badge tone={verdictTone(r.verdict)} className="mt-2">
                  {r.verdict === "gap" ? "blind spot" : r.verdict}
                </Badge>
              </div>
            </div>

            <p className="mt-4 text-sm">{r.reading}</p>
            <p className="mt-2 text-xs text-muted-foreground">Look for: {r.looksFor}</p>
            <p className="mt-1 text-xs text-muted-foreground">Example: {r.example}</p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Watchpoints in this room</p>
                {r.signals.length ? (
                  <ul className="mt-2 space-y-2">
                    {r.signals.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="text-left text-sm hover:underline"
                          onClick={() => onOpenSignal(s.id)}
                        >
                          {s.name}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.pressure}/{PRESSURE_RANGE.max} · {s.layer}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{r.ifEmpty}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Bets this room is testing</p>
                {r.assumptions.length ? (
                  <ul className="mt-2 space-y-2">
                    {r.assumptions.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className="text-left text-sm hover:underline"
                          onClick={() => onOpenAssumption(a.id)}
                        >
                          {a.claim}
                          <Badge tone={statusTone(a.status)} className="ml-2">
                            {a.status}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No load-bearing assumption is linked here yet.
                  </p>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AssumptionBoard({ bundle, onOpen }: { bundle: StrategyBundle; onOpen: (id: number) => void }) {
  return (
    <div className="space-y-4">
      <PageGuide title="What you are looking at — and what to do">
        <p>
          Each row is a <strong>load-bearing assumption</strong>: a bet that, if false, would change the
          document. The budget is 5–12. Romania’s sample uses all 12.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Origin</strong> — stated in the official text, or implicit (a bet the authors did not write
            down).
          </li>
          <li>
            <strong>Status</strong> — holding / weakening / broken / untested. Untested is a work order, not a
            pass.
          </li>
          <li>
            <strong>If broken</strong> — the revision intensity you pre-committed: watch, amend, refresh, or
            reset.
          </li>
          <li>
            <strong>Owner</strong> — who must bring evidence to the next sitting.
          </li>
        </ul>
        <p>Click a row to add evidence or search adjacent practice. Do not add a 13th until you retire one.</p>
        <ColorLegend />
      </PageGuide>
      <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-xl text-left text-sm">
        <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Claim</th>
            <th className="px-4 py-3 font-medium">Origin</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">If broken</th>
            <th className="px-4 py-3 font-medium">Owner</th>
          </tr>
        </thead>
        <tbody>
          {bundle.assumptions.map((a) => (
            <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-muted" onClick={() => onOpen(a.id)}>
              <td className="max-w-md px-4 py-3">{a.claim}</td>
              <td className="px-4 py-3 text-muted-foreground">{a.origin}</td>
              <td className="px-4 py-3">
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </td>
              <td className="px-4 py-3 uppercase">{a.implied_intensity}</td>
              <td className="px-4 py-3 text-muted-foreground">{a.owner_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function SignalTable({ bundle, onOpen }: { bundle: StrategyBundle; onOpen: (id: number) => void }) {
  return (
    <div className="space-y-3">
      <PageGuide title="What a signal is — and what you should do">
        <p>
          A signal is a watchpoint, not a KPI dashboard. You are allowed 30 active and 8 sentinels. Creating
          the 31st requires retiring one.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Sentinel</strong> — always on, every review cycle.
          </li>
          <li>
            <strong>Rotating</strong> — this quarter only. Park it when the question is answered.
          </li>
          <li>
            <strong>M·V·C</strong> — materiality, velocity, confidence, each 1–5. Pressure = M × V × (6 − C).
            Low confidence raises pressure on purpose. Pressure always sits between {PRESSURE_RANGE.min} and{" "}
            {PRESSURE_RANGE.max}.
          </li>
          <li>
            <strong>Value</strong> — the current reading. “NO BASELINE” means the official text specified the
            system and never measured it. That is a finding.
          </li>
        </ul>
        <p>
          Click a row for thresholds (watch / amend / refresh / reset) and the false-positive guard — the
          sentence that stops you treating a local flood as national strategy failure.
        </p>
      </PageGuide>
      <p className="text-sm text-muted-foreground">
        Active {bundle.metrics.active_signals}/{BUDGET.maxActiveSignals} · sentinels {bundle.metrics.sentinel_count}/
        {BUDGET.maxSentinels}. Stale means evidence is older than twice the cadence.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-2xl text-left text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Signal</th>
              <th className="px-4 py-3 font-medium">Cat</th>
              <th className="px-4 py-3 font-medium">Layer</th>
              <th className="px-4 py-3 font-medium">M·V·C</th>
              <th className="px-4 py-3 font-medium">Pressure / {PRESSURE_RANGE.max}</th>
              <th className="px-4 py-3 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {bundle.signals.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-border hover:bg-muted" onClick={() => onOpen(s.id)}>
                <td className="px-4 py-3">
                  {s.name}
                  {s.stale ? <span className="ml-2 text-xs text-weakening">stale</span> : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{categoryById(s.category).short}</td>
                <td className="px-4 py-3">{s.layer}</td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {s.materiality}·{s.velocity}·{s.confidence}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {s.pressure}
                  <span className="text-muted-foreground">/{PRESSURE_RANGE.max}</span>
                </td>
                <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{s.current_value || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueView({
  bundle,
  strategyId,
  onLogged,
}: {
  bundle: StrategyBundle;
  strategyId: number;
  onLogged: () => void;
}) {
  return (
    <div className="space-y-3">
      <PageGuide title="What the queue is — and what you must do">
        <p>
          The queue is a triage list of at most 12 items the monitor thinks you must decide <em>now</em>. It is
          not a to-do list you invent. An item appears when:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>an interrupt (red line) has been fired</li>
          <li>a load-bearing assumption is weakening or broken</li>
          <li>a sentinel is stale, or in the top quarter of pressure</li>
          <li>delivery is scored green while the logic is weakening (the dangerous cell)</li>
          <li>a cliff is fewer than 180 days away</li>
        </ul>
        <p>
          For each card: read the reason, type a rationale (required), pick an intensity, log the decision.
          Logging <strong>no change</strong> is a decision. Leaving the queue untouched is not.
        </p>
        <IntensityLegend />
      </PageGuide>
      {bundle.queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Queue is empty. Log “no change” in Review if you checked and nothing moved.</p>
      ) : (
        bundle.queue.map((item) => <QueueCard key={item.id} item={item} strategyId={strategyId} onLogged={onLogged} />)
      )}
    </div>
  );
}

function QueueCard({ item, strategyId, onLogged }: { item: QueueItem; strategyId: number; onLogged: () => void }) {
  const [rationale, setRationale] = useState("");
  const [intensity, setIntensity] = useState<Intensity>(item.intensity_hint);
  const log = useMutation({
    mutationFn: () =>
      logDecision({
        data: {
          strategy_id: strategyId,
          intensity,
          summary: item.title.slice(0, 180),
          rationale,
          assumption_id: item.kind === "assumption" ? item.ref_id : null,
          signal_id: item.kind === "signal" ? item.ref_id : null,
        },
      }),
    onSuccess: () => {
      toast.success("Decision logged");
      setRationale("");
      onLogged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{item.title}</CardTitle>
        <CardDescription>
          {item.kind} · suggested {item.intensity_hint}
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm">{item.reason}</p>
        <Label>Rationale (required)</Label>
        <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-20" />
        <div className="flex flex-wrap gap-2">
          {(["watch", "amend", "refresh", "reset", "no-change"] as Intensity[]).map((i) => (
            <Button key={i} size="sm" variant={intensity === i ? "default" : "outline"} onClick={() => setIntensity(i)}>
              {i}
            </Button>
          ))}
          <Button className="ml-auto" disabled={!rationale.trim() || log.isPending} onClick={() => log.mutate()}>
            Log decision
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function LogView({ bundle }: { bundle: StrategyBundle }) {
  return (
    <div className="space-y-4">
      <PageGuide title="What the log is">
        <p>
          Every decision you log from the queue is written here and cannot be edited. It is the proof that the
          document is living: why you amended Chapter 8, why you did not reset after a flood season. Download
          the revision brief from the header to take this sitting into a drafting room.
        </p>
      </PageGuide>
      {!bundle.decisions.length ? (
        <p className="text-sm text-muted-foreground">No decisions yet. The log is immutable once written.</p>
      ) : (
        <ul className="space-y-3">
          {bundle.decisions.map((d) => (
            <li key={d.id} className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge>{d.intensity}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{d.decided_at}</span>
              </div>
              <p className="mt-2 text-sm font-medium">{d.summary}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewView({
  bundle,
  strategyId,
  onLogged,
}: {
  bundle: StrategyBundle;
  strategyId: number;
  onLogged: () => void;
}) {
  return (
    <div className="space-y-4">
      <PageGuide title="How a 45-minute review sitting works">
        <p>
          This is the ritual that makes the document living. Silence is a failure — if you looked and nothing
          moved, log <strong>no change</strong>.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Interrupts (5 min).</strong> A red line that skips the calendar. Fire it if the event
            happened (a Vrancea-class earthquake, a 14-day platform outage, PNRRD not sitting). You will then
            have 30 days to review. Do not wait for the annual report.
          </li>
          <li>
            <strong>Queue (30 min).</strong> One card at a time. Rationale required. Prefer amend over refresh
            unless the pre-committed “if broken” intensity says otherwise.
          </li>
          <li>
            <strong>Commitments (10 min).</strong> Draft the actual words that go back into the original
            document (below). Then download the revision brief — it quotes the original and writes the
            replacement.
          </li>
        </ol>
        <GlossaryStrip ids={["interrupt", "queue", "cliff", "amend"]} />
      </PageGuide>
      <Card>
        <CardHeader>
          <CardTitle>1. Interrupts — red lines</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {bundle.interrupts.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <div>
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.red_line}</p>
                <p className="mt-1 text-xs uppercase tracking-wider">{i.status}</p>
              </div>
              {i.status !== "open" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    fireInterrupt({ data: { id: i.id, strategy_id: strategyId } }).then(() => {
                      toast.success("Interrupt fired · review in 30 days");
                      onLogged();
                    })
                  }
                >
                  Fire
                </Button>
              ) : (
                <span className="text-xs text-weakening">Review by {i.review_by}</span>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
      <QueueView bundle={bundle} strategyId={strategyId} onLogged={onLogged} />
      <AmendmentDraft bundle={bundle} strategyId={strategyId} onDone={onLogged} />
    </div>
  );
}

function AmendmentList({ amendments }: { amendments: Amendment[] }) {
  if (!amendments.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No drafted changes yet. Use “Draft changes from the original” to quote the document and write
        replacements.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {amendments.map((a) => (
        <li key={a.id} className="rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{a.intensity}</Badge>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{a.source}</span>
          </div>
          <p className="mt-2 text-sm font-medium">{a.location}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Original</p>
              <p className="mt-1 text-sm text-muted-foreground">{a.original_excerpt || "Not in the original text."}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Proposed text</p>
              <p className="mt-1 text-sm">{a.proposed_text}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{a.rationale}</p>
        </li>
      ))}
    </ul>
  );
}

function AmendmentDraft({
  bundle,
  strategyId,
  onDone,
}: {
  bundle: StrategyBundle;
  strategyId: number;
  onDone: () => void;
}) {
  const draft = useMutation({
    mutationFn: () => draftAmendments({ data: { strategy_id: strategyId, sessionKeys: readSessionKeys() } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.count} changes drafted from the original`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Changes to the original document</CardTitle>
        <CardDescription>
          Each item quotes a passage (or marks that the original is silent) and writes the words that should
          replace it. The Romania sample already carries four such patches. Re-draft after a sitting or after
          peer research.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <Button type="button" disabled={draft.isPending} onClick={() => draft.mutate()}>
          {draft.isPending ? "Drafting against the original…" : "Draft changes from the original"}
        </Button>
        <AmendmentList amendments={bundle.amendments ?? []} />
      </CardBody>
    </Card>
  );
}

function PeersView({
  bundle,
  strategyId,
  onDone,
}: {
  bundle: StrategyBundle;
  strategyId: number;
  onDone: () => void;
}) {
  const [years, setYears] = useState(5);
  const run = useMutation({
    mutationFn: () =>
      researchPeers({
        data: { strategy_id: strategyId, recency_years: years, sessionKeys: readSessionKeys() },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Compared ${res.findings} ideas from ${res.sources} sources`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const research = bundle.peer_research;

  return (
    <div className="space-y-4">
      <PageGuide title="Why look at other countries">
        <p>
          A living document should not only watch its own bets. It should also ask whether a recent peer
          strategy has solved a problem this one is silent on — an event-driven revision clause, a named
          successor fund, a reach indicator for vulnerable groups. You set how recent those peers must be.
          The brief uses live search (Exa) plus your language-model key. It is not allowed to invent sources.
        </p>
      </PageGuide>
      <Card>
        <CardHeader>
          <CardTitle>Search recent peer strategies</CardTitle>
          <CardDescription>
            Domain: {bundle.strategy.domain || "not set"}. Results are limited to the recency window you pick.
            An Exa key is required so the brief is grounded in documents, not in the model’s memory.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="recency">How recent</Label>
            <select
              id="recency"
              className="h-10 rounded-sm border border-border bg-background px-2 text-sm"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            >
              <option value={1}>Last 12 months</option>
              <option value={2}>Last 2 years</option>
              <option value={3}>Last 3 years</option>
              <option value={5}>Last 5 years</option>
              <option value={10}>Last 10 years</option>
            </select>
          </div>
          <Button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Searching peers…" : "Run research brief"}
          </Button>
        </CardBody>
      </Card>

      {research ? (
        <Card>
          <CardHeader>
            <CardTitle>Latest research brief</CardTitle>
            <CardDescription>
              Last {research.recency_years} years · {research.created_at}. This text is included in Download
              analysis and Download revision brief.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm whitespace-pre-wrap text-pretty">{research.summary}</p>
            <ul className="space-y-4">
              {research.findings.map((f) => {
                const room = f.category ? categoryGuide(f.category) : null;
                return (
                  <li key={f.id} className="rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{f.intensity}</Badge>
                      {room ? <span className="text-xs text-muted-foreground">{room.short}</span> : null}
                    </div>
                    <p className="mt-2 text-sm font-medium">
                      {f.country ? `${f.country} — ` : null}
                      {f.title}
                      {f.year ? ` (${f.year})` : null}
                    </p>
                    {f.url ? (
                      <a href={f.url} className="mt-1 block truncate text-xs text-muted-foreground hover:underline" target="_blank" rel="noreferrer">
                        {f.url}
                      </a>
                    ) : null}
                    <p className="mt-2 text-sm">{f.idea}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{f.relevance}</p>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">No peer brief yet. Set recency and run the search.</p>
      )}
    </div>
  );
}

function DetailDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-background p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssumptionDetail({
  bundle,
  assumption,
  onClose,
}: {
  bundle: StrategyBundle;
  assumption: Assumption;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [query, setQuery] = useState(assumption.claim);
  const [hits, setHits] = useState<{ title: string; url: string; text: string }[] | null>(null);
  const evidence = bundle.evidence.filter((e) => e.assumption_id === assumption.id);

  const add = useMutation({
    mutationFn: () =>
      addEvidence({
        data: {
          strategy_id: bundle.strategy.id,
          assumption_id: assumption.id,
          note,
          direction: "weakening",
        },
      }),
    onSuccess: () => {
      toast.success("Evidence added");
      setNote("");
      onClose();
    },
  });

  const search = useMutation({
    mutationFn: () => searchEvidence({ data: { query, sessionKeys: readSessionKeys() } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
      else setHits(res.results);
    },
  });

  return (
    <div className="space-y-4 text-sm">
      <p>{assumption.claim}</p>
      <div className="flex flex-wrap gap-2">
        <Badge>{assumption.origin}</Badge>
        <Badge tone={statusTone(assumption.status)}>{assumption.status}</Badge>
        <Badge>{assumption.implied_intensity} if broken</Badge>
      </div>
      <p className="text-muted-foreground">Owner · {assumption.owner_label || "unassigned"}</p>
      <div>
        <Label>Add evidence</Label>
        <Textarea className="mt-1 min-h-20" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button className="mt-2" size="sm" disabled={!note.trim()} onClick={() => add.mutate()}>
          Save evidence
        </Button>
      </div>
      <div>
        <Label>Search adjacent evidence (Exa)</Label>
        <div className="mt-1 flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => search.mutate()}>
            Search
          </Button>
        </div>
        {hits?.map((h) => (
          <a key={h.url} href={h.url} target="_blank" rel="noreferrer" className="mt-3 block border-t border-border pt-3">
            <p className="font-medium">{h.title}</p>
            <p className="text-xs text-muted-foreground">{h.text}</p>
          </a>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">On file</p>
        {evidence.map((e) => (
          <p key={e.id} className="text-muted-foreground">
            {e.note}
          </p>
        ))}
      </div>
    </div>
  );
}

function SignalDetail({ signal }: { signal: Signal }) {
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted-foreground">Category</dt>
        <dd>{categoryById(signal.category).name}</dd>
      </div>
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
          <dd>{signal[`threshold_${k}` as const] || "—"}</dd>
        </div>
      ))}
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted-foreground">False-positive guard</dt>
        <dd>{signal.false_positive_guard || "—"}</dd>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Pressure {signal.pressure}/{PRESSURE_RANGE.max} = M{signal.materiality} × V{signal.velocity} × (6−C
        {signal.confidence}) · {PRESSURE_RANGE.min} is quiet, {PRESSURE_RANGE.max} is as high as it goes.
      </p>
    </dl>
  );
}

export function IngestForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState<{ name: string; chars: number; pages: number | null; chunks?: number }[]>([]);
  const [chunks, setChunks] = useState<{ index: number; heading: string; body: string }[]>([]);
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
      setText((prev) => {
        const incoming = res.preview ?? res.combined;
        return prev.trim() ? `${prev.trim()}\n\n${incoming}` : incoming;
      });
      setChunks((prev) => [...prev, ...(res.chunks ?? [])]);
      setLoaded((prev) => [...prev, ...res.files]);
      toast.success(
        res.files.length === 1 ? `Read ${res.files[0]!.name}` : `Read ${res.files.length} files`,
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
      let body = text;
      if (url.trim()) {
        const pulled = await ingestUrl({ data: { url: url.trim(), sessionKeys: readSessionKeys() } });
        if (!pulled.ok) {
          toast.error(pulled.error);
          setBusy(false);
          return;
        }
        body = `${pulled.markdown}\n\n${text}`;
      }
      const res = await extractStrategy({
        data: {
          text: body,
          chunks: chunks.length ? chunks : undefined,
          sessionKeys: readSessionKeys(),
          provider: pref?.provider,
          model: pref?.model,
        },
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Architecture extracted");
        onCreated(res.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

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
        <span className="mt-1 text-xs text-muted-foreground">Click to choose — up to eight files, 12 MB each. Long PDFs are stored in full as chunks.</span>
      </label>
      {loaded.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {loaded.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name}
              {f.pages ? ` · ${f.pages} pages` : ""} · {f.chars.toLocaleString()} characters
              {f.chunks ? ` · ${f.chunks} chunks stored` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <Label htmlFor="url">Or a public URL (Jina Reader)</Label>
      <Input id="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Label htmlFor="body">Text to extract</Label>
      <Textarea
        id="body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Uploads appear here. You can also paste."
      />
      <Button disabled={busy || (!text.trim() && !url.trim())} onClick={() => void runExtract()}>
        {busy ? "Extracting…" : "Extract monitoring architecture"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Extraction uses the language-model pair on the Keys page (xAI, OpenAI, Anthropic, OpenRouter, Gemini, or
        Perplexity). URL ingest needs Jina. Spreadsheets (.xlsx, .csv) are welcome. The whole document is stored in
        chunks — not only the opening and closing pages. Scanned image-only PDFs will not yield text.
      </p>
    </div>
  );
}
