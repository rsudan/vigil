import { categoryGuide } from "./category-guide";
import { PRESSURE_RANGE, pressureBand } from "./taxonomy";
import type { Assumption, Signal, StrategyBundle } from "./types";

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
  pressure: number | null;
  band: ReturnType<typeof pressureBand> | null;
  verdict: CategoryVerdict;
  reading: string;
};

export function analyzeCategory(bundle: StrategyBundle, categoryId: number): CategoryResult {
  const guide = categoryGuide(categoryId);
  const signals = bundle.signals.filter(
    (s) => s.status === "active" && (s.category === categoryId || s.secondary_category === categoryId),
  );
  const hottest = [...signals].sort((a, b) => b.pressure - a.pressure)[0] ?? null;
  const signalIds = new Set(signals.map((s) => s.id));
  const assumptions = bundle.assumptions.filter((a) => a.linked_signal_ids.some((id) => signalIds.has(id)));
  const broken = assumptions.filter((a) => a.status === "broken");
  const weakening = assumptions.filter((a) => a.status === "weakening");

  let verdict: CategoryVerdict = "gap";
  if (hottest) {
    const band = pressureBand(hottest.pressure).id;
    verdict = band === "quiet" ? "quiet" : band;
  }

  let reading: string;
  if (!hottest) {
    reading = `Blind spot. ${guide.ifEmpty}`;
  } else if (broken.length) {
    reading = `${broken.length} linked bet${broken.length > 1 ? "s are" : " is"} broken. Use the pre-committed intensity (usually refresh or reset), not a quiet watch.`;
  } else if (weakening.length) {
    reading = `${weakening.length} linked bet${weakening.length > 1 ? "s are" : " is"} weakening. This category is arguing for an amend, not a new study.`;
  } else if (verdict === "severe" || verdict === "high") {
    reading = `Pressure ${hottest.pressure}/${PRESSURE_RANGE.max} (${verdict}). Look at this in the sitting even if delivery is on track.`;
  } else if (hottest.stale) {
    reading = `The watchpoint exists but the evidence is stale. Refresh the number before you claim this room is calm.`;
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
    pressure: hottest?.pressure ?? null,
    band: hottest ? pressureBand(hottest.pressure) : null,
    verdict,
    reading,
  };
}

export function analyzeAllCategories(bundle: StrategyBundle) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => analyzeCategory(bundle, id));
}
