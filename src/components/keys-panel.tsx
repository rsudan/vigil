import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deletePersonalKey,
  getExtractPreference,
  listKeyStatus,
  platformKeyPolicy,
  refreshModels,
  savePersonalKey,
  setExtractPreference,
  setSelectedModel,
  testApiKey,
} from "@/lib/server/keys";
import { LLM_PROVIDERS, PROVIDERS, isLlmProvider, type ProviderId } from "@/lib/taxonomy";
import {
  readExtractPref,
  readSessionKeys,
  readSessionModels,
  writeExtractPref,
  writeSessionKeys,
  writeSessionModels,
} from "@/lib/session-keys";
import { Button } from "./ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

function emptyDraft() {
  return Object.fromEntries(PROVIDERS.map((p) => [p.id, ""])) as Record<ProviderId, string>;
}

export function KeysPanel() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["keys"], queryFn: () => listKeyStatus() });
  const pref = useQuery({ queryKey: ["extract-pref"], queryFn: () => getExtractPreference() });
  const policy = useQuery({ queryKey: ["platform-policy"], queryFn: () => platformKeyPolicy() });
  const [draft, setDraft] = useState(emptyDraft);
  const [session, setSession] = useState(readSessionKeys);
  const [sessionModels, setSessionModels] = useState(readSessionModels);
  const [modelLists, setModelLists] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [extractProvider, setExtractProvider] = useState<ProviderId>(
    () => readExtractPref()?.provider ?? "xai",
  );
  const [extractModel, setExtractModel] = useState(
    () => readExtractPref()?.model ?? "grok-4-fast",
  );

  const save = useMutation({
    mutationFn: (p: ProviderId) =>
      savePersonalKey({
        data: { provider: p, secret: draft[p], selected_model: sessionModels[p] },
      }),
    onSuccess: (_, p) => {
      toast.success(`${p} key saved to your account`);
      setDraft((d) => ({ ...d, [p]: "" }));
      void qc.invalidateQueries({ queryKey: ["keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (p: ProviderId) => deletePersonalKey({ data: { provider: p } }),
    onSuccess: () => {
      toast.success("Key removed");
      void qc.invalidateQueries({ queryKey: ["keys"] });
    },
  });

  function persistSession(p: ProviderId, value: string) {
    const next = { ...session, [p]: value };
    setSession(next);
    writeSessionKeys(next);
  }

  function persistModel(p: ProviderId, model: string) {
    const next = { ...sessionModels, [p]: model };
    setSessionModels(next);
    writeSessionModels(next);
    if (status.data?.find((s) => s.provider === p)?.source === "personal") {
      void setSelectedModel({ data: { provider: p, model } });
    }
  }

  const test = useMutation({
    mutationFn: (p: ProviderId) =>
      testApiKey({
        data: { provider: p, secret: draft[p] || session[p], sessionKeys: session },
      }),
    onSuccess: (res, p) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.detail);
      if (res.models.length) {
        setModelLists((m) => ({ ...m, [p]: res.models }));
        if (!sessionModels[p] && res.models[0]) persistModel(p, res.models[0]);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refresh = useMutation({
    mutationFn: (p: ProviderId) =>
      refreshModels({
        data: { provider: p, secret: draft[p] || session[p], sessionKeys: session },
      }),
    onSuccess: (res, p) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setModelLists((m) => ({ ...m, [p]: res.models }));
      toast.success(`${res.models.length} models`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groups = useMemo(
    () => [
      { title: "Language models", items: PROVIDERS.filter((p) => p.kind === "llm") },
      { title: "Search and reader", items: PROVIDERS.filter((p) => p.kind !== "llm") },
    ],
    [],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Bring your own keys</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Save a key to your account (Persist), keep it for this tab only, or inherit an organisation grant.
          Saved keys are encrypted at rest. Test each key before you rely on it. For language-model providers,
          refresh the model list and pick which model extracts the architecture.
        </p>
        {policy.data ? (
          <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
            {policy.data.configured.length
              ? `Keys set in the server environment: ${policy.data.configured.join(", ")}. `
              : "No keys are set in the server environment. "}
            {policy.data.policy === "all"
              ? "Every signed-in user may spend them."
              : policy.data.policy === "none"
                ? "They are switched off."
                : "Only administrators may spend them."}
            {policy.data.configured.length
              ? policy.data.allowed_for_me
                ? " They are used when you have not provided your own."
                : " They are not available to your account; bring your own."
              : ""}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Model used for extraction</CardTitle>
          <CardDescription>
            Upload and “extract architecture” call this pair. Saved to your account when you confirm.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="extract-provider">Provider</Label>
            <select
              id="extract-provider"
              className="h-10 rounded-sm border border-border bg-background px-2 text-sm"
              value={extractProvider}
              onChange={(e) => {
                const p = e.target.value as ProviderId;
                setExtractProvider(p);
                const fallback =
                  sessionModels[p] ||
                  status.data?.find((s) => s.provider === p)?.selected_model ||
                  LLM_PROVIDERS.find((x) => x.id === p)?.defaultModel ||
                  "";
                setExtractModel(fallback);
              }}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid flex-1 gap-2">
            <Label htmlFor="extract-model">Model</Label>
            <Input
              id="extract-model"
              value={extractModel}
              onChange={(e) => setExtractModel(e.target.value)}
              list="extract-model-list"
            />
            <datalist id="extract-model-list">
              {(modelLists[extractProvider] ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <Button
            type="button"
            onClick={() => {
              writeExtractPref(extractProvider, extractModel);
              void setExtractPreference({ data: { provider: extractProvider, model: extractModel } }).then(
                () => {
                  toast.success("Extraction model saved");
                  void qc.invalidateQueries({ queryKey: ["extract-pref"] });
                },
              );
            }}
          >
            Use this pair
          </Button>
        </CardBody>
        {pref.data ? (
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            Currently {pref.data.provider} / {pref.data.model}
          </p>
        ) : null}
      </Card>

      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="font-serif text-xl">{g.title}</h2>
          <div className="grid gap-4">
            {g.items.map((p) => {
              const st = status.data?.find((s) => s.provider === p.id);
              const models = modelLists[p.id] ?? [];
              const selected = sessionModels[p.id] || st?.selected_model || "";
              return (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle>{p.name}</CardTitle>
                    <CardDescription>{p.hint}</CardDescription>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <p className="text-sm">
                      {st?.configured ? (
                        <>
                          Active via <span className="font-medium">{st.source}</span>
                          {st.last_four ? ` · ends ${st.last_four}` : null}
                          {st.label ? ` · ${st.label}` : null}
                        </>
                      ) : (
                        "No saved key"
                      )}
                    </p>
                    <div className="grid gap-2">
                      <Label htmlFor={`save-${p.id}`}>Save to my account</Label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id={`save-${p.id}`}
                          type="password"
                          autoComplete="off"
                          placeholder={`${p.name} API key`}
                          value={draft[p.id]}
                          onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        />
                        <Button
                          type="button"
                          disabled={!draft[p.id] || save.isPending}
                          onClick={() => save.mutate(p.id)}
                        >
                          Persist
                        </Button>
                        {st?.source === "personal" ? (
                          <Button type="button" variant="outline" onClick={() => remove.mutate(p.id)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`sess-${p.id}`}>Session only (not stored)</Label>
                      <Input
                        id={`sess-${p.id}`}
                        type="password"
                        autoComplete="off"
                        placeholder="Used for this browser tab"
                        value={session[p.id] ?? ""}
                        onChange={(e) => persistSession(p.id, e.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={test.isPending}
                        onClick={() => test.mutate(p.id)}
                      >
                        Test key
                      </Button>
                      {isLlmProvider(p.id) ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={refresh.isPending}
                          onClick={() => refresh.mutate(p.id)}
                        >
                          Refresh models
                        </Button>
                      ) : null}
                    </div>
                    {isLlmProvider(p.id) ? (
                      <div className="grid gap-2">
                        <Label htmlFor={`model-${p.id}`}>Model</Label>
                        {models.length ? (
                          <select
                            id={`model-${p.id}`}
                            className="h-10 rounded-sm border border-border bg-background px-2 text-sm"
                            value={selected}
                            onChange={(e) => persistModel(p.id, e.target.value)}
                          >
                            {models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={`model-${p.id}`}
                            placeholder={p.defaultModel ?? "model-id"}
                            value={selected}
                            onChange={(e) => persistModel(p.id, e.target.value)}
                          />
                        )}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
