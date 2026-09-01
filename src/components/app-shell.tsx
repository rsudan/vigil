import { Link, useRouterState } from "@tanstack/react-router";
import { KeyRound, LayoutGrid, Menu, Moon, Shield, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/types";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";
import { Sheet, SheetContent } from "./ui/sheet";

function NavLinks({ me, onNavigate }: { me: Profile | null; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = [
    {
      to: "/app",
      label: "Strategies",
      icon: LayoutGrid,
      match: (p: string) =>
        p === "/app" || (p.startsWith("/app/") && !p.startsWith("/app/keys") && !p.startsWith("/app/admin")),
    },
    { to: "/app/keys", label: "Keys", icon: KeyRound, match: (p: string) => p.startsWith("/app/keys") },
    ...(me?.role === "admin"
      ? [{ to: "/app/admin", label: "Admin", icon: Shield, match: (p: string) => p.startsWith("/app/admin") }]
      : []),
  ];
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ me, children }: { me: Profile | null; children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const { isPending } = useCurrentUserState();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-md md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/app" className="font-serif text-lg tracking-tight">
            Vigil
          </Link>
          <span className="hidden text-xs text-muted-foreground sm:inline">Living strategy monitor</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          {isPending ? <div className="h-8 w-24 animate-pulse rounded-full bg-muted" /> : <UserButton />}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-52 shrink-0 border-r border-border p-4 md:block">
          <NavLinks me={me} />
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-6 pt-14">
          <p className="mb-4 font-serif text-lg">Vigil</p>
          <NavLinks me={me} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
