import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { buildMetrics, buildQueue, withPressure } from "@/lib/compute";
import { ROMANIA_SEED } from "@/lib/sample-romania";
import { BUDGET } from "@/lib/taxonomy";
import { analysisMarkdown, revisionBriefMarkdown } from "@/lib/brief";
import type {
  Amendment,
  Assumption,
  Cliff,
  Decision,
  Evidence,
  Intensity,
  Interrupt,
  PeerFinding,
  PeerResearch,
  Signal,
  Strategy,
  StrategyBundle,
  StrategyDocument,
} from "@/lib/types";

type AssumptionRow = Omit<Assumption, "linked_signal_ids">;
type SignalRow = Omit<Signal, "pressure" | "stale">;

async function assertOwned(userId: string, strategyId: number) {
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    select id from strategies where id = ${strategyId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Strategy not found");
}

export const listStrategies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<Strategy>`
      select id, user_id, title, domain, vision, horizon_start, horizon_end,
             delivery_rag, created_at::text as created_at, updated_at::text as updated_at
      from strategies where user_id = ${context.userId} order by updated_at desc
    `;
  });

export const createStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { title: string; domain?: string; vision?: string; horizon_start?: string; horizon_end?: string }) => input)
  .handler(async ({ context, data }) => {
    const title = data.title.trim();
    if (!title) throw new Error("Title is required");
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      insert into strategies (user_id, title, domain, vision, horizon_start, horizon_end)
      values (
        ${context.userId}, ${title}, ${data.domain ?? ""}, ${data.vision ?? ""},
        ${data.horizon_start || null}, ${data.horizon_end || null}
      )
      returning id
    `;
    return { id: rows[0]!.id };
  });

export const updateStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number; title?: string; domain?: string; vision?: string; delivery_rag?: Strategy["delivery_rag"]; horizon_start?: string | null; horizon_end?: string | null }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.id);
    const sql = await getSql();
    const current = (await sql<Strategy>`select * from strategies where id = ${data.id}`)[0]!;
    await sql`
      update strategies set
        title = ${data.title ?? current.title},
        domain = ${data.domain ?? current.domain},
        vision = ${data.vision ?? current.vision},
        delivery_rag = ${data.delivery_rag ?? current.delivery_rag},
        horizon_start = ${data.horizon_start === undefined ? current.horizon_start : data.horizon_start},
        horizon_end = ${data.horizon_end === undefined ? current.horizon_end : data.horizon_end},
        updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const deleteStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from strategies where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const getStrategyBundle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number }) => input)
  .handler(async ({ context, data }): Promise<StrategyBundle> => {
    await assertOwned(context.userId, data.id);
    const sql = await getSql();
    const strategy = (
      await sql<Strategy>`
        select id, user_id, title, domain, vision, horizon_start, horizon_end,
               delivery_rag, created_at::text as created_at, updated_at::text as updated_at
        from strategies where id = ${data.id} and user_id = ${context.userId}
      `
    )[0]!;
    const assumptionRows = await sql<AssumptionRow>`
      select id, strategy_id, user_id, claim, origin, status, implied_intensity,
             owner_label, last_evidence_at::text as last_evidence_at,
             status_changed_at::text as status_changed_at, sort_order
      from assumptions where strategy_id = ${data.id} and user_id = ${context.userId}
      order by sort_order, id
    `;
    const links = await sql<{ assumption_id: number; signal_id: number }>`
      select assumption_id, signal_id from assumption_signals
      where assumption_id in (select id from assumptions where strategy_id = ${data.id})
    `;
    const assumptions: Assumption[] = assumptionRows.map((a) => ({
      ...a,
      linked_signal_ids: links.filter((l) => l.assumption_id === a.id).map((l) => l.signal_id),
    }));
    const signalRows = await sql<SignalRow>`
      select id, strategy_id, user_id, name, category, secondary_category, layer,
             materiality, velocity, confidence, cadence, baseline, current_value, unit,
             threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
             false_positive_guard, owner_label, status,
             last_evidence_at::text as last_evidence_at, created_at::text as created_at
      from signals where strategy_id = ${data.id} and user_id = ${context.userId}
      order by layer desc, id
    `;
    const signals = signalRows.map(withPressure);
    const interrupts = await sql<Interrupt>`
      select id, strategy_id, name, red_line, fired_at::text as fired_at,
             review_by::text as review_by, status, created_at::text as created_at
      from interrupts where strategy_id = ${data.id} and user_id = ${context.userId}
      order by id
    `;
    const decisions = await sql<Decision>`
      select id, strategy_id, intensity, summary, rationale, signal_id, assumption_id,
             decided_at::text as decided_at
      from decisions where strategy_id = ${data.id} and user_id = ${context.userId}
      order by decided_at desc
    `;
    const cliffs = await sql<Cliff>`
      select id, strategy_id, name, cliff_date, kind
      from cliffs where strategy_id = ${data.id} and user_id = ${context.userId}
      order by cliff_date
    `;
    const evidence = await sql<Evidence>`
      select id, strategy_id, signal_id, assumption_id, note, source_url, direction,
             created_at::text as created_at
      from evidence where strategy_id = ${data.id} and user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    const queue = buildQueue({ strategy, assumptions, signals, interrupts, cliffs });
    const metrics = buildMetrics({ assumptions, signals, cliffs, queueCount: queue.length });
    let documents: StrategyDocument[] = [];
    try {
      documents = await sql<StrategyDocument>`
        select d.id, d.filename, d.kind, d.char_count, d.page_count,
               count(c.id)::int as chunk_count
        from strategy_documents d
        left join document_chunks c on c.document_id = d.id
        where d.strategy_id = ${data.id} and d.user_id = ${context.userId}
        group by d.id
        order by d.id
      `;
    } catch {
      documents = [];
    }
    let amendments: Amendment[] = [];
    try {
      amendments = await sql<Amendment>`
        select id, strategy_id, intensity, location, original_excerpt, proposed_text, rationale,
               assumption_id, source, created_at::text as created_at
        from amendments where strategy_id = ${data.id} and user_id = ${context.userId}
        order by created_at desc, id
      `;
    } catch {
      amendments = [];
    }
    let peer_research: PeerResearch | null = null;
    try {
      const head = await sql<{
        id: number;
        recency_years: number;
        query: string;
        summary: string;
        created_at: string;
      }>`
        select id, recency_years, query, summary, created_at::text as created_at
        from peer_research where strategy_id = ${data.id} and user_id = ${context.userId}
        order by created_at desc limit 1
      `;
      if (head[0]) {
        const findings = await sql<PeerFinding>`
          select id, country, title, year, url, idea, relevance, intensity, category
          from peer_findings where research_id = ${head[0].id} order by id
        `;
        peer_research = { ...head[0], findings };
      }
    } catch {
      peer_research = null;
    }
    return {
      strategy, assumptions, signals, interrupts, decisions, cliffs, evidence,
      documents, amendments, peer_research, queue, metrics,
    };
  });

export const loadRomaniaSample = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const created = await sql<{ id: number }>`
      insert into strategies (user_id, title, domain, vision, horizon_start, horizon_end, delivery_rag)
      values (
        ${context.userId},
        ${ROMANIA_SEED.strategy.title},
        ${ROMANIA_SEED.strategy.domain},
        ${ROMANIA_SEED.strategy.vision},
        ${ROMANIA_SEED.strategy.horizon_start},
        ${ROMANIA_SEED.strategy.horizon_end},
        ${ROMANIA_SEED.strategy.delivery_rag}
      )
      returning id
    `;
    const strategyId = created[0]!.id;
    const assumptionIds: number[] = [];
    for (const a of ROMANIA_SEED.assumptions) {
      const row = await sql<{ id: number }>`
        insert into assumptions (
          strategy_id, user_id, claim, origin, status, implied_intensity, owner_label, sort_order
        ) values (
          ${strategyId}, ${context.userId}, ${a.claim}, ${a.origin}, ${a.status},
          ${a.implied_intensity}, ${a.owner_label}, ${a.sort_order}
        ) returning id
      `;
      assumptionIds.push(row[0]!.id);
    }
    const signalIds: number[] = [];
    for (const s of ROMANIA_SEED.signals) {
      const row = await sql<{ id: number }>`
        insert into signals (
          strategy_id, user_id, name, category, secondary_category, layer,
          materiality, velocity, confidence, cadence, baseline, current_value, unit,
          threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
          false_positive_guard, owner_label, status
        ) values (
          ${strategyId}, ${context.userId}, ${s.name}, ${s.category}, ${s.secondary_category},
          ${s.layer}, ${s.materiality}, ${s.velocity}, ${s.confidence}, ${s.cadence},
          ${s.baseline}, ${s.current_value}, ${s.unit}, ${s.threshold_watch}, ${s.threshold_amend},
          ${s.threshold_refresh}, ${s.threshold_reset}, ${s.false_positive_guard}, ${s.owner_label},
          'active'
        ) returning id
      `;
      signalIds.push(row[0]!.id);
      for (const sort of s.links) {
        const aId = assumptionIds[sort - 1];
        if (!aId) continue;
        await sql`
          insert into assumption_signals (assumption_id, signal_id)
          values (${aId}, ${row[0]!.id})
          on conflict do nothing
        `;
      }
    }
    for (const i of ROMANIA_SEED.interrupts) {
      await sql`
        insert into interrupts (strategy_id, user_id, name, red_line, status)
        values (${strategyId}, ${context.userId}, ${i.name}, ${i.red_line}, 'armed')
      `;
    }
    for (const c of ROMANIA_SEED.cliffs) {
      await sql`
        insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
        values (${strategyId}, ${context.userId}, ${c.name}, ${c.cliff_date}, ${c.kind})
      `;
    }
    for (const e of ROMANIA_SEED.evidence) {
      const aId = assumptionIds[e.assumption_sort - 1];
      if (!aId) continue;
      await sql`
        insert into evidence (strategy_id, user_id, assumption_id, note, source_url, direction)
        values (${strategyId}, ${context.userId}, ${aId}, ${e.note}, ${e.source_url}, ${e.direction})
      `;
      await sql`update assumptions set last_evidence_at = now() where id = ${aId}`;
    }
    if (ROMANIA_SEED.excerpts.length) {
      const doc = await sql<{ id: number }>`
        insert into strategy_documents (strategy_id, user_id, filename, kind, char_count, page_count)
        values (
          ${strategyId}, ${context.userId},
          'SNRRD 2024-2035 (seeded excerpts)', 'text',
          ${ROMANIA_SEED.excerpts.reduce((n, e) => n + e.body.length, 0)},
          null
        ) returning id
      `;
      let idx = 0;
      for (const ex of ROMANIA_SEED.excerpts) {
        await sql`
          insert into document_chunks (document_id, chunk_index, heading, body)
          values (${doc[0]!.id}, ${idx}, ${ex.heading}, ${ex.body})
        `;
        idx += 1;
      }
    }
    for (const a of ROMANIA_SEED.amendments) {
      await sql`
        insert into amendments (
          strategy_id, user_id, intensity, location, original_excerpt, proposed_text, rationale, source
        ) values (
          ${strategyId}, ${context.userId}, ${a.intensity}, ${a.location},
          ${a.original_excerpt}, ${a.proposed_text}, ${a.rationale}, ${a.source}
        )
      `;
    }
    return { id: strategyId };
  });

export const upsertAssumption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    strategy_id: number;
    id?: number;
    claim: string;
    origin: Assumption["origin"];
    status: Assumption["status"];
    implied_intensity: Assumption["implied_intensity"];
    owner_label?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    if (!data.id) {
      const count = await sql<{ n: number }>`
        select count(*)::int as n from assumptions
        where strategy_id = ${data.strategy_id} and user_id = ${context.userId}
      `;
      if ((count[0]?.n ?? 0) >= BUDGET.maxAssumptions) {
        throw new Error(`Assumption budget is ${BUDGET.maxAssumptions}. Retire one first.`);
      }
    }
    if (data.id) {
      await sql`
        update assumptions set
          claim = ${data.claim}, origin = ${data.origin},
          status = ${data.status}, implied_intensity = ${data.implied_intensity},
          owner_label = ${data.owner_label ?? ""},
          status_changed_at = case when status is distinct from ${data.status} then now() else status_changed_at end
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const row = await sql<{ id: number }>`
      insert into assumptions (strategy_id, user_id, claim, origin, status, implied_intensity, owner_label)
      values (${data.strategy_id}, ${context.userId}, ${data.claim}, ${data.origin}, ${data.status}, ${data.implied_intensity}, ${data.owner_label ?? ""})
      returning id
    `;
    return { id: row[0]!.id };
  });

export const upsertSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    strategy_id: number;
    id?: number;
    name: string;
    category: number;
    secondary_category?: number | null;
    layer: Signal["layer"];
    materiality: number;
    velocity: number;
    confidence: number;
    cadence: string;
    baseline?: string;
    current_value?: string;
    unit?: string;
    threshold_watch?: string;
    threshold_amend?: string;
    threshold_refresh?: string;
    threshold_reset?: string;
    false_positive_guard?: string;
    owner_label?: string;
    status?: Signal["status"];
    linked_assumption_ids?: number[];
  }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    const status = data.status ?? "active";
    if (!data.id) {
      const counts = await sql<{ active: number; sentinels: number }>`
        select
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'active' and layer = 'sentinel')::int as sentinels
        from signals where strategy_id = ${data.strategy_id} and user_id = ${context.userId}
      `;
      if ((counts[0]?.active ?? 0) >= BUDGET.maxActiveSignals) {
        throw new Error(`Active signal budget is ${BUDGET.maxActiveSignals}. Retire one first.`);
      }
      if (data.layer === "sentinel" && (counts[0]?.sentinels ?? 0) >= BUDGET.maxSentinels) {
        throw new Error(`Sentinel budget is ${BUDGET.maxSentinels}.`);
      }
    }
    let id = data.id;
    if (id) {
      await sql`
        update signals set
          name = ${data.name}, category = ${data.category},
          secondary_category = ${data.secondary_category ?? null},
          layer = ${data.layer}, materiality = ${data.materiality},
          velocity = ${data.velocity}, confidence = ${data.confidence},
          cadence = ${data.cadence}, baseline = ${data.baseline ?? ""},
          current_value = ${data.current_value ?? ""}, unit = ${data.unit ?? ""},
          threshold_watch = ${data.threshold_watch ?? ""},
          threshold_amend = ${data.threshold_amend ?? ""},
          threshold_refresh = ${data.threshold_refresh ?? ""},
          threshold_reset = ${data.threshold_reset ?? ""},
          false_positive_guard = ${data.false_positive_guard ?? ""},
          owner_label = ${data.owner_label ?? ""}, status = ${status}
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      const row = await sql<{ id: number }>`
        insert into signals (
          strategy_id, user_id, name, category, secondary_category, layer,
          materiality, velocity, confidence, cadence, baseline, current_value, unit,
          threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
          false_positive_guard, owner_label, status
        ) values (
          ${data.strategy_id}, ${context.userId}, ${data.name}, ${data.category},
          ${data.secondary_category ?? null}, ${data.layer}, ${data.materiality},
          ${data.velocity}, ${data.confidence}, ${data.cadence}, ${data.baseline ?? ""},
          ${data.current_value ?? ""}, ${data.unit ?? ""}, ${data.threshold_watch ?? ""},
          ${data.threshold_amend ?? ""}, ${data.threshold_refresh ?? ""},
          ${data.threshold_reset ?? ""}, ${data.false_positive_guard ?? ""},
          ${data.owner_label ?? ""}, ${status}
        ) returning id
      `;
      id = row[0]!.id;
    }
    if (data.linked_assumption_ids) {
      await sql`delete from assumption_signals where signal_id = ${id}`;
      for (const aId of data.linked_assumption_ids) {
        await sql`
          insert into assumption_signals (assumption_id, signal_id)
          values (${aId}, ${id}) on conflict do nothing
        `;
      }
    }
    return { id: id! };
  });

export const addEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    strategy_id: number;
    note: string;
    source_url?: string;
    direction: Evidence["direction"];
    signal_id?: number | null;
    assumption_id?: number | null;
  }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    await sql`
      insert into evidence (strategy_id, user_id, signal_id, assumption_id, note, source_url, direction)
      values (
        ${data.strategy_id}, ${context.userId}, ${data.signal_id ?? null},
        ${data.assumption_id ?? null}, ${data.note}, ${data.source_url ?? ""}, ${data.direction}
      )
    `;
    if (data.signal_id) {
      await sql`update signals set last_evidence_at = now() where id = ${data.signal_id} and user_id = ${context.userId}`;
    }
    if (data.assumption_id) {
      await sql`update assumptions set last_evidence_at = now() where id = ${data.assumption_id} and user_id = ${context.userId}`;
    }
    return { ok: true as const };
  });

export const fireInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number; strategy_id: number; review_days?: number }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    const days = data.review_days ?? 30;
    const reviewBy = new Date(Date.now() + days * 86400000).toISOString();
    await sql`
      update interrupts
      set status = 'open', fired_at = now(), review_by = ${reviewBy}::timestamptz
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const closeInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number; strategy_id: number }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    await sql`
      update interrupts set status = 'closed'
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const logDecision = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    strategy_id: number;
    intensity: Intensity;
    summary: string;
    rationale: string;
    signal_id?: number | null;
    assumption_id?: number | null;
  }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    if (!data.rationale.trim()) throw new Error("A rationale is required");
    const sql = await getSql();
    await sql`
      insert into decisions (strategy_id, user_id, intensity, summary, rationale, signal_id, assumption_id)
      values (
        ${data.strategy_id}, ${context.userId}, ${data.intensity}, ${data.summary},
        ${data.rationale}, ${data.signal_id ?? null}, ${data.assumption_id ?? null}
      )
    `;
    return { ok: true as const };
  });

export const addCliff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { strategy_id: number; name: string; cliff_date: string; kind: Cliff["kind"] }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    await sql`
      insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
      values (${data.strategy_id}, ${context.userId}, ${data.name}, ${data.cliff_date}, ${data.kind})
    `;
    return { ok: true as const };
  });

export const addInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { strategy_id: number; name: string; red_line: string }) => input)
  .handler(async ({ context, data }) => {
    await assertOwned(context.userId, data.strategy_id);
    const sql = await getSql();
    await sql`
      insert into interrupts (strategy_id, user_id, name, red_line, status)
      values (${data.strategy_id}, ${context.userId}, ${data.name}, ${data.red_line}, 'armed')
    `;
    return { ok: true as const };
  });

export const exportAnalysis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: number }) => input)
  .handler(async ({ data }) => {
    const bundle = await getStrategyBundle({ data: { id: data.id } });
    return {
      title: bundle.strategy.title,
      analysis: analysisMarkdown(bundle),
      brief: revisionBriefMarkdown(bundle),
    };
  });
