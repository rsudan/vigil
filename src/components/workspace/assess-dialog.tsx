import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { proposeAssessment } from "@/lib/server/research";
import { assessStrategy } from "@/lib/server/strategies";
import { readSessionKeys } from "@/lib/session-keys";
import { RAG_HELP, STATUS_HELP, deliveryWord } from "@/lib/glossary";
import { DELIVERY_RAGS } from "@/lib/taxonomy";
import type { AssessmentProposal, Assumption, StrategyBundle } from "@/lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Field, NativeSelect } from "./shared";
import { day } from "./util";

type Rag = StrategyBundle["strategy"]["delivery_rag"];

type BetDraft = {
  /** The status when the dialog opened; only a change from this is sent as a status change. */
  baseline: Assumption["status"];
  status: Assumption["status"];
  note: string;
  source_url: string;
  expanded: boolean;
  fromProposal: boolean;
};

const NOTE_MIN = 10;
const BASIS_MIN = 20;

function localToday() {
  return new Date().toLocaleDateString("en-CA");
}

function freshDraft(a: Assumption): BetDraft {
  return { baseline: a.status, status: a.status, note: "", source_url: "", expanded: false, fromProposal: false };
}

export function AssessDialog({
  bundle,
  open,
  onOpenChange,
  onSaved,
}: {
  bundle: StrategyBundle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const strategyId = bundle.strategy.id;
  const latest = bundle.delivery_ratings[0] ?? null;
  const today = localToday();
  const originalRag = bundle.strategy.delivery_rag;
  const originalSource = latest?.source_label ?? "";

  const [rag, setRag] = useState<Rag>(originalRag);
  const [basis, setBasis] = useState("");
  const [sourceLabel, setSourceLabel] = useState(originalSource);
  const [sourceUrl, setSourceUrl] = useState("");
  const [asOf, setAsOf] = useState("");
  const [deliveryFromProposal, setDeliveryFromProposal] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, BetDraft>>(() =>
    Object.fromEntries(bundle.assumptions.map((a) => [a.id, freshDraft(a)])),
  );
  const [proposal, setProposal] = useState<AssessmentProposal | null>(null);
  const [noKey, setNoKey] = useState<string | null>(null);

  // A bet added by someone else while the dialog is open gets a fresh draft instead of a crash.
  const draftFor = (a: Assumption): BetDraft => drafts[a.id] ?? freshDraft(a);
  const setDraft = (a: Assumption, patch: Partial<BetDraft>) =>
    setDrafts((d) => ({ ...d, [a.id]: { ...(d[a.id] ?? freshDraft(a)), ...patch } }));

  // Delivery counts as touched by what the fields contain, not by keystrokes.
  const deliveryTouched =
    rag !== originalRag || basis.trim() !== "" || asOf !== "" || sourceUrl !== "" || sourceLabel !== originalSource;
  const statusChanged = (a: Assumption) => draftFor(a).status !== draftFor(a).baseline;
  const changedBets = bundle.assumptions.filter((a) => statusChanged(a) || draftFor(a).note.trim().length > 0);
  const missingRows = bundle.assumptions
    .map((a, i) => ({ a, row: i + 1 }))
    .filter(({ a }) => statusChanged(a) && draftFor(a).note.trim().length < NOTE_MIN)
    .map(({ row }) => row);
  const deliveryValid =
    !deliveryTouched ||
    (basis.trim().length >= BASIS_MIN && (rag === "unrated" || Boolean(asOf)) && (!asOf || asOf <= today));
  const canSave = (deliveryTouched || changedBets.length > 0) && missingRows.length === 0 && deliveryValid;

  const resetDelivery = () => {
    setRag(originalRag);
    setBasis("");
    setSourceLabel(originalSource);
    setSourceUrl("");
    setAsOf("");
    setDeliveryFromProposal(false);
  };

  const save = useMutation({
    mutationFn: () =>
      assessStrategy({
        data: {
          strategy_id: strategyId,
          delivery: deliveryTouched
            ? {
                rag,
                basis,
                source_label: sourceLabel || undefined,
                source_url: sourceUrl || undefined,
                as_of: asOf || undefined,
                method: deliveryFromProposal ? "desk" : "person",
              }
            : undefined,
          bets: changedBets.length
            ? changedBets.map((a) => {
                const d = draftFor(a);
                return {
                  id: a.id,
                  status: statusChanged(a) ? d.status : undefined,
                  note: d.note,
                  source_url: d.source_url || undefined,
                  method: d.fromProposal ? ("desk" as const) : ("person" as const),
                };
              })
            : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Assessment saved · delivery ${deliveryWord(res.delivery_rag).toLowerCase()} · validity ${res.validity.label.toLowerCase()}${
          res.validity.weakening ? ` (${res.validity.weakening} weakening)` : ""
        }`,
      );
      onSaved();
      onOpenChange(false);
    },
    // Drafts stay intact on an error so a long sitting is not lost.
    onError: (e: Error) => toast.error(e.message),
  });

  const propose = useMutation({
    mutationFn: () => proposeAssessment({ data: { strategy_id: strategyId, sessionKeys: readSessionKeys() } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNoKey(res.error);
        return;
      }
      setNoKey(null);
      setProposal(res.proposal);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposalFor = (id: number) => proposal?.bets.find((b) => b.assumption_id === id) ?? null;

  const acceptBet = (a: Assumption, accept: boolean) => {
    const p = proposalFor(a.id);
    if (accept && p) {
      setDraft(a, { status: p.status, note: p.note || p.settles_it, expanded: true, fromProposal: true });
    } else {
      setDraft(a, { status: draftFor(a).baseline, note: "", fromProposal: false });
    }
  };

  const acceptDelivery = (accept: boolean) => {
    const p = proposal?.delivery;
    if (accept && p && p.rag !== "unrated") {
      setRag(p.rag);
      setBasis(p.basis);
      setSourceLabel(p.source_label);
      setDeliveryFromProposal(true);
    } else {
      resetDelivery();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(56rem,calc(100%-1.5rem))] overflow-y-auto">
        <DialogTitle>Assess this strategy</DialogTitle>
        <DialogDescription>
          Rate delivery from a report, and check the bets with evidence. Everything is saved with your name, the date
          and the basis you write. Nothing is rated without a basis.
        </DialogDescription>

        <section className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Propose from what is on file</p>
              <p className="text-xs text-muted-foreground">
                Reads the stored document, the readings and the evidence already recorded, and fills in a proposal for
                each row. Proposals are marked and stay unsaved until you accept them.
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={propose.isPending} onClick={() => propose.mutate()}>
              {propose.isPending ? "Reading the document and the evidence on file…" : "Propose from what is on file"}
            </Button>
          </div>
          {noKey ? <p className="mt-2 text-xs text-muted-foreground">{noKey}</p> : null}
          {proposal ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {proposal.bets.length} proposal{proposal.bets.length === 1 ? "" : "s"}. {proposal.grounded} rest on recorded
              evidence; {proposal.desk_only} rest on the document alone and are marked untested with what would settle
              them. Accept the rows you agree with.
              {!proposal.progress_on_file
                ? " No quotable statement of progress is on file, so delivery is not proposed; rate it by hand from the latest report."
                : ""}
            </p>
          ) : null}
        </section>

        <section className="mt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">1. Delivery · did we do the plan?</h3>
            {deliveryTouched ? (
              <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={resetDelivery}>
                Leave delivery as it is
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            The colour of the action plan against its published timetable. Ordinary M&E: bring the number from the latest
            report.
            {latest
              ? ` Currently ${deliveryWord(latest.rag).toLowerCase()} · rated ${day(latest.created_at)} by ${latest.author ?? "a member"}.`
              : " Currently not rated."}
          </p>
          {proposal?.delivery && proposal.delivery.rag !== "unrated" ? (
            <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
              <input type="checkbox" className="mt-0.5 size-4" checked={deliveryFromProposal} onChange={(e) => acceptDelivery(e.target.checked)} />
              <span>
                <Badge>Proposed</Badge> {deliveryWord(proposal.delivery.rag)} — “{proposal.delivery.basis}”
                {proposal.delivery.rests_on ? ` Rests on: ${proposal.delivery.rests_on}.` : ""}
                {proposal.delivery.excerpt ? ` Quoted: “${proposal.delivery.excerpt}”` : ""}{" "}
                <span className="text-muted-foreground">Accept</span>
              </span>
            </label>
          ) : null}
          <fieldset className="grid gap-2 sm:grid-cols-2">
            {DELIVERY_RAGS.map((r) => (
              <label key={r} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                <input type="radio" name="delivery-rag" value={r} className="mt-1" checked={rag === r} onChange={() => setRag(r)} />
                <span>
                  <span className="font-medium">{deliveryWord(r)}</span> — {RAG_HELP.find((h) => h.id === r)?.meaning}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source of the score" htmlFor="del-source">
              <Input
                id="del-source"
                value={sourceLabel}
                onChange={(e) => setSourceLabel(e.target.value)}
                placeholder="Annual progress report 2025, Ministry of Youth, p. 31"
              />
            </Field>
            <Field label="As of" htmlFor="del-asof" hint="The period the report covers, not today.">
              <Input id="del-asof" type="date" max={today} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
          </div>
          <Field label="Basis (required when delivery changes)" htmlFor="del-basis">
            <Textarea
              id="del-basis"
              className="min-h-16"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="Which report, which annex, which count. e.g. 2025 progress report: 14 of 41 Annex 1 actions delivered on time."
            />
          </Field>
          <Field label="Source URL" htmlFor="del-url">
            <Input id="del-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
          </Field>
          {deliveryTouched && !deliveryValid ? (
            <p className="text-xs text-broken">
              {basis.trim().length < BASIS_MIN
                ? "Write what the report says (at least twenty characters)."
                : !asOf
                  ? "Give the as-of date of the report the rating rests on."
                  : "The as-of date cannot be in the future."}
            </p>
          ) : null}
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="font-medium">2. Validity · are the bets still true?</h3>
          <p className="text-xs text-muted-foreground">
            One row per load-bearing assumption. Change a status only with evidence. Leave a row alone if you have not
            looked; untested is honest.
          </p>
          {bundle.assumptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bets named yet. Add them on the Assumptions tab first.</p>
          ) : null}
          <ul className="space-y-2">
            {bundle.assumptions.map((a, i) => {
              const d = draftFor(a);
              const p = proposalFor(a.id);
              const changed = statusChanged(a);
              const noteShort = changed && d.note.trim().length < NOTE_MIN;
              const linked = bundle.signals.filter((s) => a.linked_signal_ids.includes(s.id) && s.status === "active");
              const notes = bundle.evidence.filter((e) => e.assumption_id === a.id).slice(0, 2);
              const collapsible = d.expanded && !changed && !d.note.trim();
              return (
                <li key={a.id} data-bet-row className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="text-xs text-muted-foreground">{i + 1}.</span> {a.claim}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Now: {d.baseline} (since {day(a.status_changed_at)})
                        {changed ? ` → ${d.status}` : ""}
                      </p>
                    </div>
                    {!d.expanded ? (
                      <Button size="sm" variant="outline" onClick={() => setDraft(a, { expanded: true })}>
                        Change
                      </Button>
                    ) : collapsible ? (
                      <Button size="sm" variant="ghost" onClick={() => setDraft(a, { expanded: false })}>
                        Collapse
                      </Button>
                    ) : null}
                  </div>
                  {p ? (
                    <label className="mt-2 flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                      <input type="checkbox" className="mt-0.5 size-4" checked={d.fromProposal} onChange={(e) => acceptBet(a, e.target.checked)} />
                      <span>
                        <Badge>Proposed</Badge> {p.status}
                        {p.note ? ` — “${p.note}”` : ""}
                        {p.status === "untested" && p.settles_it ? ` Would settle it: ${p.settles_it}` : ""}
                        {p.rests_on ? ` Rests on: ${p.rests_on}.` : ""}
                        {p.excerpt_verified === false ? (
                          <Badge tone="broken" className="ml-1">
                            quote not found in stored text
                          </Badge>
                        ) : null}{" "}
                        <span className="text-muted-foreground">Accept</span>
                      </span>
                    </label>
                  ) : null}
                  {d.expanded ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
                      <div className="space-y-3">
                        <Field label="Status" htmlFor={`bet-${a.id}-status`}>
                          <NativeSelect
                            id={`bet-${a.id}-status`}
                            value={d.status}
                            onChange={(e) => setDraft(a, { status: e.target.value as Assumption["status"] })}
                          >
                            {STATUS_HELP.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.id} — {s.meaning}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <Field
                          label={changed ? "Evidence for the change (required)" : "Evidence note (optional)"}
                          htmlFor={`bet-${a.id}-note`}
                        >
                          <Textarea
                            id={`bet-${a.id}-note`}
                            className="min-h-16"
                            value={d.note}
                            onChange={(e) => setDraft(a, { note: e.target.value })}
                            placeholder={
                              d.status === "untested"
                                ? "What would test it, and who brings that to the next sitting?"
                                : "What was observed, by whom, and where it is written down."
                            }
                          />
                        </Field>
                        {noteShort ? <p className="text-xs text-broken">Write at least ten characters of evidence for this change.</p> : null}
                        <Field label="Source URL" htmlFor={`bet-${a.id}-url`}>
                          <Input
                            id={`bet-${a.id}-url`}
                            value={d.source_url}
                            onChange={(e) => setDraft(a, { source_url: e.target.value })}
                            placeholder="https://"
                          />
                        </Field>
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p className="uppercase tracking-wider">What is on file</p>
                        {linked.length ? (
                          <ul className="space-y-1">
                            {linked.map((s) => (
                              <li key={s.id}>
                                {s.name}: {s.current_value || "no reading"}
                                {s.crossed_level !== "none" ? ` · crossed ${s.crossed_level}` : ""}
                                {s.last_evidence_at ? ` · ${day(s.last_evidence_at)}` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No linked reading.</p>
                        )}
                        {notes.length ? (
                          <ul className="space-y-1">
                            {notes.map((e) => (
                              <li key={e.id}>
                                {day(e.created_at)}
                                {e.author ? ` · ${e.author}` : ""} · {e.direction}: “{e.note}”
                                {e.method === "desk" ? " (model-drafted)" : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>Nothing on file yet. The extraction named this bet; nobody has checked it.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {changedBets.length} of {bundle.assumptions.length} bets changed
            {missingRows.length ? ` · evidence missing on row${missingRows.length === 1 ? "" : "s"} ${missingRows.join(", ")}` : ""}
            {deliveryTouched ? " · delivery rating changed" : ""}
            {!canSave && (deliveryTouched || changedBets.length) ? " · write the basis for every changed rating before saving" : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
              Save assessment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
