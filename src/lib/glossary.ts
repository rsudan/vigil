export const TERMS = {
  assumption: {
    title: "Load-bearing assumption",
    body: "A bet the strategy is making that, if false, would change the document. Not an activity (“train 200 people”) and not a hope. Keep between 5 and 12 so the list stays a spine, not a catalogue.",
  },
  sentinel: {
    title: "Sentinel",
    body: "A signal you watch every cycle, not just this quarter. Maximum eight. If it goes stale, you are pretending to monitor.",
  },
  rotating: {
    title: "Rotating signal",
    body: "A signal on the watchlist for this quarter only. Park or retire it to make room. Output completion against the annex is usually rotating: it matters for delivery, not always for validity.",
  },
  interrupt: {
    title: "Interrupt",
    body: "A red line agreed in advance that skips the calendar. If it fires, you review within 30 days; you do not wait for the annual report. Close it once the decision is logged.",
  },
  cliff: {
    title: "Cliff",
    body: "A dated event that will force a rewrite whether or not anyone calls a review: a funding sunset, a legal deadline, a scheduled rewrite window.",
  },
  pressure: {
    title: "Pressure",
    body: "A score from 1 to 125: materiality × velocity × (6 − confidence), each of those 1–5. It says how hard to watch a signal, not whether it has moved. Read 1–15 as quiet, 16–39 moderate, 40–79 high, 80–125 severe.",
  },
  crossed: {
    title: "Crossed threshold",
    body: "Each signal names the reading that would justify a watch, an amend, a refresh, or a reset. When a new reading crosses one, mark it. The queue then carries that intensity, not a guess.",
  },
  delivery: {
    title: "Delivery",
    body: "Existing M&E: did we do the plan? Green / amber / red / not rated, always with the report it rests on. This is the colour of the action plan, not of the strategy’s logic.",
  },
  validity: {
    title: "Validity",
    body: "Are the load-bearing bets still true? Derived from the bets, never set by hand: Not assessed (no bet checked) / Partly checked (some hold, the rest unchecked) / Holding (every bet checked and holds) / Weakening / Broken. A strategy can be on track (green delivery) and already wrong (weakening validity). That cell is the one to fear.",
  },
  coverage: {
    title: "Coverage",
    body: "Share of assumptions that have a live sentinel attached. An assumption with no sentinel is a slogan.",
  },
  budget: {
    title: "Signal budget",
    body: "At most 30 active signals and 8 sentinels. The 31st is refused until you retire one. Discipline, not a dashboard of sixty dots.",
  },
  queue: {
    title: "Decision queue",
    body: "At most 12 items, ranked by urgency: fired red lines, crossed thresholds, broken and weakening bets, cliffs inside 180 days, green delivery over a weakening logic, high-pressure and stale sentinels. Log a decision on each, including “no change”; the item then clears until its condition changes again.",
  },
  watch: {
    title: "Watch",
    body: "Keep the text. Tighten observation. Do not rewrite.",
  },
  amend: {
    title: "Amend",
    body: "Change a measure, owner, target, or annex line. The vision and objectives stay.",
  },
  refresh: {
    title: "Refresh",
    body: "Rewrite a pillar or the theory of change. The vision may survive.",
  },
  reset: {
    title: "Reset",
    body: "The document as a whole is the wrong instrument. Start again.",
  },
  holding: {
    title: "Holding",
    body: "Green. Evidence still supports the bet.",
  },
  weakening: {
    title: "Weakening",
    body: "Gold / amber. Evidence is moving against the bet. Queue it. Usually an amend.",
  },
  broken: {
    title: "Broken",
    body: "Red. The bet is false. Use the intensity you pre-committed in “if broken.”",
  },
  untested: {
    title: "Untested",
    body: "Grey. Nobody has checked yet. Honest, not green. A work order to baseline, not a revision.",
  },
} as const;

export type TermId = keyof typeof TERMS;

export const INTENSITY_HELP = [
  { id: "watch" as const, label: "Watch", meaning: "Keep the text. Observe harder." },
  { id: "amend" as const, label: "Amend", meaning: "Patch a measure or annex. Objectives stay." },
  { id: "refresh" as const, label: "Refresh", meaning: "Rewrite a pillar or the theory of change." },
  { id: "reset" as const, label: "Reset", meaning: "The document is the wrong instrument." },
  { id: "no-change" as const, label: "No change", meaning: "You looked. It still holds. Log it." },
];

export const STATUS_HELP = [
  { id: "holding" as const, tone: "holding" as const, meaning: "Evidence supports the bet." },
  { id: "weakening" as const, tone: "weakening" as const, meaning: "Evidence is moving against it." },
  { id: "broken" as const, tone: "broken" as const, meaning: "The bet is false." },
  { id: "untested" as const, tone: "untested" as const, meaning: "Not yet checked — not the same as holding." },
];

export const RAG_HELP = [
  { id: "green", label: "Green", meaning: "On track against the published plan." },
  { id: "amber", label: "Amber", meaning: "Slippage, but the plan is still the plan." },
  { id: "red", label: "Red", meaning: "Delivery has failed the published plan." },
  { id: "unrated", label: "Not rated", meaning: "Nobody has scored the plan against its timetable yet." },
];

/** The one word for a delivery colour, everywhere it is shown. */
export function deliveryWord(rag: string) {
  return RAG_HELP.find((r) => r.id === rag)?.label ?? rag;
}

/** The five states validity can be in, derived from the bets. One word per state, used everywhere. */
export const VALIDITY_HELP = {
  "not-assessed": { label: "Not assessed", meaning: "No bet has been checked yet." },
  "partly-checked": { label: "Partly checked", meaning: "Some bets hold; the rest have not been checked." },
  holding: { label: "Holding", meaning: "Every bet holds." },
  weakening: { label: "Weakening", meaning: "Evidence is moving against the plan." },
  broken: { label: "Broken", meaning: "At least one bet is false." },
} as const;

/**
 * One sentence per cell of delivery × validity when both are coloured. These are
 * method statements in the author's voice: edit them here, not in components.
 * {weakening} and {s} are filled in from the count of weakening bets.
 */
export const CELL_READINGS: Record<string, string> = {
  "green/green": "On track, and still the right plan. Keep watching.",
  "green/amber":
    "On track, and already wrong: activity is proceeding while the logic weakens ({weakening} bet{s} weakening). This is the dangerous cell.",
  "green/red": "On track against a plan whose logic is broken. Doing the plan well will not help. Reopen the document.",
  "amber/green": "Slipping, but the bets hold. A delivery problem, not a strategy problem: fix the execution, not the logic.",
  "amber/amber": "Slipping, and the logic is moving. Amend before the next sitting.",
  "amber/red": "Slipping, and a bet is broken. The pre-committed intensity applies.",
  "red/green":
    "The plan has failed on its own terms while its bets still hold. Re-plan the delivery; the strategy’s logic survives.",
  "red/amber": "Delivery has failed and the logic is weakening. A refresh is likely.",
  "red/red": "Delivery has failed and the logic is broken. As written, the document is the wrong instrument. Reset is on the table.",
};
