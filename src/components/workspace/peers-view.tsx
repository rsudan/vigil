import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { researchPeers } from "@/lib/server/research";
import { readSessionKeys } from "@/lib/session-keys";
import { categoryGuide } from "@/lib/category-guide";
import type { StrategyBundle } from "@/lib/types";
import { PageGuide } from "../explain";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { NativeSelect } from "./shared";
import { canEdit, day } from "./util";

export function PeersView({ bundle, onDone }: { bundle: StrategyBundle; onDone: () => void }) {
  const editable = canEdit(bundle.my_role);
  const [years, setYears] = useState(5);
  const run = useMutation({
    mutationFn: () =>
      researchPeers({
        data: { strategy_id: bundle.strategy.id, recency_years: years, sessionKeys: readSessionKeys() },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Compared ${res.findings} ideas from ${res.sources} sources${res.dropped ? ` (${res.dropped} dropped for citing no source)` : ""}`,
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const research = bundle.peer_research;

  return (
    <div className="space-y-4">
      <PageGuide title="Why look at other countries">
        <p>
          A living document should not only watch its own bets. It should also ask whether a recent peer strategy
          has solved a problem this one is silent on — an event-driven revision clause, a named successor fund, a
          reach indicator for vulnerable groups. You set how recent those peers must be. The brief uses live
          search (Exa) plus your language-model key; every finding must cite one of the search results, and
          findings that do not are dropped. What comes back are ideas. Turn them into text with “Draft changes
          from the original” on the Review tab.
        </p>
      </PageGuide>
      <Card>
        <CardHeader>
          <CardTitle>Search recent peer strategies</CardTitle>
          <CardDescription>
            Domain: {bundle.strategy.domain || "not set"}. Results are limited to the recency window you pick.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="recency">How recent</Label>
            <NativeSelect id="recency" className="w-auto" value={years} onChange={(e) => setYears(Number(e.target.value))}>
              <option value={1}>Last 12 months</option>
              <option value={2}>Last 2 years</option>
              <option value={3}>Last 3 years</option>
              <option value={5}>Last 5 years</option>
              <option value={10}>Last 10 years</option>
            </NativeSelect>
          </div>
          {editable ? (
            <Button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? "Searching peers…" : "Run research brief"}
            </Button>
          ) : null}
        </CardBody>
      </Card>

      {research ? (
        <Card>
          <CardHeader>
            <CardTitle>Latest research brief</CardTitle>
            <CardDescription>
              Last {research.recency_years} years · run {day(research.created_at)}. Included in the downloaded
              analysis and revision brief as ideas, not as drafted text.
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
