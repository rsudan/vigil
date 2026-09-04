import { categoryGuide } from "./category-guide.ts";
import { DAY, RANK, daysUntil, latestDecisions } from "./compute.ts";
import { day } from "./day.ts";
import { INTENSITY_ORDER, PRESSURE_RANGE, pressureBand, roomOfCliff, roomOfInterrupt } from "./taxonomy.ts";
import type { Assumption, Cliff, Interrupt, RoomFinding, RoomPassage, RoomRead, Signal, StrategyBundle } from "./types.ts";

/**
 * A room is the method's coverage instrument: every strategy is read through
 * the same ten. What sits in a room, and what its verdict may rest on:
 *
 * - Watchpoints sit in the room they were given (home), and are also listed in
 *   their second room, marked as filed there. Pressure and crossed thresholds
 *   count in both.
 * - Bets have no room of their own. A bet is shown in a room only through an
 *   active watchpoint whose home room this is; bet status colours a room only
 *   that way, never through a filing.
 * - Red lines sit in the room they were given; one with no room reads in Risks.
 * - Cliffs sit by kind (fiscal → Resources, legal → Mandate, review →
 *   Assumptions, scenario → Risks).
 *
 * A room with no active watchpoint is a gap, not calm. Only a fired red line or
 * a passed, undecided cliff overrides that; an armed red line or a far cliff is
 * named in a second sentence and colours nothing.
 *
 * What the document says in a room, and what a search found about it, ride
 * along and colour nothing at all. They are not pre-committed conditions: the
 * document was already true the day it was signed, and a search result is dated
 * but was never agreed. The only path from either into a colour is a person
 * making a watchpoint or a red line out of it. Material in an unwatched room
 * makes the gap read worse, never better.
 *
 * The reading names the strongest fact in the room, ranked the way the queue
 * ranks it, so the room and the queue can never tell a different story.
 */

export type CategoryVerdict = "gap" | "quiet" | "moderate" | "high" | "severe";

/** A bet shown in a room, and the home watchpoints that put it there. */
export type RoomBet = { assumption: Assumption; via: Signal[]; decided_at: string | null };
export type RoomInterrupt = { interrupt: Interrupt; room_set: boolean; overdue: boolean; decided_at: string | null };
export type RoomCliff = { cliff: Cliff; days: number; passed: boolean; decided_at: string | null };
/** The latest "reviewed, nothing to watch" record on the room, while it still counts. */
export type RoomReview = { at: string; author: string | null; rationale: string };

/** How long a "reviewed, nothing to watch" record stands before the room asks again. */
export const ROOM_REVIEW_DAYS = 180;

export type CategoryResult = {
  id: number;
  short: string;
  name: string;
  question: string;
  why: string;
  looksFor: string;
  ifEmpty: string;
  /** Active watchpoints in this room, home and filed. */
  signals: Signal[];
  /** Active watchpoints whose home room this is. */
  home: Signal[];
  /** Active watchpoints filed here as their second room. */
  filed: Signal[];
  bets: RoomBet[];
  /** The bets alone, for consumers that only need the list. */
  assumptions: Assumption[];
  /** Armed and open red lines in this room; closed ones are history. */
  interrupts: RoomInterrupt[];
  cliffs: RoomCliff[];
  hottest: Signal | null;
  /** The watchpoint whose reading has crossed the highest threshold in this room, if any. */
  crossed: Signal | null;
  pressure: number | null;
  band: ReturnType<typeof pressureBand> | null;
  verdict: CategoryVerdict;
  /** The strongest dated fact, short enough for a tile caption. */
  headline: string;
  reading: string;
  /** Facts the reading did not use. Empty when there are none. */
  also: string;
  reviewed: RoomReview | null;
  /** Verbatim sentences the uploaded document gives for this room. */
  passages: RoomPassage[];
  /** When this room was last read out of the document, and whether the search itself worked. */
  read: RoomRead | null;
  /** Candidates a search brought back, newest first. Dismissed ones are kept, not shown here. */
  findings: RoomFinding[];
  /** Candidates dismissed in this room, kept as the record of what was declined. */
  dismissed: RoomFinding[];
};

const VERDICT_ORDER: Record<CategoryVerdict, number> = { gap: 0, quiet: 1, moderate: 2, high: 3, severe: 4 };

function atLeast(a: CategoryVerdict, b: CategoryVerdict): CategoryVerdict {
  return VERDICT_ORDER[a] >= VERDICT_ORDER[b] ? a : b;
}

function at(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function isoOf(t: number | undefined): string | null {
  return t !== undefined && Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One fact a room can read, ranked the way the queue ranks the same condition. */
type Fact = { rank: number; headline: string; sentence: string; note: string };

/** Signals active in a room, by primary or secondary category. */
export function signalsInCategory(signals: Signal[], categoryId: number) {
  return signals.filter(
    (s) => s.status === "active" && (s.category === categoryId || s.secondary_category === categoryId),
  );
}

/** Bets with no active watchpoint at all. They sit in no room, which is the deepest blind spot. */
export function unwatchedBets(bundle: Pick<StrategyBundle, "assumptions" | "signals">): Assumption[] {
  const active = new Set(bundle.signals.filter((s) => s.status === "active").map((s) => s.id));
  return bundle.assumptions.filter((a) => !a.linked_signal_ids.some((id) => active.has(id)));
}

/** A watchpoint the document named and nobody has measured. A reason to look harder, not away. */
export function unmeasured(signal: Pick<Signal, "current_value">) {
  const v = signal.current_value.trim();
  return !v || /no baseline/i.test(v);
}

export function analyzeCategory(bundle: StrategyBundle, categoryId: number, now = Date.now()): CategoryResult {
  const guide = categoryGuide(categoryId);
  const decided = latestDecisions(bundle.decisions ?? []);
  const positions = new Map((bundle.queue ?? []).map((q, i) => [q.id, i + 1] as const));
  const queued = (key: string) => {
    const p = positions.get(key);
    return p ? ` It is #${p} in the queue.` : "";
  };
  const loggedAfter = (key: string, since: number): string | null => {
    const t = decided.get(key);
    return t !== undefined && t > since ? isoOf(t) : null;
  };

  const signals = signalsInCategory(bundle.signals, categoryId);
  const home = signals.filter((s) => s.category === categoryId);
  const filed = signals.filter((s) => s.category !== categoryId);
  const hottest = [...signals].sort((a, b) => b.pressure - a.pressure)[0] ?? null;
  const crossed =
    [...signals]
      .filter((s) => s.crossed_level !== "none")
      .sort((a, b) => INTENSITY_ORDER[b.crossed_level] - INTENSITY_ORDER[a.crossed_level])[0] ?? null;
  const stale = [...signals].filter((s) => s.stale).sort((a, b) => b.pressure - a.pressure)[0] ?? null;

  const homeIds = new Set(home.map((s) => s.id));
  const bets: RoomBet[] = bundle.assumptions
    .filter((a) => a.linked_signal_ids.some((id) => homeIds.has(id)))
    .map((a) => ({
      assumption: a,
      via: home.filter((s) => a.linked_signal_ids.includes(s.id)),
      decided_at: loggedAfter(`asm-${a.id}`, at(a.status_changed_at)),
    }));
  const broken = bets.filter((b) => b.assumption.status === "broken");
  const weakening = bets.filter((b) => b.assumption.status === "weakening");

  const interrupts: RoomInterrupt[] = (bundle.interrupts ?? [])
    .filter((i) => i.status !== "closed" && roomOfInterrupt(i) === categoryId)
    .map((i) => {
      const reviewBy = at(i.review_by);
      const fired = at(i.fired_at) || at(i.created_at);
      return {
        interrupt: i,
        // A room out of range is not a room: it reads in Risks and still says "not set".
        room_set: i.category === categoryId,
        overdue: i.status === "open" && Number.isFinite(reviewBy) && reviewBy < now,
        decided_at: i.status === "open" ? loggedAfter(`int-${i.id}`, fired) : null,
      };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.interrupt.id - b.interrupt.id);
  const open = interrupts.filter((i) => i.interrupt.status === "open");
  const armed = interrupts.filter((i) => i.interrupt.status === "armed");

  const cliffs: RoomCliff[] = (bundle.cliffs ?? [])
    .filter((c) => roomOfCliff(c) === categoryId && Number.isFinite(at(c.cliff_date)))
    .map((c) => {
      const days = daysUntil(c.cliff_date, now);
      const passed = days < 0;
      // The same rule as the queue: a decision after a passed cliff settles it; on an
      // approaching cliff a decision holds for a month.
      const since = passed ? at(c.cliff_date) : now - 30 * DAY;
      return { cliff: c, days, passed, decided_at: loggedAfter(`cliff-${c.id}`, since) };
    })
    .sort((a, b) => a.days - b.days);
  const live = cliffs.filter((c) => !c.decided_at);
  const passedUndecided = live.filter((c) => c.passed);
  const imminent = live.filter((c) => !c.passed && c.days <= 90);
  const nearer = live.filter((c) => !c.passed && c.days <= 180);

  // The verdict: dated, pre-committed facts only, highest wins.
  let verdict: CategoryVerdict = "gap";
  if (hottest) verdict = pressureBand(hottest.pressure).id;
  if (crossed) {
    const level = crossed.crossed_level;
    verdict = atLeast(verdict, level === "reset" || level === "refresh" ? "severe" : level === "amend" ? "high" : "moderate");
  }
  if (open.length) verdict = atLeast(verdict, "severe");
  if (broken.length) verdict = atLeast(verdict, "severe");
  else if (weakening.length) verdict = atLeast(verdict, "high");
  if (passedUndecided.length) verdict = atLeast(verdict, "high");
  else if (hottest && imminent.length) verdict = atLeast(verdict, "high");
  else if (hottest && nearer.length) verdict = atLeast(verdict, "moderate");

  const cliffLine = (c: RoomCliff) =>
    `the ${c.cliff.kind} cliff “${c.cliff.name}” ${
      c.passed ? `passed ${plural(-c.days, "day")} ago` : `falls in ${plural(c.days, "day")}`
    }${c.decided_at ? ` (decided ${day(c.decided_at)})` : ""}`;

  // Every fact the room could read, ranked as the queue ranks the same condition,
  // so the room never announces a lesser fact over a greater one.
  const facts: Fact[] = [];
  for (const i of open) {
    const key = `int-${i.interrupt.id}`;
    const name = i.interrupt.name;
    facts.push({
      rank: i.overdue ? RANK.interruptOverdue : RANK.interruptOpen,
      headline: `red line fired: ${name}`,
      sentence: `Red line “${name}” has fired${i.overdue ? " and its review deadline has passed" : ""}. ${
        i.interrupt.review_by ? `Review by ${day(i.interrupt.review_by)}.` : "Review within 30 days."
      } Decide, then close it.${queued(key)}${
        !positions.has(key) && i.decided_at ? ` A decision was logged on it on ${day(i.decided_at)}; close the red line.` : ""
      }`,
      note: `red line “${name}” has fired${i.overdue ? ", review overdue" : ""}`,
    });
  }
  if (crossed) {
    const level = crossed.crossed_level;
    const key = `sig-crossed-${crossed.id}`;
    facts.push({
      rank:
        level === "reset"
          ? RANK.crossedReset
          : level === "refresh"
            ? RANK.crossedRefresh
            : level === "amend"
              ? RANK.crossedAmend
              : RANK.crossedWatch,
      headline: `crossed ${level}: ${crossed.name}`,
      sentence: `“${crossed.name}” has crossed its ${level} threshold with a reading of “${
        crossed.current_value || "—"
      }”. That is the pre-committed intensity for this room.${queued(key)}`,
      note: `“${crossed.name}” has crossed its ${level} threshold`,
    });
  }
  if (broken.length) {
    const intensities = [...new Set(broken.map((b) => b.assumption.implied_intensity))];
    const one = broken.length === 1 ? broken[0]! : null;
    const named = intensities.join(" or ");
    facts.push({
      rank: RANK.broken,
      headline: `${plural(broken.length, "bet")} broken`,
      sentence: `${plural(broken.length, "bet")} watched from this room ${broken.length === 1 ? "is" : "are"} broken. ${
        intensities.length === 1 && intensities[0] === "watch"
          ? "Only a watch was pre-committed, and a broken bet needs more than a watch: re-score what it would take, then log the decision."
          : `The pre-committed intensity is ${named}: use ${intensities.length > 1 ? "them" : "it"}, not a quiet watch.`
      }${one ? queued(`asm-${one.assumption.id}`) : ""}${
        one && !positions.has(`asm-${one.assumption.id}`) && one.decided_at
          ? ` A decision was logged on it on ${day(one.decided_at)}.`
          : ""
      }`,
      note: `${plural(broken.length, "bet")} broken`,
    });
  }
  if (weakening.length) {
    facts.push({
      rank: RANK.weakening,
      headline: `${plural(weakening.length, "bet")} weakening`,
      sentence: `${plural(weakening.length, "bet")} watched from this room ${
        weakening.length === 1 ? "is" : "are"
      } weakening. This room is arguing for an amend, not a new study.`,
      note: `${plural(weakening.length, "bet")} weakening`,
    });
  }
  for (const c of live) {
    if (!c.passed && c.days > 180) continue;
    const key = `cliff-${c.cliff.id}`;
    facts.push({
      rank: c.passed || c.days <= 30 ? RANK.cliffSoon : c.days <= 90 ? RANK.cliffNear : RANK.cliffHorizon,
      headline: c.passed ? `cliff passed: ${c.cliff.name}` : `cliff in ${c.days}d: ${c.cliff.name}`,
      sentence: c.passed
        ? `The ${c.cliff.kind} cliff “${c.cliff.name}” passed ${plural(-c.days, "day")} ago with no decision logged since. Decide what replaced it.${queued(key)}`
        : `${plural(c.days, "day")} to the ${c.cliff.kind} cliff “${c.cliff.name}” (${c.cliff.cliff_date}). Decide what follows it before it arrives.${queued(key)}`,
      note: cliffLine(c) + (c.passed ? ", undecided" : ""),
    });
  }
  if (hottest && (verdict === "severe" || verdict === "high") && pressureBand(hottest.pressure).id === verdict) {
    facts.push({
      rank: RANK.sentinelPressure,
      headline: hottest.name,
      sentence: `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Look at this in the sitting even if delivery is on track.`,
      note: `“${hottest.name}” is at ${hottest.pressure}/${PRESSURE_RANGE.max}`,
    });
  }
  if (stale) {
    facts.push({
      rank: stale.layer === "sentinel" ? RANK.staleSentinel : RANK.staleRotating,
      headline: `stale: ${stale.name}`,
      sentence: `“${stale.name}” exists but its evidence is stale. Record a reading before you call this room calm.`,
      note: `“${stale.name}” is stale`,
    });
  }
  facts.sort((a, b) => b.rank - a.rank);
  const top = facts[0] ?? null;

  // Named, but never coloured: nothing here is a dated, pre-committed condition.
  const notes = [
    ...armed.map((i) => `red line “${i.interrupt.name}” is armed`),
    ...cliffs.filter((c) => c.decided_at || (!c.passed && c.days > 180)).map(cliffLine),
  ];

  let headline: string;
  let reading: string;
  let inlineNotes = false;
  if (top) {
    headline = top.headline;
    reading = hottest ? top.sentence : `No watchpoint in this room. ${top.sentence}`;
  } else if (!hottest) {
    headline = "no watchpoint";
    inlineNotes = true;
    reading = `No watchpoint in this room.${notes.length ? ` It is not silent: ${notes.join("; ")}.` : ""} ${guide.ifEmpty}`;
  } else if (unmeasured(hottest)) {
    headline = hottest.name;
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}) rests on a watchpoint with no baseline reading. Record a first reading before you call this room calm.`;
  } else {
    headline = hottest.name;
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Keep watching. Do not reopen the document on this room alone.`;
  }

  // The record of a look stands only where there was nothing to look at.
  const record = (bundle.decisions ?? [])
    .filter((d) => d.item_key === `room-${categoryId}`)
    .sort((a, b) => at(b.decided_at) - at(a.decided_at))[0];
  const reviewed: RoomReview | null =
    record && !signals.length && !open.length && !passedUndecided.length && now - at(record.decided_at) <= ROOM_REVIEW_DAYS * DAY
      ? { at: record.decided_at, author: record.author, rationale: record.rationale }
      : null;
  if (reviewed) reading += ` Reviewed on ${day(reviewed.at)}${reviewed.author ? ` by ${reviewed.author}` : ""}: nothing to watch.`;

  const passages = (bundle.room_passages ?? []).filter((p) => p.category === categoryId);
  const read = (bundle.room_reads ?? []).find((r) => r.category === categoryId) ?? null;
  const roomFindings = (bundle.room_findings ?? []).filter((f) => f.category === categoryId);
  const findings = roomFindings.filter((f) => f.status !== "dismissed");
  const dismissed = roomFindings.filter((f) => f.status === "dismissed");

  // A room nobody watches, that the document itself speaks to, is the worst
  // room on the page. Say so where the reading ends.
  if (!signals.length && passages.length) {
    const where = [...new Set(passages.map((p) => p.locator))].join(", ");
    reading += ` The document speaks here on ${where}, and nothing watches it.`;
  }

  const alsoFacts = [...facts.slice(1).map((f) => f.note), ...(inlineNotes ? [] : notes)];

  return {
    id: guide.id,
    short: guide.short,
    name: guide.name,
    question: guide.question,
    why: guide.why,
    looksFor: guide.looksFor,
    ifEmpty: guide.ifEmpty,
    signals,
    home,
    filed,
    bets,
    assumptions: bets.map((b) => b.assumption),
    interrupts,
    cliffs,
    hottest,
    crossed,
    pressure: hottest?.pressure ?? null,
    band: hottest ? pressureBand(hottest.pressure) : null,
    verdict,
    headline,
    reading,
    also: alsoFacts.length ? `Also here: ${alsoFacts.join("; ")}.` : "",
    reviewed,
    passages,
    read,
    findings,
    dismissed,
  };
}

export function analyzeAllCategories(bundle: StrategyBundle, now = Date.now()) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => analyzeCategory(bundle, id, now));
}

/** Rooms with no active watchpoint, whatever else sits in them. The count stays literal. */
export function roomsWithoutWatchpoint(results: CategoryResult[]) {
  return results.filter((r) => !r.signals.length);
}

/** The one word for a room's state, used on the tile, the card and in exports. */
export function verdictWord(verdict: CategoryVerdict) {
  return verdict === "gap" ? "no watchpoint" : verdict;
}
