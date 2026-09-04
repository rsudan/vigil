import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getStrategyBundle, logDecision } from "@/lib/server/strategies";
import { readDocumentIntoRooms } from "@/lib/server/rooms";
import {
  ROOM_REVIEW_DAYS,
  analyzeAllCategories,
  roomsWithoutWatchpoint,
  unwatchedBets,
  verdictWord,
  type CategoryResult,
} from "@/lib/category-analysis";
import { analysisMarkdown, revisionBriefMarkdown } from "@/lib/brief";
import { validityOf } from "@/lib/compute";
import { deliveryWord } from "@/lib/glossary";
import { BUDGET, PRESSURE_RANGE, categoryById } from "@/lib/taxonomy";
import type { StrategyBundle } from "@/lib/types";
import { ColorLegend, GlossaryStrip, PageGuide, PressureReading, PressureScale } from "./explain";
import { MethodologySection } from "./methodology";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { AssumptionDetail, NewAssumptionForm } from "./workspace/assumption-detail";
import { RoomEvidence } from "./workspace/room-evidence";
import { PeersView } from "./workspace/peers-view";
import { QueueView } from "./workspace/queue-view";
import { ReviewView } from "./workspace/review-view";
import { AssessDialog } from "./workspace/assess-dialog";
import { AssessmentCard } from "./workspace/assessment-card";
import { SettingsDialog } from "./workspace/settings-dialog";
import { canEdit, day, downloadText, pct, statusTone, useRefresh } from "./workspace/util";
import { SignalDetail } from "./workspace/signal-detail";
import { SignalForm } from "./workspace/signal-form";
import { TeamView } from "./workspace/team-view";

const VIEWS = ["overview", "categories", "assumptions", "signals", "queue", "log", "review", "peers", "team"] as const;
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
  team: "Team",
};

function ragTone(value: string) {
  return value === "green" ? "holding" : value === "amber" ? "weakening" : value === "red" ? "broken" : "untested";
}

export function StrategyWorkspace({ id }: { id: number }) {
  const refresh = useRefresh(id);
  const q = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => getStrategyBundle({ data: { id } }),
  });
  const [view, setView] = useState<View>("overview");
  const [selectedAssumption, setSelectedAssumption] = useState<number | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<number | null>(null);
  const [focusCategory, setFocusCategory] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (q.isPending) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (q.error || !q.data) {
    return (
      <p className="text-sm text-broken">
        Could not load this strategy{q.error instanceof Error ? `: ${q.error.message}` : "."}
      </p>
    );
  }
  const bundle = q.data;
  const editable = canEdit(bundle.my_role);
  const assumption = bundle.assumptions.find((a) => a.id === selectedAssumption) ?? null;
  const signal = bundle.signals.find((s) => s.id === selectedSignal) ?? null;
  const m = bundle.metrics;
  const validity = validityOf(bundle.assumptions);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/app" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> All strategies
          </Link>
          <h1 className="font-serif text-3xl leading-tight">{bundle.strategy.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{bundle.strategy.vision}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone={bundle.my_role === "viewer" ? "untested" : "primary"}>{bundle.my_role}</Badge>
            {bundle.strategy.domain ? <span>{bundle.strategy.domain}</span> : null}
            {bundle.strategy.language ? <span>· {bundle.strategy.language}</span> : null}
            <span>· {bundle.members.length} member{bundle.members.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ragTone(bundle.strategy.delivery_rag)}>
            Delivery {deliveryWord(bundle.strategy.delivery_rag).toLowerCase()}
          </Badge>
          <Badge tone={ragTone(validity.rag)}>Validity {validity.label.toLowerCase()}</Badge>
          {editable ? (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" /> Settings
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(`${bundle.strategy.title.slice(0, 40)}-analysis.md`, analysisMarkdown(bundle))}
          >
            Download analysis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(`${bundle.strategy.title.slice(0, 40)}-revision-brief.md`, revisionBriefMarkdown(bundle))
            }
          >
            Download revision brief
          </Button>
        </div>
      </div>

      {m.overdue_interrupts || m.crossed_count || m.broken || m.queue_overflow ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {m.overdue_interrupts ? (
            <Badge tone="broken">
              {m.overdue_interrupts} interrupt{m.overdue_interrupts > 1 ? "s" : ""} past review deadline
            </Badge>
          ) : null}
          {m.crossed_count ? (
            <Badge tone="broken">
              {m.crossed_count} threshold{m.crossed_count > 1 ? "s" : ""} crossed
            </Badge>
          ) : null}
          {m.broken ? <Badge tone="broken">{m.broken} broken bet{m.broken > 1 ? "s" : ""}</Badge> : null}
          {m.queue_overflow ? (
            <Badge tone="weakening">
              {m.queue_overflow} item{m.queue_overflow > 1 ? "s" : ""} beyond the queue
            </Badge>
          ) : null}
          <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setView("queue")}>
            Open the queue
          </button>
        </div>
      ) : null}

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
            {v === "queue" && bundle.queue.length ? (
              <span className="ml-1 font-mono text-xs text-muted-foreground">{bundle.queue.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <Overview
          bundle={bundle}
          onOpenAssumption={setSelectedAssumption}
          onOpenCategory={(cid) => {
            setFocusCategory(cid);
            setView("categories");
          }}
          onOpenQueue={() => setView("queue")}
          onChanged={refresh}
        />
      )}
      {view === "categories" && (
        <CategoriesView
          bundle={bundle}
          focusId={focusCategory}
          onOpenAssumption={setSelectedAssumption}
          onOpenSignal={setSelectedSignal}
          onChanged={refresh}
        />
      )}
      {view === "assumptions" && <AssumptionBoard bundle={bundle} onOpen={setSelectedAssumption} onChanged={refresh} />}
      {view === "signals" && <SignalTable bundle={bundle} onOpen={setSelectedSignal} onChanged={refresh} />}
      {view === "queue" && <QueueView bundle={bundle} onLogged={refresh} />}
      {view === "log" && <LogView bundle={bundle} />}
      {view === "review" && <ReviewView bundle={bundle} onChanged={refresh} />}
      {view === "peers" && <PeersView bundle={bundle} onDone={refresh} />}
      {view === "team" && <TeamView bundle={bundle} onChanged={refresh} />}

      {assumption ? (
        <DetailDrawer title="Assumption" onClose={() => setSelectedAssumption(null)}>
          <AssumptionDetail
            key={assumption.id}
            bundle={bundle}
            assumption={assumption}
            onChanged={refresh}
            onClose={() => setSelectedAssumption(null)}
          />
        </DetailDrawer>
      ) : null}
      {signal ? (
        <DetailDrawer title="Signal" onClose={() => setSelectedSignal(null)}>
          <SignalDetail
            key={signal.id}
            bundle={bundle}
            signal={signal}
            onChanged={refresh}
            onClose={() => setSelectedSignal(null)}
          />
        </DetailDrawer>
      ) : null}
      {settingsOpen ? (
        <SettingsDialog bundle={bundle} open={settingsOpen} onOpenChange={setSettingsOpen} onChanged={refresh} />
      ) : null}
    </div>
  );
}

function Overview({
  bundle,
  onOpenAssumption,
  onOpenCategory,
  onOpenQueue,
  onChanged,
}: {
  bundle: StrategyBundle;
  onOpenAssumption: (id: number) => void;
  onOpenCategory: (id: number) => void;
  onOpenQueue: () => void;
  onChanged: () => void;
}) {
  const m = bundle.metrics;
  const rooms = analyzeAllCategories(bundle);
  const [assessing, setAssessing] = useState(false);
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
      <PageGuide title="Terms used on this page">
        <GlossaryStrip ids={["assumption", "sentinel", "crossed", "interrupt", "cliff", "delivery", "validity", "coverage", "budget", "pressure"]} />
      </PageGuide>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Assumptions" value={String(bundle.assumptions.length)} sub="load-bearing bets the strategy depends on" />
        <Stat
          label="Sentinels"
          value={String(m.sentinel_count)}
          sub={`checked every cycle, of ${BUDGET.maxSentinels} allowed · ${pct(m.coverage_ratio)} of bets covered`}
        />
        <Stat
          label="Signals"
          value={String(m.active_signals)}
          sub={`active watchpoints, sentinels included, of ${BUDGET.maxActiveSignals} allowed`}
        />
        <Stat label="Interrupts" value={String(bundle.interrupts.length)} sub="red lines agreed in advance" />
        <Stat
          label="Next cliff"
          value={m.days_to_cliff == null ? "None" : `${m.days_to_cliff}d`}
          sub={m.next_cliff_name ?? "No dated event ahead"}
        />
      </div>

      <AssessmentCard
        bundle={bundle}
        onAssess={() => setAssessing(true)}
        onOpenAssumption={onOpenAssumption}
        onOpenQueue={onOpenQueue}
      />
      {assessing ? (
        <AssessDialog bundle={bundle} open={assessing} onOpenChange={setAssessing} onSaved={onChanged} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Category pressure</CardTitle>
          <CardDescription>
            Ten rooms. The number is the pressure of the hottest watchpoint in that room, on a scale of{" "}
            {PRESSURE_RANGE.min} to {PRESSURE_RANGE.max}: how much it matters, how fast it can move, and how little
            you trust the current figure. A dash means nothing is being watched there — a gap, not calm. The word
            under it is the room’s verdict, which also counts fired red lines, crossed thresholds, broken or
            weakening bets, and cliffs that have passed or fall inside 180 days. Click a tile to open that room.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <PressureScale />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenCategory(r.id)}
                className="rounded-md border border-border p-3 text-left hover:bg-muted"
              >
                <p className="text-xs text-muted-foreground">{r.short}</p>
                {r.hottest ? <PressureReading value={r.hottest.pressure} /> : <p className="mt-1 font-mono text-lg">—</p>}
                <Badge tone={verdictTone(r.verdict)} className="mt-1">
                  {verdictWord(r.verdict)}
                </Badge>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={r.headline}>
                  {r.headline}
                </p>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Assumption health · {bundle.assumptions.length} of {BUDGET.maxAssumptions} allowed
            </CardTitle>
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
            {!bundle.assumptions.length ? (
              <p className="px-5 py-3 text-sm text-muted-foreground">No bets named yet. Add them on the Assumptions tab.</p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Horizon and cliffs</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {bundle.strategy.horizon_start ?? "—"} to {bundle.strategy.horizon_end ?? "—"}
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
                {m.queue_overflow ? <span className="text-sm text-muted-foreground"> +{m.queue_overflow} waiting</span> : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Items the monitor thinks you must decide this sitting, in rank order. Open the Queue tab.
              </p>
            </div>
            {bundle.documents?.length ? (
              <div className="pt-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Documents stored</p>
                {bundle.documents.map((d) => (
                  <p key={d.id} className="text-xs text-muted-foreground">
                    {d.filename} · {d.char_count.toLocaleString()} characters · {d.chunk_count} chunks
                    {d.page_count ? ` · ${d.page_count} pages` : ""}
                  </p>
                ))}
                {bundle.strategy.extraction_note ? (
                  <p className="mt-1 text-xs text-muted-foreground">{bundle.strategy.extraction_note}</p>
                ) : null}
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
  onChanged,
}: {
  bundle: StrategyBundle;
  focusId: number | null;
  onOpenAssumption: (id: number) => void;
  onOpenSignal: (id: number) => void;
  onChanged: () => void;
}) {
  const results = analyzeAllCategories(bundle);
  const gaps = roomsWithoutWatchpoint(results).length;
  const unwatched = unwatchedBets(bundle);
  const editable = canEdit(bundle.my_role);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`category-${focusId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusId]);

  return (
    <div className="space-y-6">
      <PageGuide title="What this screen is">
        <p>
          Every strategy is read through the same ten rooms. This page fills each room from three places: the
          register (what this document is watching, betting on and has agreed to reopen on), the uploaded strategy
          itself, and the world outside.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Watchpoints</strong> sit in the room they were given. A signal with a second room is listed there
            too, marked “also filed here”; its pressure and crossed thresholds count in both.
          </li>
          <li>
            <strong>Bets</strong> have no room of their own. A bet is shown in a room through the watchpoint that
            tests it, so a bet in the wrong room means either the wrong watchpoint is linked to it, or that
            watchpoint is in the wrong room. A bet with no active watchpoint sits in no room at all.
          </li>
          <li>
            <strong>Red lines</strong> sit in the room they were given on the Review tab. One with no room is filed
            under Risks until you set it.
          </li>
          <li>
            <strong>Cliffs</strong> sit by kind: fiscal in Resources, legal in Mandate, review in Assumptions,
            scenario in Risks.
          </li>
        </ul>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>What the document says</strong> — verbatim sentences from the strategy you uploaded, with where
            they sit in it: the page, when the document has pages. Found by lexical search, with no model and no key.
            A room the document never addresses says so, and that is a finding.
          </li>
          <li>
            <strong>From the world</strong> — what a search found about this room since a date you choose. It runs
            only when you ask, on your own keys, and every candidate must quote a source the search returned.
          </li>
        </ul>
        <p>
          Neither of those changes a room’s colour, its pressure or the queue. The document was already true the day
          it was signed, and a search result is dated but was never agreed in advance. The only way either becomes a
          colour is you turning it into a watchpoint or a red line.
        </p>
        <p>
          A room’s verdict rests on the register, strongest first: a fired red line, a crossed threshold, a broken
          or weakening bet watched from the room, a cliff that has passed or is inside 180 days. Failing all of
          those, it is the pressure band of the hottest watchpoint. The reading names whichever of them the queue
          ranks highest, so the room and the queue never tell a different story. A room with no watchpoint is a gap,
          not calm, even when a red line is armed there.
        </p>
        <PressureScale />
      </PageGuide>

      <p className="text-sm text-muted-foreground">
        {gaps === 0
          ? "Every room has at least one watchpoint."
          : `${gaps} of 10 rooms ${gaps === 1 ? "has" : "have"} no watchpoint. Either the document is silent there or nothing has been added yet: add a signal, or record on the room that it was reviewed and has nothing to watch.`}
        {unwatched.length
          ? ` ${unwatched.length} bet${unwatched.length === 1 ? " has" : "s have"} no active watchpoint and so ${
              unwatched.length === 1 ? "sits" : "sit"
            } in no room.`
          : ""}
      </p>

      <ReadDocumentButton bundle={bundle} onDone={onChanged} />

      <div className="flex gap-1 overflow-x-auto pb-1">
        {results.map((r) => (
          <a key={r.id} href={`#category-${r.id}`} className="shrink-0 rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted">
            {r.short}
            <span className="ml-1 text-muted-foreground">{r.pressure == null ? "—" : r.pressure}</span>
          </a>
        ))}
      </div>

      <div className="space-y-4">
        {results.map((r) => (
          <article
            key={r.id}
            id={`category-${r.id}`}
            data-room={r.id}
            className={`scroll-mt-20 rounded-xl border p-5 ${focusId === r.id ? "border-foreground" : "border-border"}`}
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
                <Badge tone={verdictTone(r.verdict)} className="mt-2" data-verdict={r.verdict}>
                  {verdictWord(r.verdict)}
                </Badge>
              </div>
            </div>

            <p className="mt-4 text-sm">
              {r.reading}
              {r.also ? ` ${r.also}` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Look for: {r.looksFor}</p>

            <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Watchpoints in this room</p>
                {r.signals.length ? (
                  <ul className="mt-2 space-y-2">
                    {r.signals.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="text-left text-sm hover:underline" onClick={() => onOpenSignal(s.id)}>
                          {s.name}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.pressure}/{PRESSURE_RANGE.max} · {s.layer}
                            {s.stale ? " · stale" : ""}
                            {s.crossed_level !== "none" ? ` · crossed ${s.crossed_level}` : ""}
                            {s.category !== r.id ? " · also filed here" : ""}
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
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Red lines and cliffs in this room</p>
                {r.interrupts.length || r.cliffs.length ? (
                  <ul className="mt-2 space-y-2 text-sm">
                    {r.interrupts.map((i) => (
                      <li key={`int-${i.interrupt.id}`}>
                        {i.interrupt.name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          red line · {i.interrupt.status}
                          {i.overdue ? " · review overdue" : ""}
                          {i.room_set ? "" : " · room not set"}
                        </span>
                      </li>
                    ))}
                    {r.cliffs.map((c) => (
                      <li key={`cliff-${c.cliff.id}`}>
                        {c.cliff.name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {c.cliff.kind} cliff · {c.cliff.cliff_date} · {c.passed ? `passed ${-c.days}d ago` : `in ${c.days}d`}
                          {c.decided_at ? ` · decided ${day(c.decided_at)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No red line or dated event is placed here.</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Bets watched from this room</p>
                {r.bets.length ? (
                  <ul className="mt-2 space-y-2">
                    {r.bets.map((b) => (
                      <li key={b.assumption.id}>
                        <button
                          type="button"
                          className="text-left text-sm hover:underline"
                          onClick={() => onOpenAssumption(b.assumption.id)}
                        >
                          {b.assumption.claim}
                          <Badge tone={statusTone(b.assumption.status)} className="ml-2">
                            {b.assumption.status}
                          </Badge>
                        </button>
                        <p className="text-xs text-muted-foreground">via {b.via.map((s) => s.name).join(", ")}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No bet is watched from this room.</p>
                )}
              </div>
            </div>

            <RoomEvidence bundle={bundle} room={r} onChanged={onChanged} />

            {!r.signals.length && editable ? (
              <RoomReviewForm key={r.reviewed?.at ?? "none"} strategyId={bundle.strategy.id} room={r} onLogged={onChanged} />
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * Reading the uploaded document into the ten rooms. Free, offline, no key: it
 * is lexical search over text already stored, so it can be run as often as
 * anyone likes.
 */
function ReadDocumentButton({ bundle, onDone }: { bundle: StrategyBundle; onDone: () => void }) {
  const read = useMutation({
    mutationFn: () => readDocumentIntoRooms({ data: { strategy_id: bundle.strategy.id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Read the document into ${res.rooms} rooms: ${res.spoke} speak, ${res.silent} silent${res.unmatched ? `, ${res.unmatched} where the room’s words do not match this text` : ""}`,
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reads = bundle.room_reads ?? [];
  const lastRead = reads.map((r) => r.read_at).sort()[reads.length - 1];
  if (!canEdit(bundle.my_role)) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
      <Button size="sm" variant="outline" disabled={read.isPending || !bundle.documents?.length} onClick={() => read.mutate()}>
        {read.isPending ? "Reading…" : "Read the document into the rooms"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {!bundle.documents?.length
          ? "No document is stored for this strategy, so there is nothing to read."
          : lastRead
            ? `Last read ${day(lastRead)}. Lexical search over the stored text: no model, no key, no cost.`
            : "Not read yet. Lexical search over the stored text: no model, no key, no cost."}
      </p>
    </div>
  );
}

/**
 * The record that someone looked at an unwatched room and found nothing to
 * watch: a dated, attributed no-change decision keyed to the room. It goes to
 * the log and stands for a while; it never makes the room watched.
 */
function RoomReviewForm({ strategyId, room, onLogged }: { strategyId: number; room: CategoryResult; onLogged: () => void }) {
  const [rationale, setRationale] = useState("");
  const log = useMutation({
    mutationFn: () =>
      logDecision({
        data: {
          strategy_id: strategyId,
          intensity: "no-change",
          summary: `Room ${room.id} ${room.short}: reviewed, nothing to watch`,
          rationale,
          item_key: `room-${room.id}`,
        },
      }),
    onSuccess: () => {
      toast.success(`Room ${room.id} recorded as reviewed`);
      setRationale("");
      onLogged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="mt-4 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {room.reviewed
          ? `Reviewed on ${day(room.reviewed.at)}${room.reviewed.author ? ` by ${room.reviewed.author}` : ""}: “${room.reviewed.rationale}”. The room cites it for ${ROOM_REVIEW_DAYS} days and then asks again; the log keeps it. It does not make the room watched.`
          : "If you looked at this room and there is nothing to watch, say so. The record is dated and attributed, goes to the decision log, and does not make the room watched."}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Textarea
          aria-label={`Why room ${room.id} has nothing to watch`}
          className="min-h-16 flex-1"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="What you looked at, and why there is nothing to watch here."
        />
        <Button size="sm" variant="outline" disabled={!rationale.trim() || log.isPending} onClick={() => log.mutate()}>
          Reviewed — nothing to watch
        </Button>
      </div>
    </div>
  );
}

function AssumptionBoard({
  bundle,
  onOpen,
  onChanged,
}: {
  bundle: StrategyBundle;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <PageGuide title="What you are looking at — and what to do">
        <p>
          Each row is a <strong>load-bearing assumption</strong>: a bet that, if false, would change the document.
          The budget is 5–12.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Origin</strong> — stated in the official text, or implicit (a bet the authors did not write down).
          </li>
          <li>
            <strong>Status</strong> — holding / weakening / broken / untested. Untested is a work order, not a pass.
            Change it from the row, with the evidence that justifies the change.
          </li>
          <li>
            <strong>If broken</strong> — the revision intensity you pre-committed: watch, amend, refresh, or reset.
          </li>
          <li>
            <strong>Owner</strong> — who must bring evidence to the next sitting.
          </li>
        </ul>
        <p>Click a row to record evidence, set the status, or search adjacent practice. Do not add a 13th until you retire one.</p>
        <ColorLegend />
      </PageGuide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {bundle.assumptions.length} of {BUDGET.maxAssumptions} bets named.
        </p>
        {editable ? (
          <Button size="sm" onClick={() => setAdding(true)} disabled={bundle.assumptions.length >= BUDGET.maxAssumptions}>
            Add assumption
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-xl text-left text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Claim</th>
              <th className="px-4 py-3 font-medium">Origin</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Since</th>
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
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{day(a.status_changed_at)}</td>
                <td className="px-4 py-3 uppercase">{a.implied_intensity}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.owner_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>New load-bearing assumption</DialogTitle>
          <DialogDescription>A bet that, if false, would change the document.</DialogDescription>
          <div className="mt-4">
            <NewAssumptionForm
              bundle={bundle}
              onSaved={() => {
                setAdding(false);
                onChanged();
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignalTable({
  bundle,
  onOpen,
  onChanged,
}: {
  bundle: StrategyBundle;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <PageGuide title="What a signal is — and what you should do">
        <p>
          A signal is a watchpoint, not a KPI dashboard. You are allowed {BUDGET.maxActiveSignals} active and{" "}
          {BUDGET.maxSentinels} sentinels. Creating the 31st requires parking or retiring one.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Sentinel</strong> — always on, every review cycle.
          </li>
          <li>
            <strong>Rotating</strong> — this quarter only. Park it when the question is answered.
          </li>
          <li>
            <strong>M·V·C</strong> — materiality, velocity, confidence, each 1–5. Pressure = M × V × (6 − C). Low
            confidence raises pressure on purpose.
          </li>
          <li>
            <strong>Value</strong> — the current reading. “NO BASELINE” means the official text specified the
            system and never measured it. That is a finding.
          </li>
          <li>
            <strong>Crossed</strong> — which pre-committed threshold the latest reading has crossed. Set it when
            you record a reading; it drives the queue.
          </li>
        </ul>
        <p>Click a row to record a reading, see thresholds and the false-positive guard, or edit the signal.</p>
      </PageGuide>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Active {bundle.metrics.active_signals}/{BUDGET.maxActiveSignals} · sentinels {bundle.metrics.sentinel_count}/
          {BUDGET.maxSentinels}. Stale means evidence is older than twice the cadence.
        </p>
        {editable ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add signal
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-2xl text-left text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Signal</th>
              <th className="px-4 py-3 font-medium">Room</th>
              <th className="px-4 py-3 font-medium">Layer</th>
              <th className="px-4 py-3 font-medium">M·V·C</th>
              <th className="px-4 py-3 font-medium">Pressure / {PRESSURE_RANGE.max}</th>
              <th className="px-4 py-3 font-medium">Value</th>
              <th className="px-4 py-3 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {bundle.signals.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-border hover:bg-muted" onClick={() => onOpen(s.id)}>
                <td className="px-4 py-3">
                  {s.name}
                  {s.status !== "active" ? <span className="ml-2 text-xs text-muted-foreground">{s.status}</span> : null}
                  {s.stale ? <span className="ml-2 text-xs text-weakening">stale</span> : null}
                  {s.crossed_level !== "none" ? <span className="ml-2 text-xs text-broken">crossed {s.crossed_level}</span> : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {categoryById(s.category).short}
                  {s.secondary_category ? ` · ${categoryById(s.secondary_category).short}` : ""}
                </td>
                <td className="px-4 py-3">{s.layer}</td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {s.materiality}·{s.velocity}·{s.confidence}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {s.pressure}
                  <span className="text-muted-foreground">/{PRESSURE_RANGE.max}</span>
                </td>
                <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{s.current_value || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{day(s.last_evidence_at ?? s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] w-[min(48rem,calc(100%-1.5rem))] overflow-y-auto">
          <DialogTitle>New signal</DialogTitle>
          <DialogDescription>A watchpoint with the readings that would justify watch, amend, refresh, or reset.</DialogDescription>
          <div className="mt-4">
            <SignalForm
              bundle={bundle}
              onSaved={() => {
                setAdding(false);
                onChanged();
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function itemKind(key: string) {
  if (key.startsWith("int-")) return "interrupt";
  if (key.startsWith("asm-")) return "assumption";
  if (key.startsWith("sig-crossed-")) return "threshold";
  if (key.startsWith("sig-stale-")) return "stale signal";
  if (key.startsWith("sig-")) return "signal";
  if (key.startsWith("cliff-")) return "cliff";
  if (key.startsWith("div-")) return "divergence";
  if (key.startsWith("room-")) return "room";
  return "";
}

function LogView({ bundle }: { bundle: StrategyBundle }) {
  return (
    <div className="space-y-4">
      <PageGuide title="What the log is">
        <p>
          Every decision logged from the queue, and every room recorded as reviewed, is written here with who
          logged it, and cannot be edited. It is the proof that the document is living: why you amended Chapter 8,
          why you did not reset after a flood season. A decision clears its queue item until the underlying
          condition changes again.
        </p>
      </PageGuide>
      {!bundle.decisions.length ? (
        <p className="text-sm text-muted-foreground">No decisions yet. The log is immutable once written.</p>
      ) : (
        <ul className="space-y-3">
          {bundle.decisions.map((d) => (
            <li key={d.id} className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{d.intensity}</Badge>
                  {d.item_key ? <span className="text-xs uppercase tracking-wider text-muted-foreground">{itemKind(d.item_key)}</span> : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {day(d.decided_at)}
                  {d.author ? ` · ${d.author}` : ""}
                </span>
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

function DetailDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-background p-6"
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
