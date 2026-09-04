import { categoryGuide } from "./category-guide.ts";
import { INTENSITY_ORDER, PRESSURE_RANGE, pressureBand } from "./taxonomy.ts";
import type { Assumption, Signal, StrategyBundle } from "./types.ts";

export type CategoryVerdict = "gap" | "quiet" | "moderate" | "high" | "severe";

export type CategoryResult = {
  id: number;
  short: string;
  name: string;
  question: string;
  why: string;
  looksFor: string;
  example: string;
  ifEmpty: string;
  signals: Signal[];
  assumptions: Assumption[];
  hottest: Signal | null;
  /** The signal whose reading has crossed the highest threshold in this room, if any. */
  crossed: Signal | null;
  pressure: number | null;
  band: ReturnType<typeof pressureBand> | null;
  verdict: CategoryVerdict;
  reading: string;
};

const VERDICT_ORDER: Record<CategoryVerdict, number> = { gap: 0, quiet: 1, moderate: 2, high: 3, severe: 4 };

function atLeast(a: CategoryVerdict, b: CategoryVerdict): CategoryVerdict {
  return VERDICT_ORDER[a] >= VERDICT_ORDER[b] ? a : b;
}

/** Signals active in a room, by primary or secondary category. */
export function signalsInCategory(signals: Signal[], categoryId: number) {
  return signals.filter(
    (s) => s.status === "active" && (s.category === categoryId || s.secondary_category === categoryId),
  );
}

export function analyzeCategory(bundle: StrategyBundle, categoryId: number): CategoryResult {
  const guide = categoryGuide(categoryId);
  const signals = signalsInCategory(bundle.signals, categoryId);
  const hottest = [...signals].sort((a, b) => b.pressure - a.pressure)[0] ?? null;
  const crossed =
    [...signals]
      .filter((s) => s.crossed_level !== "none")
      .sort((a, b) => INTENSITY_ORDER[b.crossed_level] - INTENSITY_ORDER[a.crossed_level])[0] ?? null;
  const signalIds = new Set(signals.map((s) => s.id));
  const assumptions = bundle.assumptions.filter((a) => a.linked_signal_ids.some((id) => signalIds.has(id)));
  const broken = assumptions.filter((a) => a.status === "broken");
  const weakening = assumptions.filter((a) => a.status === "weakening");

  let verdict: CategoryVerdict = "gap";
  if (hottest) verdict = pressureBand(hottest.pressure).id;
  if (crossed) {
    const level = crossed.crossed_level;
    verdict = atLeast(
      verdict,
      level === "reset" || level === "refresh" ? "severe" : level === "amend" ? "high" : "moderate",
    );
  }
  if (broken.length) verdict = atLeast(verdict, "severe");
  else if (weakening.length) verdict = atLeast(verdict, "high");

  let reading: string;
  if (!hottest) {
    reading = `No watchpoint in this room. ${guide.ifEmpty}`;
  } else if (crossed) {
    reading = `“${crossed.name}” has crossed its ${crossed.crossed_level} threshold with a reading of “${crossed.current_value || "—"}”. That is the pre-committed intensity for this room; it is in the queue.`;
  } else if (broken.length) {
    reading = `${broken.length} linked bet${broken.length > 1 ? "s are" : " is"} broken. Use the pre-committed intensity (usually refresh or reset), not a quiet watch.`;
  } else if (weakening.length) {
    reading = `${weakening.length} linked bet${weakening.length > 1 ? "s are" : " is"} weakening. This room is arguing for an amend, not a new study.`;
  } else if (verdict === "severe" || verdict === "high") {
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Look at this in the sitting even if delivery is on track.`;
  } else if (hottest.stale) {
    reading = `The watchpoint exists but the evidence is stale. Record a reading before you claim this room is calm.`;
  } else {
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Keep watching. Do not reopen the document on this room alone.`;
  }

  return {
    id: guide.id,
    short: guide.short,
    name: guide.name,
    question: guide.question,
    why: guide.why,
    looksFor: guide.looksFor,
    example: guide.example,
    ifEmpty: guide.ifEmpty,
    signals,
    assumptions,
    hottest,
    crossed,
    pressure: hottest?.pressure ?? null,
    band: hottest ? pressureBand(hottest.pressure) : null,
    verdict,
    reading,
  };
}

export function analyzeAllCategories(bundle: StrategyBundle) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => analyzeCategory(bundle, id));
}
