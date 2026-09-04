import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { IngestForm } from "@/components/ingest-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractStrategy } from "@/lib/server/ai";
import { deliveryWord } from "@/lib/glossary";
import { readExtractPref, readSessionKeys } from "@/lib/session-keys";
import { createStrategy, deleteStrategy, listStrategies, loadRomaniaSample } from "@/lib/server/strategies";
import type { Attention } from "@/lib/types";

export const Route = createFileRoute("/app/")({ component: Portfolio });

function AttentionChips({ a }: { a: Attention }) {
  const chips: { label: string; tone: "holding" | "weakening" | "broken" | "untested" | "neutral" }[] = [];
  if (a.overdue_interrupts) chips.push({ label: `${a.overdue_interrupts} interrupt${a.overdue_interrupts > 1 ? "s" : ""} overdue`, tone: "broken" });
  else if (a.open_interrupts) chips.push({ label: `${a.open_interrupts} interrupt${a.open_interrupts > 1 ? "s" : ""} open`, tone: "weakening" });
  if (a.crossed) chips.push({ label: `${a.crossed} threshold${a.crossed > 1 ? "s" : ""} crossed`, tone: "broken" });
  if (a.broken) chips.push({ label: `${a.broken} broken`, tone: "broken" });
  if (a.weakening) chips.push({ label: `${a.weakening} weakening`, tone: "weakening" });
  if (a.stale_sentinels) chips.push({ label: `${a.stale_sentinels} stale sentinel${a.stale_sentinels > 1 ? "s" : ""}`, tone: "weakening" });
  if (a.next_cliff_days != null && a.next_cliff_days <= 180) {
    chips.push({ label: `cliff in ${a.next_cliff_days}d`, tone: a.next_cliff_days <= 90 ? "weakening" : "neutral" });
  }
  chips.push({
    label: a.queue_count ? `queue ${a.queue_count}${a.queue_overflow ? ` +${a.queue_overflow}` : ""}` : "queue empty",
    tone: a.queue_count ? "neutral" : "holding",
  });
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Badge key={c.label} tone={c.tone}>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

function Portfolio() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["strategies"], queryFn: () => listStrategies() });
  const [open, setOpen] = useState(false);
  const [ingest, setIngest] = useState(false);
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [language, setLanguage] = useState("");
  const [vision, setVision] = useState("");
  const [horizonStart, setHorizonStart] = useState("");
  const [horizonEnd, setHorizonEnd] = useState("");
  const [body, setBody] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (body.trim().length >= 200) {
        const pref = readExtractPref();
        const res = await extractStrategy({
          data: {
            title,
            domain,
            vision,
            language: language || undefined,
            horizon_start: horizonStart || undefined,
            horizon_end: horizonEnd || undefined,
            text: body,
            sessionKeys: readSessionKeys(),
            provider: pref?.provider,
            model: pref?.model,
          },
        });
        if (!res.ok) throw new Error(res.error);
        return { id: res.id };
      }
      return createStrategy({
        data: {
          title,
          domain,
          vision,
          language: language || undefined,
          horizon_start: horizonStart || undefined,
          horizon_end: horizonEnd || undefined,
        },
      });
    },
    onSuccess: (res) => {
      setOpen(false);
      setTitle("");
      setDomain("");
      setLanguage("");
      setVision("");
      setHorizonStart("");
      setHorizonEnd("");
      setBody("");
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void nav({ to: "/app/$strategyId", params: { strategyId: String(res.id) } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sample = useMutation({
    mutationFn: () => loadRomaniaSample(),
    onSuccess: (res) => {
      toast.success("Romania SNRRD 2024–2035 loaded");
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void nav({ to: "/app/$strategyId", params: { strategyId: String(res.id) } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteStrategy({ data: { id } }),
    onSuccess: () => {
      toast.success("Strategy deleted");
      void qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Strategies</h1>
          <p className="mt-1 text-sm text-muted-foreground">Each workspace watches one living document. The chips say what needs you.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>
            Load Romania sample
          </Button>
          <Button variant="secondary" onClick={() => setIngest(true)}>
            Upload a strategy
          </Button>
          <Button onClick={() => setOpen(true)}>New strategy</Button>
        </div>
      </div>

      {list.error ? <p className="text-sm text-broken">Could not load strategies: {list.error.message}</p> : null}

      {list.data?.length ? (
        <ul className="grid gap-3">
          {list.data.map((s) => (
            <li key={s.id}>
              <Card>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div>
                      <Link to="/app/$strategyId" params={{ strategyId: String(s.id) }} className="font-serif text-xl hover:underline">
                        {s.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {s.domain || "No domain"} · delivery {deliveryWord(s.delivery_rag).toLowerCase()} ·
                        validity {s.validity.label.toLowerCase()} · you are {s.my_role}
                      </p>
                    </div>
                    <AttentionChips a={s.attention} />
                  </div>
                  {s.my_role === "owner" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${s.title}”? This removes its assumptions, signals, evidence, decisions and documents for everyone it is shared with. There is no undo.`,
                          )
                        ) {
                          remove.mutate(s.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      ) : list.isPending ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nothing watched yet</CardTitle>
            <CardDescription>
              Load the Romania disaster-risk sample (12 load-bearing assumptions from the 2024–2035 SNRRD), or upload
              a PDF, Word, spreadsheet, or text file.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[min(42rem,calc(100%-1.5rem))] overflow-y-auto">
          <DialogTitle>New strategy</DialogTitle>
          <DialogDescription>
            Name the document, then type or paste as much of the strategy as you have. If you paste more than a
            couple of hundred characters, Vigil will extract the monitoring architecture. Otherwise you get a blank
            workspace to fill by hand.
          </DialogDescription>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="domain">Domain</Label>
                <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Disaster risk reduction, digital, climate…" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="language">Document language</Label>
                <Input id="language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Romanian" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="hs">Horizon start</Label>
                <Input id="hs" type="date" value={horizonStart} onChange={(e) => setHorizonStart(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="he">Horizon end</Label>
                <Input id="he" type="date" value={horizonEnd} onChange={(e) => setHorizonEnd(e.target.value)} />
              </div>
            </div>
            <Label htmlFor="vision">Vision</Label>
            <Textarea id="vision" value={vision} onChange={(e) => setVision(e.target.value)} placeholder="One paragraph on what success looks like." />
            <Label htmlFor="body">Strategy text (optional)</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Paste chapters, objectives, M&E, financing — or type notes."
              className="min-h-40"
            />
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? "Working…" : body.trim().length >= 200 ? "Create and extract architecture" : "Create blank workspace"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={ingest} onOpenChange={setIngest}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>Upload strategy</DialogTitle>
          <DialogDescription>
            PDF, Word, spreadsheet, or text — or a public URL. The whole file is stored in chunks with page numbers.
            Extraction uses the model pair on the Keys page.
          </DialogDescription>
          <div className="mt-4">
            <IngestForm
              onCreated={(id) => {
                setIngest(false);
                void qc.invalidateQueries({ queryKey: ["strategies"] });
                void nav({ to: "/app/$strategyId", params: { strategyId: String(id) } });
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
