import { CATEGORY_GUIDE } from "@/lib/category-guide";
import {
  METHOD_CATEGORIES,
  METHOD_INTENSITIES,
  METHOD_LEAD,
  METHOD_PRESSURE,
  METHOD_STEPS,
  METHOD_TAGLINE,
} from "@/lib/methodology";

export function MethodologySection({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "space-y-6" : "space-y-10"} aria-labelledby="methodology-heading">
      {compact ? (
        <p className="text-sm text-muted-foreground text-pretty">{METHOD_LEAD}</p>
      ) : (
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Methodology</p>
          <h2 id="methodology-heading" className="mt-3 font-serif text-3xl leading-tight md:text-4xl text-balance">
            {METHOD_TAGLINE}
          </h2>
          <p className="mt-4 text-base text-muted-foreground text-pretty">{METHOD_LEAD}</p>
        </div>
      )}

      <ol className="grid gap-6">
        {METHOD_STEPS.map((step) => (
          <li key={step.n} className="grid gap-2 border-t border-border pt-5 md:grid-cols-[4rem_1fr] md:gap-8">
            <span className="font-serif text-2xl tabular-nums text-muted-foreground">{step.n}</span>
            <div>
              <h3 className="font-serif text-xl leading-snug">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-5">
          <h3 className="font-serif text-xl">How much of the document to reopen</h3>
          <ul className="mt-4 space-y-3">
            {METHOD_INTENSITIES.map((i) => (
              <li key={i.id}>
                <p className="text-sm font-medium uppercase tracking-wider">{i.title}</p>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">{i.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-5">
            <h3 className="font-serif text-xl">Why a number has pressure</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground text-pretty">{METHOD_PRESSURE}</p>
          </div>
          <div className="rounded-xl border border-border p-5">
            <h3 className="font-serif text-xl">Ten rooms, not sixty dots</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground text-pretty">{METHOD_CATEGORIES}</p>
          </div>
        </div>
      </div>

      {!compact ? (
      <div>
        <h3 className="font-serif text-2xl">The ten rooms</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground text-pretty">
          Same rooms for every strategy. In a workspace, the Categories screen fills each room with what this
          particular document is doing — and what it is not watching.
        </p>
        <ol className="mt-6 grid gap-4 md:grid-cols-2">
          {CATEGORY_GUIDE.map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {c.id}. {c.short}
              </p>
              <h4 className="mt-1 font-serif text-xl leading-snug">{c.name}</h4>
              <p className="mt-2 text-sm font-medium">{c.question}</p>
              <p className="mt-2 text-sm text-muted-foreground text-pretty">{c.why}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Look for: </span>
                {c.looksFor}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Example: </span>
                {c.example}
              </p>
            </li>
          ))}
        </ol>
      </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          The ten rooms — what they mean and how this document fills them — are on the Categories tab.
        </p>
      )}
    </section>
  );
}
