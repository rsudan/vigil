export const TERMS = {
  assumption: {
    title: "Load-bearing assumption",
    body: "A bet the strategy is making that, if false, would change the document. Not an activity (“train 200 people”) and not a hope. Romania’s sample has 12 — the allowed range is 5 to 12, so every strategy can carry a full spine.",
  },
  sentinel: {
    title: "Sentinel",
    body: "A signal you watch every cycle, not just this quarter. Maximum eight. If it goes stale, you are pretending to monitor. DesInventar completeness and post-2027 funding are sentinels for Romania.",
  },
  rotating: {
    title: "Rotating signal",
    body: "A signal on the watchlist for this quarter only. Park or retire it to make room. Annex 1 output completion is rotating: it matters for delivery, not always for validity.",
  },
  interrupt: {
    title: "Interrupt",
    body: "A red line that skips the calendar. If it fires, you review within 30 days — you do not wait for the annual report. A Vrancea-class earthquake is an interrupt.",
  },
  cliff: {
    title: "Cliff",
    body: "A dated event that will force a rewrite whether or not anyone calls a review. Romania’s 31 December 2027 PNRR/MFF sunset is a fiscal cliff.",
  },
  pressure: {
    title: "Pressure",
    body: "A score from 1 to 125. It is materiality × velocity × (6 − confidence), each of those 1–5. 1 is the quietest possible watchpoint; 125 means it matters a lot, it can move fast, and you do not trust the current number. Read 1–15 as quiet, 16–39 moderate, 40–79 high, 80–125 severe.",
  },
  delivery: {
    title: "Delivery",
    body: "Existing M&E: did we do the plan? Green / amber / red / unrated. This is the colour of Annex 1, not of the strategy’s logic.",
  },
  validity: {
    title: "Validity",
    body: "Are the load-bearing bets still true? Holding / weakening / broken / untested. A strategy can be on track (green delivery) and already wrong (weakening validity). That cell is the one to fear.",
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
    body: "At most 12 items the machine thinks you must decide now. Weakening assumptions, fired interrupts, stale sentinels, high-pressure sentinels, cliffs inside 180 days, and green delivery over a weakening logic. You log a decision — including “no change.” Silence is a failure.",
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
  { id: "green", meaning: "On track against the published plan." },
  { id: "amber", meaning: "Slippage, but the plan is still the plan." },
  { id: "red", meaning: "Delivery has failed the published plan." },
  { id: "unrated", meaning: "Nobody has scored existing M&E yet." },
];
