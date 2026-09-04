/**
 * Deterministic stand-ins for the language model, Exa and Jina, enabled only
 * when VIGIL_LLM_MOCK=1 outside production. They let the whole pipeline run end
 * to end without a key: parsing, extraction (including multi-pass reads),
 * consolidation, drafting with verifiable quotations, peer research with
 * source checks. They are never used when a real key resolves.
 */
export const MOCK_KEY = "mock";

export type MockTask = "extract" | "consolidate" | "draft" | "peers" | "assess" | "room" | "ping" | "generic";

export function mockEnabled() {
  return process.env.VIGIL_LLM_MOCK === "1" && process.env.NODE_ENV !== "production";
}

/** The built-in key, or any key a tester typed that starts with "mock". */
export function isMockKey(key: string | null | undefined) {
  return mockEnabled() && /^mock(?:$|-)/.test((key ?? "").trim());
}

function section(prompt: string, marker: string): string {
  const i = prompt.indexOf(marker);
  return i < 0 ? "" : prompt.slice(i + marker.length);
}

function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 40 || s.length > 280) continue;
    if (/^[-•*]/.test(s) || /^\d+(\.\d+)*\s*$/.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function cleanLine(line: string): string {
  return line
    .replace(/^-{2,}\s*|\s*-{2,}$/g, "")
    .replace(/^p\.\s*\d+(?:[–-]\d+)?\s*·\s*/, "")
    .trim();
}

function headingsOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = cleanLine(line);
    if (t.length < 6 || t.length > 90) continue;
    const allCaps = /^[A-Z][A-Z0-9\s,&–-]+$/.test(t) && t.split(" ").length > 1;
    if (/^(chapter|annex|part|section|\d+(\.\d+)*\s+[A-Z])/i.test(t) || allCaps) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** The document title: the first short line with letters, as a person would read it. */
function titleOf(text: string): string | null {
  for (const line of text.split("\n").slice(0, 12)) {
    const t = cleanLine(line);
    if (t.length >= 10 && t.length <= 120 && /[A-Za-z]{3}/.test(t) && !/^(chapter|annex)\b/i.test(t)) return t;
  }
  return null;
}

function yearsOf(text: string): number[] {
  const years = new Set<number>();
  for (const m of text.matchAll(/\b(20[2-4]\d)\b/g)) years.add(Number(m[1]));
  return [...years].sort((a, b) => a - b);
}

const OWNERS = ["Ministry of Finance", "Digital agency", "Cabinet office", "Sector regulator", "Statistics office", "Line ministry"];
const INTENSITIES = ["amend", "refresh", "watch", "reset"] as const;
const CADENCES = ["quarterly", "monthly", "annual", "event-driven"] as const;

function mockExtract(prompt: string): string {
  const text = section(prompt, "STRATEGY TEXT:").replace(/^-{5}.*-{5}\s*$/gm, "").trim();
  const sentences = sentencesOf(text);
  const headings = headingsOf(text);
  const years = yearsOf(text);
  const range = text.match(/\b(20[2-4]\d)\s*[–-]\s*(20[2-4]\d)\b/);
  const thisYear = new Date().getFullYear();
  const upcoming = years.filter((y) => y >= thisYear);
  const betLike = sentences.filter((s) => /\b(will|depends|assum|expect|relies|rely|provided|continue|remain)\b/i.test(s));
  const claims = (betLike.length >= 6 ? betLike : sentences).slice(0, 8);
  const partMatch = prompt.match(/PART (\d+) OF (\d+)/i);
  const part = partMatch ? Number(partMatch[1]) : 1;
  const domain = /disaster|hazard|flood|earthquake/i.test(text)
    ? "Disaster risk reduction"
    : /digital|broadband|data|cyber/i.test(text)
      ? "Digital transformation"
      : /climate|emission|adaptation/i.test(text)
        ? "Climate"
        : "National development";
  const assumptions = claims.map((claim, i) => ({
    claim,
    origin: i % 3 === 0 ? "stated" : "implicit",
    implied_intensity: INTENSITIES[i % INTENSITIES.length],
    owner_label: OWNERS[i % OWNERS.length],
  }));
  // Room 8 (Risks) is left without a watchpoint on purpose: the fixture speaks
  // to it plainly, so the gauntlet can prove that material never colours a gap.
  const ROOMS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 1, 2, 4];
  const signals = Array.from({ length: 12 }, (_, i) => {
    const category = ROOMS[i]!;
    const label = headings[i % Math.max(1, headings.length)] ?? `Watchpoint ${i + 1}`;
    return {
      name: `${label.slice(0, 60)} — indicator ${part}.${i + 1}`,
      category,
      secondary_category: i % 4 === 0 ? ((category % 10) + 1) : null,
      layer: i < 6 ? "sentinel" : "rotating",
      materiality: 5 - (i % 3),
      velocity: 2 + (i % 4),
      confidence: 1 + (i % 5),
      cadence: CADENCES[i % CADENCES.length],
      baseline: i % 2 ? "NO BASELINE" : `Baseline ${10 + i}% as stated in ${label.slice(0, 40)}`,
      current_value: i % 2 ? "NO BASELINE" : `${10 + i}`,
      threshold_watch: `${12 + i}`,
      threshold_amend: `${15 + i}`,
      threshold_refresh: `${20 + i}`,
      threshold_reset: i % 3 === 0 ? `${30 + i}` : "",
      false_positive_guard: "A single late report is not a strategy failure.",
      owner_label: OWNERS[(i + 1) % OWNERS.length],
      assumption_indexes: assumptions.length ? [i % assumptions.length] : [],
    };
  });
  const interrupts = [
    { name: "Coordinating body stops sitting", red_line: "No sitting of the coordinating body for six months.", category: 6 },
    { name: "Platform outage", red_line: "A named platform unavailable for more than 14 days.", category: 2 },
    { name: "Funding withdrawn", red_line: "A financing source named in the strategy is withdrawn or cut by more than 30%.", category: 5 },
  ];
  const cliffs = (upcoming.length ? upcoming : years.slice(-2)).slice(0, 2).map((y, i) => ({
    name: i === 0 ? `Funding window closes ${y}` : `Mid-term review ${y}`,
    cliff_date: `${y}-12-31`,
    kind: i === 0 ? "fiscal" : "review",
  }));
  const jurisdiction = text.match(/\bRepublic of ([A-Z][a-z]+)/)?.[0] ?? "";
  return JSON.stringify({
    title: titleOf(text) ?? headings[0] ?? sentences[0]?.slice(0, 80) ?? "Extracted strategy",
    domain,
    jurisdiction,
    vision: sentences.find((s) => /vision|aims|aspire/i.test(s)) ?? sentences[0] ?? "",
    language: "English",
    horizon_start: range ? `${range[1]}-01-01` : years[0] ? `${years[0]}-01-01` : null,
    horizon_end: range ? `${range[2]}-12-31` : years.length > 1 ? `${years[years.length - 1]}-12-31` : null,
    assumptions,
    signals,
    interrupts,
    cliffs,
  });
}

function mockConsolidate(prompt: string): string {
  const raw = section(prompt, "CANDIDATES:").trim();
  try {
    const parts = JSON.parse(raw) as Record<string, unknown>[];
    const merged: Record<string, unknown> = { ...parts[0] };
    const pick = <T>(key: string, by: (x: T) => string, cap: number) => {
      const seen = new Set<string>();
      const out: T[] = [];
      for (const p of parts) {
        for (const item of (p[key] as T[] | undefined) ?? []) {
          const k = by(item).toLowerCase().trim();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push(item);
        }
      }
      return out.slice(0, cap);
    };
    merged.assumptions = pick<{ claim: string }>("assumptions", (a) => a.claim, 12);
    merged.signals = pick<{ name: string }>("signals", (s) => s.name, 16);
    merged.interrupts = pick<{ name: string }>("interrupts", (i) => i.name, 8);
    merged.cliffs = pick<{ name: string }>("cliffs", (c) => c.name, 8);
    return JSON.stringify(merged);
  } catch {
    return raw;
  }
}

function mockDraft(prompt: string): string {
  const excerpts = section(prompt, "ORIGINAL EXCERPTS:").trim();
  const quotes = sentencesOf(excerpts.replace(/^###.*$/gm, "")).slice(0, 2);
  const amendments = quotes.map((q, i) => ({
    intensity: i === 0 ? "amend" : "watch",
    location: `Excerpt ${i + 1}`,
    original_excerpt: q,
    proposed_text: `Replace with: “${q.replace(/\.$/, "")}, reviewed every quarter against the pre-committed thresholds.”`,
    rationale: "The passage names an activity but no condition under which it would change.",
    source: "monitor",
  }));
  amendments.push({
    intensity: "amend",
    location: "Monitoring chapter",
    original_excerpt: "NOT IN TEXT",
    proposed_text: "Insert: “The strategy shall be reopened within 30 days when a pre-committed red line is crossed.”",
    rationale: "The document is silent on event-driven revision.",
    source: "monitor",
  });
  amendments.push({
    intensity: "refresh",
    location: "Financing chapter",
    original_excerpt: "The financing chapter guarantees a successor fund for every package after the current window.",
    proposed_text: "Insert a financing-cliff clause naming the successor envelope.",
    rationale: "Deliberately paraphrased so the quotation check has something to flag.",
    source: "peer",
  });
  return JSON.stringify({ amendments });
}

function mockPeers(prompt: string): string {
  const block = section(prompt, "SEARCH RESULTS:");
  const urls = [...block.matchAll(/^URL:\s*(\S+)/gm)].map((m) => m[1]!);
  const titles = [...block.matchAll(/^\[(\d+)\]\s+(.+?)\s+\(/gm)].map((m) => m[2]!);
  const findings = urls.slice(0, 3).map((url, i) => ({
    source_index: i + 1,
    country: ["Estonia", "Kenya", "Chile"][i],
    title: titles[i] ?? `Peer strategy ${i + 1}`,
    year: "2025",
    url,
    idea: `Name a successor financing envelope and an event-driven review clause (idea ${i + 1}).`,
    relevance: "The strategy under review is silent on both.",
    intensity: ["amend", "watch", "refresh"][i],
    category: [5, 3, 9][i],
  }));
  findings.push({
    source_index: 99,
    country: "Nowhere",
    title: "Invented document",
    year: "2024",
    url: "https://example.invalid/not-a-source",
    idea: "This finding cites no returned source and must be dropped.",
    relevance: "Tests the source check.",
    intensity: "amend",
    category: 1,
  });
  return JSON.stringify({
    summary:
      "Peers publish a named successor envelope and an event-driven reopening clause; this strategy has neither. Do not copy their county-level targets, which rest on a different administrative structure.",
    findings,
  });
}

/** Proposes from what the prompt says is on file: notes and readings colour a bet; the text alone never does. */
function mockAssess(prompt: string): string {
  const betsBlock = section(prompt, "BETS:").split("PASSAGES:")[0] ?? "";
  const passages = section(prompt, "PASSAGES:");
  const bets: Record<string, unknown>[] = [];
  for (const block of betsBlock.split(/^(?=BET \d+:)/m)) {
    const head = block.match(/^BET (\d+): (.+)/);
    if (!head) continue;
    const id = Number(head[1]);
    const now = block.match(/status now: (\w+)/)?.[1] ?? "untested";
    const supporting = Number(block.match(/on file: (\d+) supporting/)?.[1] ?? 0);
    const weakening = Number(block.match(/, (\d+) weakening note/)?.[1] ?? 0);
    const crossed = block.match(/crossed (\w+)/)?.[1];
    const readings = /linked readings: (?!none)/.test(block);
    let status = "untested";
    let restsOn = "The document alone";
    if (now === "broken" && weakening) {
      status = "broken";
      restsOn = "the weakening note on file";
    } else if (weakening || crossed) {
      status = "weakening";
      restsOn = crossed ? `a linked reading that crossed the ${crossed} threshold` : "the weakening note on file";
    } else if (supporting || readings) {
      status = "holding";
      restsOn = supporting ? "the supporting note on file" : "a linked reading";
    }
    bets.push({
      assumption_id: id,
      status,
      note: status === "untested" ? "" : `Desk reading: ${restsOn} supports ${status}.`,
      rests_on: restsOn,
      excerpt: "NOT IN TEXT",
      settles_it: status === "untested" ? "A dated reading from the owner before the next sitting would settle this bet." : "",
    });
  }
  // Quote a real sentence that reports progress, so the server's verification can pass.
  const reported = sentencesOf(passages.replace(/^###.*$/gm, "")).find(
    (s) => /\d/.test(s) && /(percent|%|delivered|completed|on track|absorption|behind schedule)/i.test(s),
  );
  return JSON.stringify({
    delivery: reported
      ? {
          rag: "amber",
          basis: `Stored document reports: ${reported}`,
          source_label: "Stored document, reported figures",
          rests_on: "a reported figure in the stored text",
          excerpt: reported,
        }
      : { rag: "unrated", basis: "No progress report on file.", source_label: "", rests_on: "", excerpt: "NOT IN TEXT" },
    bets,
  });
}

/**
 * One source per room, so an offline test can tell a search built for Resources
 * from a search built for Evidence. Without a tag the fixed peer set is
 * returned, which is what the peer brief expects.
 */
export function mockExaResults(tag: string | undefined, numResults: number): typeof MOCK_EXA_RESULTS {
  if (!tag) return MOCK_EXA_RESULTS.slice(0, numResults);
  return [
    {
      title: `${tag}: national update (offline stand-in)`,
      url: `https://example.org/mock/${tag.toLowerCase()}`,
      text: `An offline stand-in for a search about ${tag}. It reports that the arrangements this room watches were changed during the window, and names no real source.`,
      publishedDate: "2026-06-01",
    },
    ...MOCK_EXA_RESULTS,
  ].slice(0, numResults);
}

/** One grounded finding plus one that cites nothing, so the source check is exercised. */
function mockRoom(prompt: string): string {
  const first = section(prompt, "SOURCES:").match(/^\[1\]\s+(.+?)\s+\(/m);
  const quote = section(prompt, "SOURCES:").split("\n").find((l) => l.startsWith("An offline stand-in")) ?? "";
  return JSON.stringify({
    findings: [
      {
        source_index: 1,
        title: first?.[1] ?? "Offline stand-in source",
        published_date: "2026-06-01",
        quote: quote.trim(),
        why: "The arrangements this room watches were changed inside the window. Nothing is decided until a person turns this into a watchpoint.",
      },
      {
        source_index: 99,
        title: "Invented document",
        published_date: "2026-01-01",
        quote: "This finding cites no returned source and must be dropped.",
        why: "Tests the source check.",
      },
    ],
  });
}

export function mockChat(task: MockTask, prompt: string): string {
  switch (task) {
    case "room":
      return mockRoom(prompt);
    case "extract":
      return mockExtract(prompt);
    case "consolidate":
      return mockConsolidate(prompt);
    case "draft":
      return mockDraft(prompt);
    case "peers":
      return mockPeers(prompt);
    case "assess":
      return mockAssess(prompt);
    case "ping":
      return "pong";
    default:
      return "{}";
  }
}

export const MOCK_EXA_RESULTS = [
  {
    title: "Estonia Digital Agenda 2030 — mid-term evaluation",
    url: "https://example.org/estonia-digital-agenda-2030",
    text: "The agenda names a successor financing envelope for each programme and a clause to reopen the agenda when a red line is crossed.",
    publishedDate: "2025-03-01",
  },
  {
    title: "Kenya National Digital Master Plan 2022–2032",
    url: "https://example.org/kenya-digital-master-plan",
    text: "The plan sets quarterly review sittings and a reach indicator for named vulnerable groups.",
    publishedDate: "2024-11-15",
  },
  {
    title: "Chile Estrategia Nacional de Reducción del Riesgo 2025",
    url: "https://example.org/chile-drr-2025",
    text: "La estrategia fija umbrales de pérdidas como porcentaje del PIB que obligan a revisar el documento.",
    publishedDate: "2025-06-20",
  },
  {
    title: "OECD note on living strategies",
    url: "https://example.org/oecd-living-strategies",
    text: "Comparative evidence on event-driven revision clauses across twelve national strategies.",
    publishedDate: "2025-01-10",
  },
];

export const MOCK_JINA_MARKDOWN = `# National Digital Transformation Strategy 2026–2032 (web edition)

## Vision
By 2032 every resident can reach every public service online within three clicks, and the state runs on shared data platforms.

## Objectives
The strategy depends on a national data exchange that will be in production by 2028. Counties will deliver the connectivity programme on the published timetable. Financing relies on the Digital Fund, which closes on 2029-12-31.

## Monitoring and evaluation
Progress is reported annually to the Digital Council. The action plan is revised every three years. The document does not provide a procedure for reopening the strategy after a platform outage or a funding cliff.
`;
