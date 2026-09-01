import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe } from "@/lib/server/profiles";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(),
    enabled: !!user,
  });

  if (isPending) {
    return (
      <div className="grid min-h-svh place-items-center bg-background">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <AppShell me={me.data ?? null}>
      <Outlet />
    </AppShell>
  );
}
