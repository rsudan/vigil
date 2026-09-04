import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { addStrategyMember, removeStrategyMember } from "@/lib/server/strategies";
import type { StrategyBundle } from "@/lib/types";
import { PageGuide } from "../explain";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Field, NativeSelect } from "./shared";

export function TeamView({ bundle, onChanged }: { bundle: StrategyBundle; onChanged: () => void }) {
  const me = useCurrentUser();
  const isOwner = bundle.my_role === "owner";
  const strategyId = bundle.strategy.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const add = useMutation({
    mutationFn: () => addStrategyMember({ data: { strategy_id: strategyId, email, role } }),
    onSuccess: () => {
      toast.success(`${email} added as ${role}`);
      setEmail("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeStrategyMember({ data: { strategy_id: strategyId, user_id: userId } }),
    onSuccess: () => {
      toast.success("Access removed");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageGuide title="Who can see and change this strategy">
        <p>
          A review sitting is a group. The owner shares the strategy by email: editors can record evidence, set
          statuses, log decisions and draft changes; viewers can read everything and download the briefs. The
          person must have signed in to Vigil once before they can be added.
        </p>
      </PageGuide>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>The log records who decided what, by name or email.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-3">
          {bundle.members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
              <div>
                <p>{m.display_name || m.email || "Signed-in user"}</p>
                <p className="font-mono text-xs text-muted-foreground">{m.email ?? m.user_id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.role === "owner" ? "primary" : "neutral"}>{m.role}</Badge>
                {m.role !== "owner" && (isOwner || m.user_id === me?.id) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => {
                      const self = m.user_id === me?.id;
                      if (window.confirm(self ? "Leave this strategy?" : `Remove ${m.email ?? "this member"}?`)) {
                        remove.mutate(m.user_id);
                      }
                    }}
                  >
                    {m.user_id === me?.id ? "Leave" : "Remove"}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {isOwner ? (
            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <Field label="Add by email" htmlFor="member-email">
                <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ministry.gov" />
              </Field>
              <Field label="Role" htmlFor="member-role">
                <NativeSelect id="member-role" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </NativeSelect>
              </Field>
              <Button size="sm" disabled={add.isPending || !email.includes("@")} onClick={() => add.mutate()}>
                Add
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
