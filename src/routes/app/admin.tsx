import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminPanel } from "@/components/admin-panel";
import { getMe } from "@/lib/server/profiles";

export const Route = createFileRoute("/app/admin")({ component: AdminPage });

function AdminPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => getMe() });
  if (me.data && me.data.role !== "admin") {
    return <p className="text-sm text-muted-foreground">Administrator access only.</p>;
  }
  return <AdminPanel />;
}
