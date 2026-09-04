import { analyzeAllCategories, verdictWord } from "./category-analysis.ts";
import { cellReading, thresholdText, validityOf } from "./compute.ts";
import { PRESSURE_RANGE, categoryById, INTENSITIES } from "./taxonomy.ts";
import { TERMS, deliveryWord } from "./glossary.ts";
import { methodSummaryMarkdown } from "./methodology.ts";
import type { Amendment, PeerResearch, StrategyBundle } from "./types.ts";
import { categoryGuide } from "./category-guide.ts";
import { day } from "./day.ts";

function line(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function snapshot(bundle: StrategyBundle) {
  const m = bundle.metrics;
  const validity = validityOf(bundle.assumptions);
  const rating = bundle.delivery_ratings[0] ?? null;
  const parts = ["## Snapshot"];
  parts.push(
    `- Delivery (did we do the plan?): ${deliveryWord(bundle.strategy.delivery_rag).toLowerCase()}${
      rating
        ? ` — ${rating.source_label ? `${rating.source_label}, ` : ""}as of ${rating.as_of ?? "—"}; rated ${day(rating.created_at)} by ${rating.author ?? "a member"}${
            rating.method === "desk" ? " (proposed by a model, accepted by them)" : ""
          }: “${rating.basis}”`
        : ""
    }`,
  );
  parts.push(
    `- Validity (are the bets still true?): ${validity.label.toLowerCase()} — ${validity.holding} holding, ${validity.weakening} weakening, ${validity.broken} broken, ${validity.untested} untested`,
  );
  parts.push(`- Reading: ${cellReading(bundle.strategy.delivery_rag, validity)}`);
  parts.push(`- Coverage (assumptions with a live sentinel): ${Math.round(m.coverage_ratio * 100)}%`);
  parts.push(
    `- Signal budget: ${m.active_signals}/30 active, ${m.sentinel_count}/8 sentinels, ${m.stale_count} stale, ${m.crossed_count} past a threshold`,
  );
  parts.push(
    `- Interrupts: ${m.open_interrupts} open${m.overdue_interrupts ? `, ${m.overdue_interrupts} past the review deadline` : ""}`,
  );
  parts.push(`- Next cliff: ${m.next_cliff_name ?? "none"} (${m.days_to_cliff ?? "—"} days)`);
  parts.push(
    `- Decision queue: ${bundle.queue.length}/12${m.queue_overflow ? `, ${m.queue_overflow} more ranked below the cut` : ""}${
      m.queue_suppressed ? `, ${m.queue_suppressed} cleared by logged decisions` : ""
    }`,
  );
  parts.push("");
  return parts.join("\n");
}

export function analysisMarkdown(bundle: StrategyBundle) {
  const s = bundle.strategy;
  const parts: string[] = [];
  parts.push(`# ${s.title}`);
  parts.push("");
  parts.push(`Domain: ${s.domain || "—"}`);
  if (s.language) parts.push(`Document language: ${s.language}`);
  parts.push(`Horizon: ${s.horizon_start ?? "—"} to ${s.horizon_end ?? "—"}`);
  parts.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  parts.push("");
  if (s.vision) {
    parts.push("## Vision");
    parts.push(s.vision);
    parts.push("");
  }
  parts.push(methodSummaryMarkdown());
  parts.push(snapshot(bundle));
  parts.push("## Load-bearing assumptions");
  parts.push(TERMS.assumption.body);
  parts.push("");
  for (const a of bundle.assumptions) {
    parts.push(`### ${a.sort_order}. ${line(a.claim)}`);
    parts.push(`- Origin: ${a.origin}`);
    parts.push(`- Status: ${a.status} (since ${day(a.status_changed_at)})`);
    parts.push(`- If broken: ${a.implied_intensity}`);
    parts.push(`- Owner: ${a.owner_label || "unassigned"}`);
    const latestNote = bundle.evidence.find((e) => e.assumption_id === a.id);
    parts.push(`- Last evidence: ${day(a.last_evidence_at)}${latestNote?.method === "desk" ? " (model-drafted, accepted by a person)" : ""}`);
    parts.push("");
  }
  parts.push("## Signals");
  parts.push(
    `${TERMS.sentinel.body} Pressure = materiality × velocity × (6 − confidence), from 1 to 125 (quiet 1–15, moderate 16–39, high 40–79, severe 80–125).`,
  );
  parts.push("");
  for (const sig of bundle.signals) {
    parts.push(`### ${sig.name}`);
    parts.push(`- Category: ${categoryById(sig.category).name}`);
    parts.push(`- Layer: ${sig.layer} · status: ${sig.status}`);
    parts.push(
      `- M·V·C: ${sig.materiality}·${sig.velocity}·${sig.confidence} → pressure ${sig.pressure}/${PRESSURE_RANGE.max}`,
    );
    parts.push(`- Cadence: ${sig.cadence}${sig.stale ? " (evidence stale)" : ""}`);
    parts.push(`- Baseline: ${sig.baseline || "NO BASELINE"}`);
    parts.push(`- Current: ${sig.current_value || "—"} (as of ${day(sig.last_evidence_at ?? sig.created_at)})`);
    if (sig.crossed_level !== "none") parts.push(`- Crossed threshold: ${sig.crossed_level}`);
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
    parts.push(
      `- **${i.name}** (${i.status}${i.status === "open" ? `, review by ${day(i.review_by)}` : ""}): ${i.red_line}`,
    );
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
      parts.push(
        `- ${d.filename} · ${d.char_count.toLocaleString()} characters · ${d.chunk_count} chunks${d.page_count ? ` · ${d.page_count} pages` : ""}`,
      );
    }
    if (s.extraction_note) parts.push(s.extraction_note);
    parts.push("");
  }
  parts.push("## Analysis by category");
  parts.push("Each strategy is read through the same ten rooms. An empty room is a blind spot, not calm.");
  parts.push("");
  for (const r of analyzeAllCategories(bundle)) {
    parts.push(`### ${r.id}. ${r.short} — ${r.name}`);
    parts.push(r.question);
    parts.push("");
    parts.push(`Pressure: ${r.pressure == null ? "none" : `${r.pressure}/${PRESSURE_RANGE.max}`} · verdict: ${verdictWord(r.verdict)}`);
    parts.push(`Reading: ${r.reading}`);
    if (r.also) parts.push(r.also);
    if (r.signals.length) {
      parts.push("Watchpoints:");
      for (const sig of r.signals) {
        parts.push(
          `- ${sig.name} (${sig.pressure}/${PRESSURE_RANGE.max}, ${sig.layer}${sig.crossed_level !== "none" ? `, crossed ${sig.crossed_level}` : ""}${
            sig.category !== r.id ? ", also filed here" : ""
          })`,
        );
      }
    }
    if (r.interrupts.length) {
      parts.push("Red lines:");
      for (const i of r.interrupts) {
        parts.push(`- ${i.interrupt.name} (${i.interrupt.status}${i.overdue ? ", review overdue" : ""}${i.room_set ? "" : ", room not set"})`);
      }
    }
    if (r.cliffs.length) {
      parts.push("Cliffs:");
      for (const c of r.cliffs) {
        parts.push(
          `- ${c.cliff.name} — ${c.cliff.cliff_date} (${c.cliff.kind}, ${c.passed ? `passed ${-c.days} days ago` : `in ${c.days} days`}${c.decided_at ? `, decided ${day(c.decided_at)}` : ""})`,
        );
      }
    }
    if (r.bets.length) {
      parts.push("Bets watched from this room:");
      for (const b of r.bets) {
        parts.push(`- ${line(b.assumption.claim)} (${b.assumption.status}; via ${b.via.map((s) => s.name).join(", ")})`);
      }
    }
    parts.push("");
  }
  parts.push("## Decision queue");
  if (!bundle.queue.length) parts.push("_Empty._");
  for (const q of bundle.queue) {
    parts.push(`- **${q.intensity_hint}** — ${q.title}${q.overdue ? " (overdue)" : ""}`);
    parts.push(`  ${q.reason}`);
  }
  parts.push("");
  parts.push(amendmentsMarkdown(bundle.amendments ?? []));
  parts.push(peerMarkdown(bundle.peer_research));
  parts.push("## Decision log");
  if (!bundle.decisions.length) parts.push("_None yet._");
  for (const d of bundle.decisions) {
    parts.push(
      `- ${day(d.decided_at)} · **${d.intensity}** · ${d.summary} — ${d.rationale}${d.author ? ` (${d.author})` : ""}`,
    );
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
  if (s.language) parts.push(`Language of the official text: ${s.language}`);
  if (s.vision) parts.push(`Vision: ${s.vision}`);
  parts.push(`Prepared: ${new Date().toISOString().slice(0, 10)}`);
  parts.push("");

  const broken = bundle.assumptions.filter((a) => a.status === "broken");
  const weakening = bundle.assumptions.filter((a) => a.status === "weakening");
  const untested = bundle.assumptions.filter((a) => a.status === "untested");
  const interrupts = bundle.interrupts.filter((i) => i.status === "open");
  const crossed = bundle.signals.filter((x) => x.status === "active" && x.crossed_level !== "none");
  const high = [...bundle.signals]
    .filter((x) => x.status === "active")
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 5);

  parts.push("## Immediate decisions");
  if (!bundle.queue.length) {
    parts.push("The queue is empty. Log **no change** if a review sitting happened and the text still holds.");
  } else {
    for (const q of bundle.queue) {
      parts.push(`- **${q.intensity_hint}** — ${q.title}${q.overdue ? " (overdue)" : ""}`);
      parts.push(`  ${q.reason}`);
    }
    if (bundle.metrics.queue_overflow) {
      parts.push(
        `- _${bundle.metrics.queue_overflow} further item${bundle.metrics.queue_overflow > 1 ? "s" : ""} ranked below the cut of twelve. Clear these first._`,
      );
    }
  }
  parts.push("");

  if (crossed.length) {
    parts.push("## Thresholds crossed");
    for (const sig of crossed) {
      parts.push(
        `- **${sig.name}** — reading “${sig.current_value || "—"}” has crossed the ${sig.crossed_level} threshold (${thresholdText(sig, sig.crossed_level) || "not written"}). Guard: ${sig.false_positive_guard || "—"}.`,
      );
    }
    parts.push("");
  }

  parts.push("## Proposed changes to the original document");
  const amendments = bundle.amendments ?? [];
  if (!amendments.length) {
    parts.push(
      "No drafted amendments yet. Open Review and choose “Draft changes from the original”, or run peer research first so the drafter can use it.",
    );
    parts.push("");
    if (!broken.length && !weakening.length && !interrupts.length && !crossed.length) {
      parts.push(
        "No weakening or broken assumptions, no crossed thresholds, no fired interrupts. Do not reopen the document on the basis of this sitting unless peer research argues otherwise.",
      );
      parts.push("");
    }
  } else {
    parts.push(formatAmendments(amendments));
  }

  for (const i of interrupts) {
    parts.push(`### Interrupt fired — ${i.name}`);
    parts.push(i.red_line);
    parts.push(`Review by ${day(i.review_by)}. Do not wait for the annual cycle.`);
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
  if (!bundle.cliffs.length) parts.push("None named.");
  for (const c of bundle.cliffs) {
    parts.push(`- ${c.name} — ${c.cliff_date} (${c.kind})`);
  }
  parts.push("");
  parts.push("## Intensity key");
  for (const i of INTENSITIES) {
    parts.push(`- **${i}** — ${TERMS[i === "no-change" ? "watch" : i].body}`);
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
    if (a.excerpt_verified === false) {
      parts.push("");
      parts.push("_Warning: this quotation was not found in the stored text. Check it against the document before use._");
    }
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
  const parts = ["## Ideas from peer strategies", ""];
  if (!research) {
    parts.push("No peer research has been run. Open the Peers tab, set how recent the comparison should be, and search.");
    parts.push("");
    return parts.join("\n");
  }
  parts.push(
    "These are ideas taken from other countries’ documents, not drafted text. Run “Draft changes from the original” after research to turn any of them into a proposed amendment.",
  );
  parts.push("");
  parts.push(`Window: last ${research.recency_years} years · run ${day(research.created_at)}`);
  parts.push(`Query: ${research.query}`);
  parts.push("");
  parts.push(research.summary);
  parts.push("");
  for (const f of research.findings) {
    const room = f.category ? categoryGuide(f.category) : null;
    parts.push(`#### ${f.country || "Peer"} — ${f.title}`);
    if (f.year) parts.push(`Year: ${f.year}`);
    if (f.url) parts.push(`Source: ${f.url}`);
    if (room) parts.push(`Room: ${room.short} · suggested intensity: ${f.intensity}`);
    parts.push(f.idea);
    parts.push("");
    parts.push(f.relevance);
    parts.push("");
  }
  return parts.join("\n");
}
