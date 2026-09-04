import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, brokerSignInAvailable, signIn, signUpEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const broker = brokerSignInAvailable();

  if (!isPending && user) return <Navigate to="/app" />;

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") {
        const res = await authClient.signUp.email({ email, password, name: name || email.split("@")[0] });
        if (res.error) throw new Error(res.error.message || "Could not create account");
      } else {
        const res = await authClient.signIn.email({ email, password, callbackURL: "/app" });
        if (res.error) throw new Error(res.error.message || "Could not sign in");
      }
      window.location.assign("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <Link to="/" className="font-serif text-2xl">
            Vigil
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to monitor a living strategy.</p>
        </div>
        {authEnabled ? (
          <>
            {broker ? (
              <>
                <div className="space-y-2">
                  {GROK_PROVIDERS.map((p) => (
                    <Button
                      key={p.providerId}
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        signIn(p.providerId, { callbackURL: "/app" }).catch((err: Error) => setError(err.message))
                      }
                    >
                      Continue with {p.label}
                    </Button>
                  ))}
                </div>
                <p className="text-center text-xs uppercase tracking-wider text-muted-foreground">or email</p>
              </>
            ) : null}
            <form onSubmit={(e) => void onEmail(e)} className="space-y-3">
              {mode === "up" ? (
                <div className="grid gap-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              ) : null}
              <div className="grid gap-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error ? <p className="text-sm text-broken">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {mode === "up" ? "Create account" : "Sign in"}
              </Button>
            </form>
            {signUpEnabled ? (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === "up" ? "in" : "up")}
              >
                {mode === "up" ? "Have an account? Sign in" : "Need an account? Create one"}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">New accounts are created by the administrator.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
