import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { logDecision } from "@/lib/server/strategies";
import { BUDGET } from "@/lib/taxonomy";
import type { Intensity, QueueItem, StrategyBundle } from "@/lib/types";
import { IntensityLegend, PageGuide } from "../explain";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { canEdit } from "./util";

export function QueueView({
  bundle,
  onLogged,
}: {
  bundle: StrategyBundle;
  onLogged: () => void;
}) {
  const m = bundle.metrics;
  const editable = canEdit(bundle.my_role);
  return (
    <div className="space-y-3">
      <PageGuide title="What the queue is — and what you must do">
        <p>
          The queue is a ranked triage list of at most {BUDGET.maxQueue} items the monitor thinks you must decide{" "}
          <em>now</em>. It is not a to-do list you invent. An item appears when:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>an interrupt (red line) has been fired, first of all if its review deadline has passed</li>
          <li>a signal reading has crossed one of its pre-committed thresholds</li>
          <li>a load-bearing assumption is broken or weakening</li>
          <li>a cliff is fewer than 180 days away, or has passed</li>
          <li>delivery is scored green while the logic is weakening (the dangerous cell)</li>
          <li>a sentinel is in the top quarter of pressure, or its evidence is stale</li>
        </ul>
        <p>
          For each card: read the reason, type a rationale (required), pick an intensity, log the decision.
          Logging <strong>no change</strong> is a decision. A logged decision clears the card until its condition
          changes again.
        </p>
        <IntensityLegend />
      </PageGuide>
      {m.queue_overflow || m.queue_suppressed ? (
        <p className="text-sm text-muted-foreground">
          {m.queue_overflow
            ? `${m.queue_overflow} more item${m.queue_overflow > 1 ? "s" : ""} ranked below the cut of ${BUDGET.maxQueue}; clear these to see them. `
            : ""}
          {m.queue_suppressed
            ? `${m.queue_suppressed} item${m.queue_suppressed > 1 ? "s are" : " is"} hidden by a logged decision.`
            : ""}
        </p>
      ) : null}
      {bundle.queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Queue is empty. Log “no change” in Review if you checked and nothing moved.
        </p>
      ) : (
        bundle.queue.map((item, i) => (
          <QueueCard
            key={item.id}
            position={i + 1}
            item={item}
            strategyId={bundle.strategy.id}
            editable={editable}
            onLogged={onLogged}
          />
        ))
      )}
    </div>
  );
}

const INTENSITY_CHOICES: Intensity[] = ["watch", "amend", "refresh", "reset", "no-change"];

export function QueueCard({
  item,
  position,
  strategyId,
  editable,
  onLogged,
}: {
  item: QueueItem;
  position: number;
  strategyId: number;
  editable: boolean;
  onLogged: () => void;
}) {
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
          item_key: item.id,
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">#{position}</span>
          <CardTitle className="text-base">{item.title}</CardTitle>
          {item.overdue ? <Badge tone="broken">overdue</Badge> : null}
        </div>
        <CardDescription>
          {item.kind} · suggested {item.intensity_hint}
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm">{item.reason}</p>
        {editable ? (
          <>
            <Label>Rationale (required)</Label>
            <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-20" />
            <div className="flex flex-wrap gap-2">
              {INTENSITY_CHOICES.map((i) => (
                <Button key={i} size="sm" variant={intensity === i ? "default" : "outline"} onClick={() => setIntensity(i)}>
                  {i}
                </Button>
              ))}
              <Button className="ml-auto" disabled={!rationale.trim() || log.isPending} onClick={() => log.mutate()}>
                Log decision
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Read-only access: an editor logs the decision.</p>
        )}
      </CardBody>
    </Card>
  );
}
