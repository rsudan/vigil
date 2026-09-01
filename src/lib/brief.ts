import { analyzeAllCategories } from "./category-analysis";
import { PRESSURE_RANGE, categoryById, INTENSITIES } from "./taxonomy";
import { TERMS } from "./glossary";
import { methodologyMarkdown } from "./methodology";
import type { Amendment, PeerResearch, StrategyBundle } from "./types";
import { categoryGuide } from "./category-guide";

function line(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function analysisMarkdown(bundle: StrategyBundle) {
  const s = bundle.strategy;
  const m = bundle.metrics;
  const parts: string[] = [];
  parts.push(`# ${s.title}`);
  parts.push("");
  parts.push(`Domain: ${s.domain || "—"}`);
  parts.push(`Horizon: ${s.horizon_start ?? "—"} → ${s.horizon_end ?? "—"}`);
  parts.push(`Delivery (existing M&E): ${s.delivery_rag}`);
  parts.push("");
  if (s.vision) {
    parts.push("## Vision");
    parts.push(s.vision);
    parts.push("");
  }
  parts.push(methodologyMarkdown());
  parts.push("## How to read this");
  parts.push(TERMS.assumption.body);
  parts.push("");
  parts.push(TERMS.sentinel.body);
  parts.push("");
  parts.push("## Snapshot");
  parts.push(
    `- Assumption integrity: ${m.holding} holding, ${m.weakening} weakening, ${m.broken} broken, ${m.untested} untested`,
  );
  parts.push(`- Coverage (assumptions with a live sentinel): ${Math.round(m.coverage_ratio * 100)}%`);
  parts.push(`- Signal budget: ${m.active_signals}/30 active, ${m.sentinel_count}/8 sentinels, ${m.stale_count} stale`);
  parts.push(`- Next cliff: ${m.next_cliff_name ?? "none"} (${m.days_to_cliff ?? "—"} days)`);
  parts.push(`- Decision queue: ${bundle.queue.length}/12`);
  parts.push("");
  parts.push("## Load-bearing assumptions");
  parts.push("A load-bearing assumption is a bet that, if false, would change the document.");
  parts.push("");
  for (const a of bundle.assumptions) {
    parts.push(`### ${a.sort_order}. ${line(a.claim)}`);
    parts.push(`- Origin: ${a.origin}`);
    parts.push(`- Status: ${a.status}`);
    parts.push(`- If broken: ${a.implied_intensity}`);
    parts.push(`- Owner: ${a.owner_label || "unassigned"}`);
    parts.push("");
  }
  parts.push("## Signals");
  parts.push(
    "Sentinels are always on (max 8). Rotating signals are this quarter only. Pressure = materiality × velocity × (6 − confidence), from 1 to 125 (quiet 1–15, moderate 16–39, high 40–79, severe 80–125).",
  );
  parts.push("");
  for (const sig of bundle.signals) {
    parts.push(`### ${sig.name}`);
    parts.push(`- Category: ${categoryById(sig.category).name}`);
    parts.push(`- Layer: ${sig.layer}`);
    parts.push(`- M·V·C: ${sig.materiality}·${sig.velocity}·${sig.confidence} → pressure ${sig.pressure}/${PRESSURE_RANGE.max}`);
    parts.push(`- Cadence: ${sig.cadence}`);
    parts.push(`- Baseline: ${sig.baseline || "NO BASELINE"}`);
    parts.push(`- Current: ${sig.current_value || "—"}`);
    parts.push(`- Watch: ${sig.threshold_watch || "—"}`);
    parts.push(`- Amend: ${sig.threshold_amend || "—"}`);
    parts.push(`- Refresh: ${sig.threshold_refresh || "—"}`);
    parts.push(`- Reset: ${sig.threshold_reset || "—"}`);
    parts.push(`- False-positive guard: ${sig.false_positive_guard || "—"}`);
    parts.push(`- Owner: ${sig.owner_label || "unassigned"}`);
    parts.push("");
  }
  parts.push("## Interrupts (red lines)");
  for (const i of bundle.interrupts) {
    parts.push(`- **${i.name}** (${i.status}): ${i.red_line}`);
  }
  parts.push("");
  parts.push("## Cliffs");
  for (const c of bundle.cliffs) {
    parts.push(`- **${c.name}** — ${c.cliff_date} (${c.kind})`);
  }
  parts.push("");
  if (bundle.documents.length) {
    parts.push("## Source documents on file");
    for (const d of bundle.documents) {
      parts.push(`- ${d.filename} · ${d.char_count.toLocaleString()} characters · ${d.chunk_count} chunks`);
    }
    parts.push("");
  }
  parts.push("## Analysis by category");
  parts.push("Each strategy is read through the same ten rooms. An empty room is a blind spot, not calm.");
  parts.push("");
  for (const r of analyzeAllCategories(bundle)) {
    parts.push(`### ${r.id}. ${r.short} — ${r.name}`);
    parts.push(r.question);
    parts.push("");
    parts.push(`Pressure: ${r.pressure == null ? "none (gap)" : `${r.pressure}/${PRESSURE_RANGE.max} (${r.verdict})`}`);
    parts.push(`Reading: ${r.reading}`);
    if (r.signals.length) {
      parts.push("Watchpoints:");
      for (const sig of r.signals) {
        parts.push(`- ${sig.name} (${sig.pressure}/${PRESSURE_RANGE.max}, ${sig.layer})`);
      }
    }
    if (r.assumptions.length) {
      parts.push("Linked bets:");
      for (const a of r.assumptions) {
        parts.push(`- ${line(a.claim)} (${a.status})`);
      }
    }
    parts.push("");
  }
  parts.push(amendmentsMarkdown(bundle.amendments ?? []));
  parts.push(peerMarkdown(bundle.peer_research));
  parts.push("## Decision log");
  if (!bundle.decisions.length) parts.push("_None yet._");
  for (const d of bundle.decisions) {
    parts.push(`- ${d.decided_at} · **${d.intensity}** · ${d.summary} — ${d.rationale}`);
  }
  return parts.join("\n");
}

export function revisionBriefMarkdown(bundle: StrategyBundle) {
  const s = bundle.strategy;
  const parts: string[] = [];
  parts.push(`# Suggested revisions — ${s.title}`);
  parts.push("");
  parts.push(
    "This brief proposes specific changes to the original document. Each item quotes (or marks as missing) a passage, then writes the words that should go in. It is a proposal, not a gazetted amendment. Intensities: watch (observe), amend (patch a measure), refresh (rewrite a pillar), reset (the document is the wrong instrument).",
  );
  parts.push("");
  parts.push(`Document: **${s.title}**`);
  parts.push(`Domain: ${s.domain || "—"}`);
  if (s.vision) parts.push(`Vision: ${s.vision}`);
  parts.push("");

  const broken = bundle.assumptions.filter((a) => a.status === "broken");
  const weakening = bundle.assumptions.filter((a) => a.status === "weakening");
  const untested = bundle.assumptions.filter((a) => a.status === "untested");
  const interrupts = bundle.interrupts.filter((i) => i.status === "open");
  const high = [...bundle.signals].filter((x) => x.status === "active").sort((a, b) => b.pressure - a.pressure).slice(0, 5);

  parts.push("## Immediate decisions");
  if (!bundle.queue.length) {
    parts.push("The queue is empty. Log **no change** if a review sitting happened and the text still holds.");
  } else {
    for (const q of bundle.queue) {
      parts.push(`- **${q.intensity_hint}** — ${q.title}`);
      parts.push(`  ${q.reason}`);
    }
  }
  parts.push("");

  parts.push("## Proposed changes to the original document");
  const amendments = bundle.amendments ?? [];
  if (!amendments.length) {
    parts.push(
      "No drafted amendments yet. Open Review and choose “Draft changes from the original”, or run peer research.",
    );
    parts.push("");
    if (!broken.length && !weakening.length && !interrupts.length) {
      parts.push("No weakening or broken assumptions. No fired interrupts. Do not reopen the document on the basis of this sitting unless peer research argues otherwise.");
      parts.push("");
    }
  } else {
    parts.push(formatAmendments(amendments));
  }

  for (const i of interrupts) {
    parts.push(`### Interrupt fired — ${i.name}`);
    parts.push(i.red_line);
    parts.push("Review within 30 days. Do not wait for the annual cycle.");
    parts.push("");
  }

  parts.push("## Watchlist (do not rewrite yet)");
  for (const sig of high) {
    parts.push(
      `- ${sig.name} (pressure ${sig.pressure}/${PRESSURE_RANGE.max}, ${categoryById(sig.category).short}): current “${sig.current_value || "—"}”. Watch ${sig.threshold_watch || "—"}. Guard: ${sig.false_positive_guard || "—"}.`,
    );
  }
  parts.push("");

  parts.push("## Untested bets still requiring a baseline");
  if (!untested.length) parts.push("None.");
  for (const a of untested) {
    parts.push(`- ${line(a.claim)} (${a.owner_label || "unassigned"})`);
  }
  parts.push("");

  parts.push("## Cliffs on the horizon");
  for (const c of bundle.cliffs) {
    parts.push(`- ${c.name} — ${c.cliff_date} (${c.kind})`);
  }
  parts.push("");
  parts.push("## Intensity key");
  for (const i of INTENSITIES) {
    parts.push(`- **${i}**`);
  }
  parts.push("");
  parts.push(peerMarkdown(bundle.peer_research));
  return parts.join("\n");
}

function formatAmendments(amendments: Amendment[]) {
  const parts: string[] = [];
  for (const a of amendments) {
    parts.push(`### ${a.intensity.toUpperCase()} — ${a.location || "Unspecified location"}`);
    parts.push(`Source: ${a.source === "peer" ? "peer strategy" : "this document’s monitor"}`);
    parts.push("");
    parts.push("**Original (quote or silence)**");
    parts.push(a.original_excerpt || "_Not in the original text._");
    parts.push("");
    parts.push("**Proposed text for the document**");
    parts.push(a.proposed_text);
    parts.push("");
    parts.push(`*${a.rationale}*`);
    parts.push("");
  }
  return parts.join("\n");
}

function amendmentsMarkdown(amendments: Amendment[]) {
  const parts = ["## Proposed changes to the original document", ""];
  if (!amendments.length) {
    parts.push("None drafted yet.");
    parts.push("");
    return parts.join("\n");
  }
  parts.push(formatAmendments(amendments));
  return parts.join("\n");
}

function peerMarkdown(research: PeerResearch | null) {
  const parts = ["## Peer strategy research", ""];
  if (!research) {
    parts.push("No peer research has been run. Open the Peers tab, set how recent the comparison should be, and search.");
    parts.push("");
    return parts.join("\n");
  }
  parts.push(`Window: last ${research.recency_years} years · ${research.created_at}`);
  parts.push(`Query: ${research.query}`);
  parts.push("");
  parts.push(research.summary);
  parts.push("");
  parts.push("### Recommendations from peers");
  for (const f of research.findings) {
    const room = f.category ? categoryGuide(f.category) : null;
    parts.push(`#### ${f.country || "Peer"} — ${f.title}`);
    if (f.year) parts.push(`Year: ${f.year}`);
    if (f.url) parts.push(`Source: ${f.url}`);
    if (room) parts.push(`Room: ${room.short} · intensity: ${f.intensity}`);
    parts.push(f.idea);
    parts.push("");
    parts.push(f.relevance);
    parts.push("");
  }
  return parts.join("\n");
}
