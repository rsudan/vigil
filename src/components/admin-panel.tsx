import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listMembers, setMemberRole } from "@/lib/server/profiles";
import { deleteOrgKey, listOrgKeys, saveOrgKey, setOrgKeyGrants } from "@/lib/server/keys";
import { PROVIDERS, type ProviderId } from "@/lib/taxonomy";
import { Button } from "./ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AdminPanel() {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["members"], queryFn: () => listMembers() });
  const orgKeys = useQuery({ queryKey: ["org-keys"], queryFn: () => listOrgKeys() });
  const [draft, setDraft] = useState<Record<ProviderId, string>>(
    () => Object.fromEntries(PROVIDERS.map((p) => [p.id, ""])) as Record<ProviderId, string>,
  );

  const save = useMutation({
    mutationFn: (p: ProviderId) => saveOrgKey({ data: { provider: p, secret: draft[p], label: "Organisation" } }),
    onSuccess: (_, p) => {
      toast.success(`Organisation ${p} key stored`);
      setDraft((d) => ({ ...d, [p]: "" }));
      void qc.invalidateQueries({ queryKey: ["org-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grant = useMutation({
    mutationFn: (input: { credential_id: number; grantee_user_ids: string[] }) =>
      setOrgKeyGrants({ data: input }),
    onSuccess: () => {
      toast.success("Grants updated");
      void qc.invalidateQueries({ queryKey: ["org-keys"] });
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Administrator</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Persist organisation keys and grant them to named users. Everyone else brings their own.
          The first account on this instance is administrator.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">Organisation keys</h2>
        {PROVIDERS.map((p) => {
          const existing = orgKeys.data?.find((k) => k.provider === p.id);
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>
                  {existing ? `Stored · ends ${existing.last_four}` : "Not stored"}
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    placeholder={`Organisation ${p.name} key`}
                    value={draft[p.id]}
                    onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                  <Button disabled={!draft[p.id]} onClick={() => save.mutate(p.id)}>
                    Persist
                  </Button>
                  {existing ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        deleteOrgKey({ data: { credential_id: existing.id } }).then(() =>
                          qc.invalidateQueries({ queryKey: ["org-keys"] }),
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                {existing && members.data ? (
                  <div>
                    <Label>Grant to users</Label>
                    <ul className="mt-2 space-y-2">
                      {members.data.map((m) => {
                        const checked = existing.grantees.includes(m.user_id);
                        return (
                          <li key={m.user_id} className="flex items-center gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...existing.grantees, m.user_id]
                                  : existing.grantees.filter((id) => id !== m.user_id);
                                grant.mutate({ credential_id: existing.id, grantee_user_ids: next });
                              }}
                            />
                            <span className="font-mono text-xs">{m.email || m.display_name || m.user_id}</span>
                            <span className="text-muted-foreground">{m.role}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">Members</h2>
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {(members.data ?? []).map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm">{m.display_name || m.email || "Signed-in user"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{m.user_id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">{m.role}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setMemberRole({
                          data: { user_id: m.user_id, role: m.role === "admin" ? "member" : "admin" },
                        })
                          .then(() => qc.invalidateQueries({ queryKey: ["members"] }))
                          .catch((e: Error) => toast.error(e.message))
                      }
                    >
                      {m.role === "admin" ? "Make member" : "Make admin"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
