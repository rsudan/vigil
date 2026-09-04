import { CATEGORY_GUIDE } from "./category-guide.ts";

export const METHOD_TAGLINE = "Watch the conditions under which a strategy needs to change.";

export const METHOD_LEAD =
  "Most strategies are written as if the world will wait for the next review cycle. It will not. The method below is how Vigil decides when a living document should be left alone, patched, rewritten, or replaced — without trying to watch everything.";

export const METHOD_STEPS = [
  {
    n: "1",
    title: "Name the bets, not the activities",
    body: "A strategy is a set of claims about the world: that a platform will sit, that money will arrive, that a warning will reach the people it names. Those claims are load-bearing assumptions. If one of them fails, the document has to change. Training two hundred people is an activity. “Counties can deliver the action plan on time” is a bet. You keep five to twelve bets. Twelve is the ceiling so the list stays a spine, not a catalogue.",
  },
  {
    n: "2",
    title: "Watch a few things hard",
    body: "Each bet needs a way to know if it is still true. That watchpoint is a signal, and each signal names in advance the reading that would justify a watch, an amend, a refresh, or a reset. You may run at most thirty active signals, of which eight are sentinels — always on, every cycle. The rest rotate. A thirty-first signal is refused until you retire one. The point is not coverage of every indicator in the annex. The point is that the eight things that would actually force a rewrite are never unwatched.",
  },
  {
    n: "3",
    title: "Ask two different questions",
    body: "Delivery asks: did we do the plan? That is ordinary monitoring and evaluation — green, amber, or red against the published timetable. Validity asks: is the plan still the right plan? A country can be on track with studies and trainings while the coordinating body has stopped meeting, or while the money that pays for the plan has no successor. Green delivery over a weakening logic is the dangerous cell. The method treats those as two colours, never one.",
  },
  {
    n: "4",
    title: "Let shocks skip the calendar",
    body: "Annual reports cannot see an earthquake in month four of a quiet year. An interrupt is a red line agreed in advance — a loss above a threshold, a platform dark for two weeks, a coordinating mandate withdrawn. If it fires, you review within thirty days. A cliff is a dated event that will force a look whether anyone called a meeting: a funding sunset, a legal deadline, a scheduled rewrite window. The calendar still exists. It is no longer the only clock.",
  },
  {
    n: "5",
    title: "Triage, then write the decision down",
    body: "A sitting does not discuss sixty dots. It discusses a queue of at most twelve items the method has already ranked: fired red lines, crossed thresholds, weakening bets, cliffs inside six months, stale sentinels. For each item you log a decision — including “no change.” Silence is not a decision. The log is the proof the document is living, and a logged decision clears the item until its condition changes again.",
  },
] as const;

export const METHOD_INTENSITIES = [
  {
    id: "watch",
    title: "Watch",
    body: "Keep the text. Observe harder. A late county report is a watch, not a rewrite.",
  },
  {
    id: "amend",
    title: "Amend",
    body: "Patch a measure, an owner, a target, or an annex line. The vision and objectives stay.",
  },
  {
    id: "refresh",
    title: "Refresh",
    body: "Rewrite a pillar or the theory of change. The vision may survive; the instrument mix may not.",
  },
  {
    id: "reset",
    title: "Reset",
    body: "The document as a whole is the wrong instrument. Start again.",
  },
  {
    id: "no-change",
    title: "No change",
    body: "You looked, and it still holds. That is a decision. Log it.",
  },
] as const;

export const METHOD_PRESSURE =
  "Each signal is scored 1 to 5 on three things: how much it matters, how fast it can move, and how much you trust the current number. Pressure is (how much it matters) × (how fast it can move) × (6 − how much you trust it). The result always sits between 1 and 125. One is a quiet, well-known, low-stakes watch. 125 is the opposite: it matters, it can jump, and you do not trust the figure. As a reading guide: 1–15 quiet, 16–39 moderate, 40–79 high, 80–125 severe. A missing baseline raises pressure on purpose — it is a reason to look harder, not to look away. Pressure says how hard to watch; the thresholds say what a reading means once it arrives.";

export const METHOD_CATEGORIES =
  "Every strategy is read through the same ten rooms — a digital plan, a climate plan, or a disaster plan. You do not need a watchpoint for every line in an annex. You do need to know if a room is empty. An empty room is a blind spot, not a calm one. The Categories screen shows the analysis for each room on the document you have loaded.";

/** Full method, with the worked examples. Shown on the landing page. */
export function methodologyMarkdown() {
  const lines = [
    "## Methodology",
    "",
    METHOD_TAGLINE,
    "",
    METHOD_LEAD,
    "",
  ];
  for (const step of METHOD_STEPS) {
    lines.push(`### ${step.n}. ${step.title}`);
    lines.push(step.body);
    lines.push("");
  }
  lines.push("### How much of the document to reopen");
  for (const i of METHOD_INTENSITIES) {
    lines.push(`- **${i.title}** — ${i.body}`);
  }
  lines.push("");
  lines.push(METHOD_PRESSURE);
  lines.push("");
  lines.push("### The ten rooms");
  lines.push(METHOD_CATEGORIES);
  lines.push("");
  for (const c of CATEGORY_GUIDE) {
    lines.push(`#### ${c.id}. ${c.short} — ${c.name}`);
    lines.push(c.question);
    lines.push("");
    lines.push(c.why);
    lines.push("");
    lines.push(`What to look for: ${c.looksFor}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Short reading guide for exported documents: the method, no worked examples. */
export function methodSummaryMarkdown() {
  const lines = ["## How to read this document", "", METHOD_TAGLINE, ""];
  for (const step of METHOD_STEPS) lines.push(`- **${step.title}.** ${step.body}`);
  lines.push("");
  lines.push("Intensities: " + METHOD_INTENSITIES.map((i) => `**${i.title}** (${i.body.split(".")[0]!.toLowerCase()})`).join("; ") + ".");
  lines.push("");
  lines.push(METHOD_PRESSURE);
  lines.push("");
  return lines.join("\n");
}
