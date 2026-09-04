import { cellReading, validityOf } from "@/lib/compute";
import { RAG_HELP, deliveryWord } from "@/lib/glossary";
import type { Assumption, DeliveryRating, StrategyBundle, Validity } from "@/lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { canEdit, day } from "./util";

type Rag = StrategyBundle["strategy"]["delivery_rag"];

const TEXT: Record<Rag, string> = {
  green: "text-holding",
  amber: "text-weakening",
  red: "text-broken",
  unrated: "text-muted-foreground",
};
const SEGMENT: Record<Assumption["status"], string> = {
  holding: "bg-holding",
  weakening: "bg-weakening",
  broken: "bg-broken",
  untested: "bg-muted-foreground/30",
};

function ragMeaning(rag: Rag) {
  return RAG_HELP.find((r) => r.id === rag)?.meaning ?? "";
}

/** Up to three bets that explain the validity colour, worst first. */
function driverBets(bundle: StrategyBundle) {
  const latestNote = (a: Assumption) => bundle.evidence.find((e) => e.assumption_id === a.id) ?? null;
  const moving = [
    ...bundle.assumptions.filter((a) => a.status === "broken"),
    ...bundle.assumptions.filter((a) => a.status === "weakening"),
  ];
  if (moving.length) {
    return moving.slice(0, 3).map((a) => ({ assumption: a, label: a.status, note: latestNote(a) }));
  }
  const holding = bundle.assumptions.filter((a) => a.status === "holding");
  if (holding.length && holding.length === bundle.assumptions.length) {
    const weakest = [...holding].sort(
      (x, y) => new Date(x.last_evidence_at ?? 0).getTime() - new Date(y.last_evidence_at ?? 0).getTime(),
    )[0]!;
    return [{ assumption: weakest, label: "weakest evidence", note: latestNote(weakest) }];
  }
  return [];
}

function ageDays(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
}

function DeliveryPanel({ rag, latest }: { rag: Rag; latest: DeliveryRating | null }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Delivery · did we do the plan?</p>
      <p className={`font-serif text-3xl leading-none ${TEXT[rag]}`}>{deliveryWord(rag)}</p>
      <p className="text-sm">{ragMeaning(rag)}</p>
      {latest ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Rated by {latest.author ?? "a member"} · {day(latest.created_at)}
            {latest.as_of ? ` · as of ${latest.as_of}` : ""}
          </p>
          {latest.source_label ? <p>{latest.source_label}</p> : null}
          <p className="text-foreground">“{latest.basis}”</p>
          {latest.source_url ? (
            <a href={latest.source_url} target="_blank" rel="noreferrer" className="block truncate text-xs hover:underline">
              {latest.source_url}
            </a>
          ) : null}
          {latest.method === "desk" ? <p className="text-xs">Proposed by a model, accepted by {latest.author ?? "a member"}.</p> : null}
          {ageDays(latest.created_at) > 180 ? (
            <p className="text-xs">Rated {ageDays(latest.created_at)} days ago. Re-rate after the next progress report.</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nobody has scored the action plan against its timetable. Rate it from the latest progress report or M&E return.
        </p>
      )}
    </div>
  );
}

function ValidityPanel({
  bundle,
  validity,
  onOpenAssumption,
}: {
  bundle: StrategyBundle;
  validity: Validity;
  onOpenAssumption: (id: number) => void;
}) {
  const drivers = driverBets(bundle);
  const latestEvidence = bundle.evidence.find((e) => e.assumption_id != null) ?? null;
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Validity · are the bets still true?</p>
      <p className={`font-serif text-3xl leading-none ${TEXT[validity.rag]}`}>{validity.label}</p>
      <p className="text-sm">{validity.meaning}</p>
      {bundle.assumptions.length ? (
        <div className="flex h-2 gap-0.5" aria-label="One segment per bet, coloured by status">
          {bundle.assumptions.map((a) => (
            <button
              key={a.id}
              type="button"
              title={`${a.status}: ${a.claim}`}
              onClick={() => onOpenAssumption(a.id)}
              className={`h-2 flex-1 rounded-sm ${SEGMENT[a.status]}`}
            />
          ))}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{validity.reason}</p>
      {bundle.assumptions.length ? (
        <p className="text-xs text-muted-foreground">
          {validity.holding} holding · {validity.weakening} weakening · {validity.broken} broken · {validity.untested} untested
          {latestEvidence ? ` · last evidence ${day(latestEvidence.created_at)}${latestEvidence.author ? ` by ${latestEvidence.author}` : ""}` : ""}
        </p>
      ) : null}
      {drivers.length ? (
        <div className="pt-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">What sets the colour</p>
          <ul className="mt-1 space-y-2">
            {drivers.map(({ assumption, label, note }) => (
              <li key={assumption.id} className="text-sm">
                <button type="button" className="text-left hover:underline" onClick={() => onOpenAssumption(assumption.id)}>
                  {assumption.claim}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  {label} · since {day(assumption.status_changed_at)}
                  {label === "broken" ? ` · pre-committed intensity: ${assumption.implied_intensity}` : ""}
                </span>
                {note ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    “{note.note.split("\n")[0]}”{note.author ? ` — ${note.author}` : ""}
                    {note.method === "desk" ? " · model-drafted" : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AssessmentCard({
  bundle,
  onAssess,
  onOpenAssumption,
  onOpenQueue,
}: {
  bundle: StrategyBundle;
  onAssess: () => void;
  onOpenAssumption: (id: number) => void;
  onOpenQueue: () => void;
}) {
  const editable = canEdit(bundle.my_role);
  const validity = validityOf(bundle.assumptions);
  const rag = bundle.strategy.delivery_rag;
  const latest = bundle.delivery_ratings[0] ?? null;
  const rated = Boolean(latest) || validity.checked > 0;
  const reading = cellReading(rag, validity);
  const divergence = bundle.queue.some((q) => q.kind === "divergence");
  const worst: Rag = rag === "red" || validity.rag === "red" ? "red" : rag === "amber" || validity.rag === "amber" ? "amber" : rag === "green" && validity.rag === "green" ? "green" : "unrated";
  const stripTone =
    worst === "red" ? "border-broken/40" : worst === "amber" ? "border-weakening/40" : worst === "green" ? "border-holding/40" : "border-border";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assessment</CardTitle>
        <CardDescription>
          Two questions, scored separately. Delivery asks whether the plan is being done. Validity asks whether the
          plan is still the right plan. A strategy can be on track and already wrong.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid gap-6 md:grid-cols-2">
          <DeliveryPanel rag={rag} latest={latest} />
          <ValidityPanel bundle={bundle} validity={validity} onOpenAssumption={onOpenAssumption} />
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${stripTone}`}>
          <span>{reading}</span>
          {divergence ? (
            <button type="button" className="text-xs underline-offset-4 hover:underline" onClick={onOpenQueue}>
              Open the queue
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {editable ? (
            <Button size="sm" onClick={onAssess}>
              {rated ? "Update assessment" : "Assess this strategy"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Only editors can rate. You are a viewer.</p>
          )}
          {!rated ? (
            <p className="text-xs text-muted-foreground">
              What to bring to the sitting: the latest progress report against the action plan, and whoever can speak to
              each bet.
            </p>
          ) : null}
        </div>
        {bundle.delivery_ratings.length > 1 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Delivery rating history ({bundle.delivery_ratings.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {bundle.delivery_ratings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={r.rag === "green" ? "holding" : r.rag === "amber" ? "weakening" : r.rag === "red" ? "broken" : "untested"}>
                    {deliveryWord(r.rag)}
                  </Badge>
                  <span>
                    {day(r.created_at)}
                    {r.as_of ? ` · as of ${r.as_of}` : ""} · {r.author ?? "a member"}
                    {r.source_label ? ` · ${r.source_label}` : ""}
                    {r.method === "desk" ? " · model-drafted" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
