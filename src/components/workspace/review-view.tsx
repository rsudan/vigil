import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { draftAmendments } from "@/lib/server/research";
import {
  addCliff,
  addInterrupt,
  closeInterrupt,
  deleteCliff,
  deleteInterrupt,
  fireInterrupt,
  rearmInterrupt,
  setInterruptRoom,
} from "@/lib/server/strategies";
import { readSessionKeys } from "@/lib/session-keys";
import { CATEGORIES, CLIFF_KINDS, CLIFF_ROOM, INTERRUPT_DEFAULT_ROOM, categoryById, roomOfInterrupt } from "@/lib/taxonomy";
import type { Amendment, Cliff, StrategyBundle } from "@/lib/types";
import { GlossaryStrip, PageGuide } from "../explain";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { QueueView } from "./queue-view";
import { Field, NativeSelect } from "./shared";
import { canEdit, day } from "./util";

export function ReviewView({ bundle, onChanged }: { bundle: StrategyBundle; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <PageGuide title="How a 45-minute review sitting works">
        <p>
          This is the ritual that makes the document living. Silence is a failure — if you looked and nothing
          moved, log <strong>no change</strong>.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Interrupts and cliffs (5 min).</strong> Fire a red line if the event happened; you then have 30
            days to review. Close it once the decision is logged. Remove a cliff once it has been dealt with.
          </li>
          <li>
            <strong>Queue (30 min).</strong> One card at a time, in rank order. Rationale required. Prefer amend
            over refresh unless a crossed threshold or the pre-committed “if broken” intensity says otherwise.
          </li>
          <li>
            <strong>Commitments (10 min).</strong> Draft the actual words that go back into the original document
            (below). Then download the revision brief — it quotes the original and writes the replacement.
          </li>
        </ol>
        <GlossaryStrip ids={["interrupt", "crossed", "queue", "cliff"]} />
      </PageGuide>
      <InterruptsCard bundle={bundle} onChanged={onChanged} />
      <CliffsCard bundle={bundle} onChanged={onChanged} />
      <QueueView bundle={bundle} onLogged={onChanged} />
      <AmendmentDraft bundle={bundle} onDone={onChanged} />
    </div>
  );
}

function InterruptsCard({ bundle, onChanged }: { bundle: StrategyBundle; onChanged: () => void }) {
  const editable = canEdit(bundle.my_role);
  const strategyId = bundle.strategy.id;
  const [name, setName] = useState("");
  const [redLine, setRedLine] = useState("");
  const [room, setRoom] = useState<number>(INTERRUPT_DEFAULT_ROOM);
  const onError = (e: Error) => toast.error(e.message);
  const place = useMutation({
    mutationFn: (v: { id: number; category: number | null }) => setInterruptRoom({ data: { strategy_id: strategyId, ...v } }),
    onSuccess: () => {
      toast.success("Room set");
      onChanged();
    },
    onError,
  });
  const fire = useMutation({
    mutationFn: (id: number) => fireInterrupt({ data: { id, strategy_id: strategyId } }),
    onSuccess: () => {
      toast.success("Interrupt fired · review in 30 days");
      onChanged();
    },
    onError,
  });
  const close = useMutation({
    mutationFn: (id: number) => closeInterrupt({ data: { id, strategy_id: strategyId } }),
    onSuccess: () => {
      toast.success("Interrupt closed");
      onChanged();
    },
    onError,
  });
  const rearm = useMutation({
    mutationFn: (id: number) => rearmInterrupt({ data: { id, strategy_id: strategyId } }),
    onSuccess: onChanged,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteInterrupt({ data: { id, strategy_id: strategyId } }),
    onSuccess: onChanged,
    onError,
  });
  const add = useMutation({
    mutationFn: () => addInterrupt({ data: { strategy_id: strategyId, name, red_line: redLine, category: room } }),
    onSuccess: () => {
      toast.success("Red line armed");
      setName("");
      setRedLine("");
      onChanged();
    },
    onError,
  });
  const now = Date.now();
  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Interrupts — red lines</CardTitle>
        <CardDescription>
          Agreed in advance. Fire when the event happens; close when the decision is logged. Each red line sits in
          one of the ten rooms; one with no room reads as Risks.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {bundle.interrupts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No red lines yet. A disaster will be treated as weather.</p>
        ) : null}
        {bundle.interrupts.map((i) => {
          const overdue = i.status === "open" && i.review_by && new Date(i.review_by).getTime() < now;
          return (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.red_line}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider">
                  <span>{i.status}</span>
                  {i.status === "open" ? (
                    <span className={overdue ? "text-broken" : "text-weakening"}>
                      review by {day(i.review_by)}
                      {overdue ? " · overdue" : ""}
                    </span>
                  ) : null}
                  {editable ? (
                    <label className="flex items-center gap-1 normal-case tracking-normal">
                      <span className="text-muted-foreground">Room</span>
                      <NativeSelect
                        aria-label={`Room for ${i.name}`}
                        className="h-7 w-auto text-xs"
                        value={i.category ?? ""}
                        disabled={place.isPending}
                        onChange={(e) => place.mutate({ id: i.id, category: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">not set · reads as Risks</option>
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.id}. {c.short}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  ) : (
                    <span className="text-muted-foreground">
                      room · {categoryById(roomOfInterrupt(i)).short}
                      {i.category == null ? " (not set)" : ""}
                    </span>
                  )}
                </div>
              </div>
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  {i.status === "armed" ? (
                    <Button size="sm" variant="outline" disabled={fire.isPending} onClick={() => fire.mutate(i.id)}>
                      Fire
                    </Button>
                  ) : null}
                  {i.status === "open" ? (
                    <Button size="sm" variant="outline" disabled={close.isPending} onClick={() => close.mutate(i.id)}>
                      Close
                    </Button>
                  ) : null}
                  {i.status === "closed" ? (
                    <Button size="sm" variant="outline" disabled={rearm.isPending} onClick={() => rearm.mutate(i.id)}>
                      Re-arm
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete the red line “${i.name}”?`)) remove.mutate(i.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {editable ? (
          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
            <Field label="New red line" htmlFor="int-name">
              <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Major loss event" />
            </Field>
            <Field label="Trigger" htmlFor="int-line">
              <Input
                id="int-line"
                value={redLine}
                onChange={(e) => setRedLine(e.target.value)}
                placeholder="Direct damages ≥ 0.5% of GDP, or the platform dark for 14 days"
              />
            </Field>
            <Field label="Room" htmlFor="int-room">
              <NativeSelect id="int-room" value={room} onChange={(e) => setRoom(Number(e.target.value))}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}. {c.short}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button size="sm" disabled={add.isPending || !name.trim() || !redLine.trim()} onClick={() => add.mutate()}>
              Arm
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function CliffsCard({ bundle, onChanged }: { bundle: StrategyBundle; onChanged: () => void }) {
  const editable = canEdit(bundle.my_role);
  const strategyId = bundle.strategy.id;
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<Cliff["kind"]>("fiscal");
  const onError = (e: Error) => toast.error(e.message);
  const add = useMutation({
    mutationFn: () => addCliff({ data: { strategy_id: strategyId, name, cliff_date: date, kind } }),
    onSuccess: () => {
      toast.success("Cliff added");
      setName("");
      setDate("");
      onChanged();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteCliff({ data: { id, strategy_id: strategyId } }),
    onSuccess: onChanged,
    onError,
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Cliffs — dated events</CardTitle>
        <CardDescription>
          A funding sunset, a legal deadline, a rewrite window. A cliff sits in the room its kind names. Remove a
          cliff once it has been dealt with.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {bundle.cliffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dated events named. The fiscal cliff will arrive whether or not you named it.</p>
        ) : null}
        {bundle.cliffs.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
            <div>
              <span>{c.name}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {c.cliff_date} · {c.kind}
                {c.cliff_date < today ? " · passed" : ""}
              </span>
            </div>
            {editable ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Remove the cliff “${c.name}”?`)) remove.mutate(c.id);
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <Field label="New cliff" htmlFor="cliff-name">
              <Input id="cliff-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Funding sunset" />
            </Field>
            <Field label="Date" htmlFor="cliff-date">
              <Input id="cliff-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Kind" htmlFor="cliff-kind">
              <NativeSelect id="cliff-kind" value={kind} onChange={(e) => setKind(e.target.value as Cliff["kind"])}>
                {CLIFF_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k} · {categoryById(CLIFF_ROOM[k]).short}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button size="sm" disabled={add.isPending || !name.trim() || !date} onClick={() => add.mutate()}>
              Add
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function AmendmentList({ amendments }: { amendments: Amendment[] }) {
  if (!amendments.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No drafted changes yet. Use “Draft changes from the original” to quote the document and write replacements.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {amendments.map((a) => (
        <li key={a.id} className="rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{a.intensity}</Badge>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {a.source === "peer" ? "from a peer idea" : "from the monitor"}
            </span>
            {a.excerpt_verified === true ? <Badge tone="holding">quote verified</Badge> : null}
            {a.excerpt_verified === false ? <Badge tone="broken">quote not found in text</Badge> : null}
          </div>
          <p className="mt-2 text-sm font-medium">{a.location}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Original</p>
              <p className="mt-1 text-sm text-muted-foreground">{a.original_excerpt || "Not in the original text."}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Proposed text</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{a.proposed_text}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{a.rationale}</p>
        </li>
      ))}
    </ul>
  );
}

function AmendmentDraft({ bundle, onDone }: { bundle: StrategyBundle; onDone: () => void }) {
  const editable = canEdit(bundle.my_role);
  const draft = useMutation({
    mutationFn: () => draftAmendments({ data: { strategy_id: bundle.strategy.id, sessionKeys: readSessionKeys() } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${res.count} changes drafted${res.unverified ? `, ${res.unverified} with a quotation not found in the text` : ""}`,
      );
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
          replace it. The drafter reads the passages that match what has moved, wherever they sit in the
          document, and every quotation is checked against the stored text. Re-draft after a sitting or after
          peer research; peer ideas are offered to the drafter, never copied in as text.
          {bundle.strategy.language ? ` Proposed text is written in ${bundle.strategy.language}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {editable ? (
          <Button type="button" disabled={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? "Drafting against the original…" : "Draft changes from the original"}
          </Button>
        ) : null}
        <AmendmentList amendments={bundle.amendments ?? []} />
      </CardBody>
    </Card>
  );
}
