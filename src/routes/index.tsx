import { createFileRoute, Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { MethodologySection } from "@/components/methodology";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut } from "@/lib/auth/gates";
import { METHOD_TAGLINE } from "@/lib/methodology";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <span className="font-serif text-lg">Vigil</span>
        <div className="flex items-center gap-2">
          <a href="#methodology-heading" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
            Methodology
          </a>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <SignedIn>
            <Button asChild>
              <Link to="/app">Open monitor</Link>
            </Button>
          </SignedIn>
          <SignedOut>
            <Button asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </SignedOut>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16 md:py-24">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Living documents</p>
        <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight md:text-6xl">
          {METHOD_TAGLINE}
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground text-pretty">
          Usual reviews ask whether the work got done. Vigil asks whether the plan still makes sense. You
          watch a few important bets the plan depends on, ignore the rest, and write down when the plan
          should change.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <SignedOut>
            <Button asChild size="lg">
              <Link to="/login">Sign in to start</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild size="lg">
              <Link to="/app">Go to strategies</Link>
            </Button>
          </SignedIn>
        </div>
        <dl className="mt-20 grid gap-8 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Spine</dt>
            <dd className="mt-2 font-serif text-xl">5–12 load-bearing assumptions</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Budget</dt>
            <dd className="mt-2 font-serif text-xl">30 signals · 8 sentinels · 12 in queue</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Keys</dt>
            <dd className="mt-2 font-serif text-xl">Bring your own keys</dd>
          </div>
        </dl>

        <div className="mt-24 border-t border-border pt-16 pb-8">
          <MethodologySection />
        </div>
      </main>
    </div>
  );
}
