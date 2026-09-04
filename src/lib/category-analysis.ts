import { categoryGuide } from "./category-guide.ts";
import { DAY, latestDecisions } from "./compute.ts";
import {
  INTENSITY_ORDER,
  PRESSURE_RANGE,
  pressureBand,
  roomOfCliff,
  roomOfInterrupt,
} from "./taxonomy.ts";
import type { Assumption, Cliff, Interrupt, Signal, StrategyBundle } from "./types.ts";

/**
 * A room is the method's coverage instrument: every strategy is read through
 * the same ten. What sits in a room, and what its verdict may rest on:
 *
 * - Watchpoints sit in the room they were given (primary), and are also listed
 *   in their second room, marked as filed there. Pressure and crossed
 *   thresholds count in both.
 * - Bets have no room of their own. A bet is shown in a room only through an
 *   active watchpoint whose home room this is; bet status colours a room only
 *   that way, never through a filing.
 * - Red lines sit in the room they were given; one with no room reads in Risks.
 * - Cliffs sit by kind (fiscal → Resources, legal → Mandate, review →
 *   Assumptions, scenario → Risks).
 *
 * A room with no active watchpoint is a gap, not calm. Only a fired red line or
 * a passed, undecided cliff overrides that; an armed red line or a cliff on the
 * horizon is named in a second sentence and colours nothing.
 */

export type CategoryVerdict = "gap" | "quiet" | "moderate" | "high" | "severe";

/** A bet shown in a room, and the home watchpoints that put it there. */
export type RoomBet = { assumption: Assumption; via: Signal[]; decided_at: string | null };
export type RoomInterrupt = {
  interrupt: Interrupt;
  room_set: boolean;
  overdue: boolean;
  decided_at: string | null;
};
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
  /** Armed red lines and cliffs on the horizon that the reading did not use. Empty when there are none. */
  also: string;
  reviewed: RoomReview | null;
};

const VERDICT_ORDER: Record<CategoryVerdict, number> = {
  gap: 0,
  quiet: 1,
  moderate: 2,
  high: 3,
  severe: 4,
};

function atLeast(a: CategoryVerdict, b: CategoryVerdict): CategoryVerdict {
  return VERDICT_ORDER[a] >= VERDICT_ORDER[b] ? a : b;
}

function at(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function dayOf(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const t = typeof value === "number" ? value : at(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(value);
}

function isoOf(t: number | undefined): string | null {
  return t !== undefined && Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Signals active in a room, by primary or secondary category. */
export function signalsInCategory(signals: Signal[], categoryId: number) {
  return signals.filter(
    (s) =>
      s.status === "active" && (s.category === categoryId || s.secondary_category === categoryId),
  );
}

/** Bets with no active watchpoint at all. They sit in no room, which is the deepest blind spot. */
export function unwatchedBets(
  bundle: Pick<StrategyBundle, "assumptions" | "signals">,
): Assumption[] {
  const active = new Set(bundle.signals.filter((s) => s.status === "active").map((s) => s.id));
  return bundle.assumptions.filter((a) => !a.linked_signal_ids.some((id) => active.has(id)));
}

/** A reading with no number in it is unmeasured, which the method treats as a reason to look harder. */
export function unmeasured(signal: Pick<Signal, "current_value">) {
  const v = signal.current_value.trim();
  return !v || /no baseline/i.test(v);
}

export function analyzeCategory(
  bundle: StrategyBundle,
  categoryId: number,
  now = Date.now(),
): CategoryResult {
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
      .sort((a, b) => INTENSITY_ORDER[b.crossed_level] - INTENSITY_ORDER[a.crossed_level])[0] ??
    null;

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
        room_set: i.category != null,
        overdue: i.status === "open" && Number.isFinite(reviewBy) && reviewBy < now,
        decided_at: i.status === "open" ? loggedAfter(`int-${i.id}`, fired) : null,
      };
    });
  const open = interrupts.filter((i) => i.interrupt.status === "open");
  const armed = interrupts.filter((i) => i.interrupt.status === "armed");

  const cliffs: RoomCliff[] = (bundle.cliffs ?? [])
    .filter((c) => roomOfCliff(c) === categoryId && Number.isFinite(at(c.cliff_date)))
    .map((c) => {
      const t = at(c.cliff_date);
      const days = Math.round((t - now) / DAY);
      const passed = days < 0;
      // The same rule as the queue: a decision after a passed cliff settles it; on an
      // approaching cliff a decision holds for a month.
      return {
        cliff: c,
        days,
        passed,
        decided_at: loggedAfter(`cliff-${c.id}`, passed ? t : now - 30 * DAY),
      };
    })
    .sort((a, b) => a.days - b.days);
  const passedUndecided = cliffs.filter((c) => c.passed && !c.decided_at);
  const imminent = cliffs.filter((c) => !c.passed && !c.decided_at && c.days <= 90);
  const nearer = cliffs.filter((c) => !c.passed && !c.decided_at && c.days <= 180);

  const review = (bundle.decisions ?? [])
    .filter((d) => d.item_key === `room-${categoryId}`)
    .sort((a, b) => at(b.decided_at) - at(a.decided_at))[0];
  const reviewed: RoomReview | null =
    review && now - at(review.decided_at) <= ROOM_REVIEW_DAYS * DAY
      ? { at: review.decided_at, author: review.author, rationale: review.rationale }
      : null;

  // The verdict: dated, pre-committed facts only, highest wins.
  let verdict: CategoryVerdict = "gap";
  if (hottest) verdict = pressureBand(hottest.pressure).id;
  if (crossed) {
    const level = crossed.crossed_level;
    verdict = atLeast(
      verdict,
      level === "reset" || level === "refresh" ? "severe" : level === "amend" ? "high" : "moderate",
    );
  }
  if (open.length) verdict = atLeast(verdict, "severe");
  if (broken.length) verdict = atLeast(verdict, "severe");
  else if (weakening.length) verdict = atLeast(verdict, "high");
  if (passedUndecided.length) verdict = atLeast(verdict, "high");
  else if (hottest && imminent.length) verdict = atLeast(verdict, "high");
  else if (hottest && nearer.length) verdict = atLeast(verdict, "moderate");

  const intensities = [...new Set(broken.map((b) => b.assumption.implied_intensity))].join(" or ");
  const cliffLine = (c: RoomCliff) =>
    c.passed
      ? `the ${c.cliff.kind} cliff “${c.cliff.name}” passed ${plural(-c.days, "day")} ago${c.decided_at ? ` (decided ${dayOf(c.decided_at)})` : ""}`
      : `the ${c.cliff.kind} cliff “${c.cliff.name}” falls in ${plural(c.days, "day")}${c.decided_at ? ` (decided ${dayOf(c.decided_at)})` : ""}`;

  let headline: string;
  let reading: string;
  const used = new Set<string>();
  if (open.length) {
    const i = open[0]!;
    used.add(`int-${i.interrupt.id}`);
    headline = `red line fired: ${i.interrupt.name}`;
    reading = `Red line “${i.interrupt.name}” has fired${i.overdue ? " and its review deadline has passed" : ""}. ${
      i.interrupt.review_by
        ? `Review by ${dayOf(i.interrupt.review_by)}.`
        : "Review within 30 days."
    } Decide, then close it.${queued(`int-${i.interrupt.id}`)}${
      !positions.has(`int-${i.interrupt.id}`) && i.decided_at
        ? ` A decision was logged on it on ${dayOf(i.decided_at)}; close the red line.`
        : ""
    }`;
  } else if (!hottest) {
    const facts = [
      ...armed.map((i) => `red line “${i.interrupt.name}” is armed`),
      ...cliffs.filter((c) => c.passed || c.days <= 180).map(cliffLine),
    ];
    const first = passedUndecided[0];
    headline = first
      ? `cliff passed: ${first.cliff.name}`
      : armed.length
        ? `${plural(armed.length, "red line")} armed`
        : cliffs[0]
          ? `cliff: ${cliffs[0].cliff.name}`
          : "No active signal";
    reading = first
      ? `No watchpoint in this room, and ${cliffLine(first)} with no decision logged since. Decide what replaced it.${queued(`cliff-${first.cliff.id}`)}${
          facts.length > 1
            ? ` Also here: ${facts.filter((f) => !f.includes(`“${first.cliff.name}”`)).join("; ")}.`
            : ""
        }`
      : `No watchpoint in this room.${facts.length ? ` It is not silent: ${facts.join("; ")}.` : ""} ${guide.ifEmpty}`;
    if (reviewed)
      reading += ` Reviewed on ${dayOf(reviewed.at)}${reviewed.author ? ` by ${reviewed.author}` : ""}: nothing to watch.`;
    cliffs.forEach((c) => used.add(`cliff-${c.cliff.id}`));
    armed.forEach((i) => used.add(`int-${i.interrupt.id}`));
  } else if (crossed) {
    used.add(`sig-crossed-${crossed.id}`);
    headline = `crossed ${crossed.crossed_level}: ${crossed.name}`;
    reading = `“${crossed.name}” has crossed its ${crossed.crossed_level} threshold with a reading of “${
      crossed.current_value || "—"
    }”. That is the pre-committed intensity for this room.${queued(`sig-crossed-${crossed.id}`)}`;
  } else if (broken.length) {
    headline = `${plural(broken.length, "bet")} broken`;
    const one = broken.length === 1 ? broken[0]! : null;
    reading = `${plural(broken.length, "bet")} watched from this room ${broken.length === 1 ? "is" : "are"} broken. The pre-committed intensity is ${intensities}: use it, not a quiet watch.${
      one ? queued(`asm-${one.assumption.id}`) : ""
    }${one && !positions.has(`asm-${one.assumption.id}`) && one.decided_at ? ` A decision was logged on it on ${dayOf(one.decided_at)}.` : ""}`;
  } else if (passedUndecided.length || imminent.length) {
    const c = (passedUndecided[0] ?? imminent[0])!;
    used.add(`cliff-${c.cliff.id}`);
    headline = c.passed ? `cliff passed: ${c.cliff.name}` : `cliff in ${c.days}d: ${c.cliff.name}`;
    reading = c.passed
      ? `The ${c.cliff.kind} cliff “${c.cliff.name}” passed ${plural(-c.days, "day")} ago with no decision logged since. Decide what replaced it.${queued(`cliff-${c.cliff.id}`)}`
      : `${plural(c.days, "day")} to the ${c.cliff.kind} cliff “${c.cliff.name}” (${c.cliff.cliff_date}). Decide what follows it before it arrives.${queued(`cliff-${c.cliff.id}`)}`;
  } else if (weakening.length) {
    headline = `${plural(weakening.length, "bet")} weakening`;
    reading = `${plural(weakening.length, "bet")} watched from this room ${weakening.length === 1 ? "is" : "are"} weakening. This room is arguing for an amend, not a new study.`;
  } else if (verdict === "severe" || verdict === "high") {
    headline = hottest.name;
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Look at this in the sitting even if delivery is on track.`;
  } else if (hottest.stale) {
    headline = hottest.name;
    reading = `The watchpoint exists but the evidence is stale. Record a reading before you claim this room is calm.`;
  } else if (unmeasured(hottest)) {
    headline = hottest.name;
    reading = `“${hottest.name}” has no baseline reading. That is unmeasured, not calm. Record a first reading.`;
  } else {
    headline = hottest.name;
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Keep watching. Do not reopen the document on this room alone.`;
  }

  const alsoFacts = [
    ...armed
      .filter((i) => !used.has(`int-${i.interrupt.id}`))
      .map((i) => `red line “${i.interrupt.name}” armed`),
    ...cliffs
      .filter((c) => !used.has(`cliff-${c.cliff.id}`) && (c.passed || c.days <= 180))
      .map(cliffLine),
  ];
  const also = alsoFacts.length ? `Also here: ${alsoFacts.join("; ")}.` : "";

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
    also,
    reviewed,
  };
}

export function analyzeAllCategories(bundle: StrategyBundle, now = Date.now()) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => analyzeCategory(bundle, id, now));
}

/** Rooms with no active watchpoint, whatever else sits in them. The count stays literal. */
export function roomsWithoutWatchpoint(results: CategoryResult[]) {
  return results.filter((r) => !r.signals.length);
}
