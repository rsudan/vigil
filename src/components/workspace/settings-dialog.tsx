import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { updateStrategy } from "@/lib/server/strategies";
import type { StrategyBundle } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Field } from "./shared";

export function SettingsDialog({
  bundle,
  open,
  onOpenChange,
  onChanged,
}: {
  bundle: StrategyBundle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const s = bundle.strategy;
  const [title, setTitle] = useState(s.title);
  const [domain, setDomain] = useState(s.domain);
  const [vision, setVision] = useState(s.vision);
  const [language, setLanguage] = useState(s.language);
  const [jurisdiction, setJurisdiction] = useState(s.jurisdiction);
  const [start, setStart] = useState(s.horizon_start ?? "");
  const [end, setEnd] = useState(s.horizon_end ?? "");
  const save = useMutation({
    mutationFn: () =>
      updateStrategy({
        data: {
          id: s.id,
          title,
          domain,
          vision,
          language,
          jurisdiction,
          horizon_start: start || null,
          horizon_end: end || null,
        },
      }),
    onSuccess: () => {
      toast.success("Strategy updated");
      onChanged();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>Strategy settings</DialogTitle>
        <DialogDescription>
          The document language is the language proposed amendments are written in. The jurisdiction is whose
          strategy this is, and a room cannot search the world without it.
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <Field label="Title" htmlFor="set-title">
            <Input id="set-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Domain" htmlFor="set-domain">
              <Input id="set-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Disaster risk reduction" />
            </Field>
            <Field
              label="Jurisdiction"
              htmlFor="set-jurisdiction"
              hint="The country or organisation that adopted this strategy. A room names it when it searches the world."
            >
              <Input
                id="set-jurisdiction"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="Country or organisation"
              />
            </Field>
          </div>
          <Field label="Document language" htmlFor="set-language">
            <Input id="set-language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Romanian" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Horizon start" htmlFor="set-start">
              <Input id="set-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Horizon end" htmlFor="set-end">
              <Input id="set-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Vision" htmlFor="set-vision">
            <Textarea id="set-vision" value={vision} onChange={(e) => setVision(e.target.value)} />
          </Field>
          <Button disabled={save.isPending || !title.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
