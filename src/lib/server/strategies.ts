import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { buildMetrics, buildQueue, validityOf, withPressure } from "@/lib/compute";
import { ROMANIA_SEED } from "@/lib/sample-romania";
import { BUDGET, type EvidenceDirection, type MemberRole, type RatingMethod } from "@/lib/taxonomy";
import { assertAccess } from "@/lib/server/access";
import { findUserByEmail } from "@/lib/server/profiles";
import { strategies as schema, validate } from "@/lib/server/schemas";
import type {
  Amendment,
  Assumption,
  Attention,
  Cliff,
  Decision,
  DeliveryRating,
  Evidence,
  Interrupt,
  Member,
  PeerFinding,
  PeerResearch,
  RoomFinding,
  RoomPassage,
  RoomRead,
  Signal,
  Strategy,
  StrategyBundle,
  StrategyDocument,
  StrategySummary,
} from "@/lib/types";

type AssumptionRow = Omit<Assumption, "linked_signal_ids">;
type SignalRow = Omit<Signal, "pressure" | "stale">;

async function touch(sql: Sql, strategyId: number) {
  await sql`update strategies set updated_at = now() where id = ${strategyId}`;
}

async function loadStrategy(sql: Sql, id: number): Promise<Strategy> {
  const rows = await sql<Strategy>`
    select id, user_id, title, domain, vision, language, jurisdiction, extraction_note, horizon_start, horizon_end,
           delivery_rag, created_at::text as created_at, updated_at::text as updated_at
    from strategies where id = ${id}
  `;
  if (!rows[0]) throw new Error("Strategy not found");
  return rows[0];
}

/**
 * Everything one workspace needs. Access is checked once here; child rows are
 * read by strategy, not by author, so shared members see the same picture.
 */
export async function loadBundle(
  userId: string,
  strategyId: number,
  opts: { sql?: Sql; role?: MemberRole } = {},
): Promise<StrategyBundle> {
  const sql = opts.sql ?? (await getSql());
  const role = opts.role ?? (await assertAccess(userId, strategyId, "viewer", sql));
  const strategy = await loadStrategy(sql, strategyId);

  const assumptionRows = await sql<AssumptionRow>`
    select id, strategy_id, user_id, claim, origin, status, implied_intensity,
           owner_label, last_evidence_at::text as last_evidence_at,
           status_changed_at::text as status_changed_at, sort_order
    from assumptions where strategy_id = ${strategyId}
    order by sort_order, id
  `;
  const links = await sql<{ assumption_id: number; signal_id: number }>`
    select l.assumption_id, l.signal_id from assumption_signals l
    join assumptions a on a.id = l.assumption_id
    where a.strategy_id = ${strategyId}
  `;
  const assumptions: Assumption[] = assumptionRows.map((a) => ({
    ...a,
    linked_signal_ids: links.filter((l) => l.assumption_id === a.id).map((l) => l.signal_id),
  }));
  const signalRows = await sql<SignalRow>`
    select id, strategy_id, user_id, name, category, secondary_category, layer,
           materiality, velocity, confidence, cadence, baseline, current_value, unit,
           threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
           false_positive_guard, owner_label, status, crossed_level,
           last_evidence_at::text as last_evidence_at, created_at::text as created_at,
           updated_at::text as updated_at
    from signals where strategy_id = ${strategyId}
    order by layer desc, id
  `;
  const signals = signalRows.map((row) => withPressure(row));
  const interrupts = await sql<Interrupt>`
    select id, strategy_id, name, red_line, category, fired_at::text as fired_at,
           review_by::text as review_by, status, created_at::text as created_at
    from interrupts where strategy_id = ${strategyId}
    order by id
  `;
  const decisions = await sql<Decision>`
    select d.id, d.strategy_id, d.user_id, d.intensity, d.summary, d.rationale, d.item_key,
           d.signal_id, d.assumption_id, d.decided_at::text as decided_at,
           coalesce(p.display_name, p.email) as author
    from decisions d
    left join profiles p on p.user_id = d.user_id
    where d.strategy_id = ${strategyId}
    order by d.decided_at desc, d.id desc
  `;
  const cliffs = await sql<Cliff>`
    select id, strategy_id, name, cliff_date, kind
    from cliffs where strategy_id = ${strategyId}
    order by cliff_date
  `;
  const evidence = await sql<Evidence>`
    select e.id, e.strategy_id, e.user_id, e.signal_id, e.assumption_id, e.note, e.reading,
           e.source_url, e.direction, e.method, e.created_at::text as created_at,
           coalesce(p.display_name, p.email) as author
    from evidence e
    left join profiles p on p.user_id = e.user_id
    where e.strategy_id = ${strategyId}
    order by e.created_at desc, e.id desc
    limit 200
  `;
  const documents = await sql<StrategyDocument>`
    select d.id, d.filename, d.kind, d.char_count, d.page_count,
           count(c.id)::int as chunk_count
    from strategy_documents d
    left join document_chunks c on c.document_id = d.id
    where d.strategy_id = ${strategyId}
    group by d.id
    order by d.id
  `;
  const amendments = await sql<Amendment>`
    select id, strategy_id, intensity, location, original_excerpt, proposed_text, rationale,
           assumption_id, source, excerpt_verified, created_at::text as created_at
    from amendments where strategy_id = ${strategyId}
    order by created_at desc, id
  `;
  let peer_research: PeerResearch | null = null;
  const head = await sql<{
    id: number;
    recency_years: number;
    query: string;
    summary: string;
    created_at: string;
  }>`
    select id, recency_years, query, summary, created_at::text as created_at
    from peer_research where strategy_id = ${strategyId}
    order by created_at desc limit 1
  `;
  if (head[0]) {
    const findings = await sql<PeerFinding>`
      select id, country, title, year, url, idea, relevance, intensity, category
      from peer_findings where research_id = ${head[0].id} order by id
    `;
    peer_research = { ...head[0], findings };
  }

  const delivery_ratings = await sql<DeliveryRating>`
    select r.id, r.strategy_id, r.user_id, r.rag, r.basis, r.source_label, r.source_url, r.as_of, r.method,
           r.created_at::text as created_at, coalesce(p.display_name, p.email) as author
    from delivery_ratings r
    left join profiles p on p.user_id = r.user_id
    where r.strategy_id = ${strategyId}
    order by r.created_at desc, r.id desc
    limit 20
  `;

  const memberRows = await sql<Member>`
    select m.user_id, m.role, p.email, p.display_name
    from strategy_members m
    left join profiles p on p.user_id = m.user_id
    where m.strategy_id = ${strategyId}
    order by m.created_at
  `;
  const ownerProfile = await sql<{ email: string | null; display_name: string | null }>`
    select email, display_name from profiles where user_id = ${strategy.user_id}
  `;
  const members: Member[] = [
    {
      user_id: strategy.user_id,
      role: "owner",
      email: ownerProfile[0]?.email ?? null,
      display_name: ownerProfile[0]?.display_name ?? null,
    },
    ...memberRows,
  ];

  const room_passages = await sql<RoomPassage>`
    select id, category, rank, locator, quote, terms_hit, read_at::text as read_at
    from room_passages where strategy_id = ${strategyId}
    order by category, rank
  `;
  const room_reads = await sql<RoomRead>`
    select category, read_at::text as read_at, passages, terms_matched
    from room_reads where strategy_id = ${strategyId}
    order by category
  `;
  const room_findings = await sql<RoomFinding>`
    select f.id, f.category, f.title, f.url, f.published_date, f.quote, f.quote_verified, f.why, f.query,
           f.searched_at::text as searched_at, f.status, f.decided_at::text as decided_at, f.rationale,
           coalesce(p.display_name, p.email) as author,
           coalesce(d.display_name, d.email) as decided_author
    from room_findings f
    left join profiles p on p.user_id = f.user_id
    left join profiles d on d.user_id = f.decided_by
    where f.strategy_id = ${strategyId}
    order by f.category, f.searched_at desc, f.id desc
  `;

  const queue = buildQueue({ strategy, assumptions, signals, interrupts, cliffs, decisions });
  const metrics = buildMetrics({ assumptions, signals, cliffs, interrupts, queue });
  return {
    strategy,
    my_role: role,
    members,
    delivery_ratings,
    assumptions,
    signals,
    interrupts,
    decisions,
    cliffs,
    evidence,
    documents,
    amendments,
    peer_research,
    room_passages,
    room_reads,
    room_findings,
    queue: queue.queue,
    metrics,
  };
}

function attentionOf(bundle: StrategyBundle): Attention {
  const m = bundle.metrics;
  return {
    queue_count: m.queue_count,
    queue_overflow: m.queue_overflow,
    open_interrupts: m.open_interrupts,
    overdue_interrupts: m.overdue_interrupts,
    stale_sentinels: bundle.signals.filter((s) => s.status === "active" && s.layer === "sentinel" && s.stale).length,
    crossed: m.crossed_count,
    broken: m.broken,
    weakening: m.weakening,
    next_cliff_days: m.days_to_cliff,
    next_cliff_name: m.next_cliff_name,
  };
}

export const listStrategies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StrategySummary[]> => {
    const sql = await getSql();
    const rows = await sql<Strategy & { my_role: MemberRole }>`
      select s.id, s.user_id, s.title, s.domain, s.vision, s.language, s.jurisdiction, s.extraction_note, s.horizon_start, s.horizon_end,
             s.delivery_rag, s.created_at::text as created_at, s.updated_at::text as updated_at,
             case when s.user_id = ${context.userId} then 'owner' else m.role end as my_role
      from strategies s
      left join strategy_members m on m.strategy_id = s.id and m.user_id = ${context.userId}
      where s.user_id = ${context.userId} or m.user_id is not null
      order by s.updated_at desc
      limit 100
    `;
    const out: StrategySummary[] = [];
    for (const row of rows) {
      const { my_role, ...strategy } = row;
      const bundle = await loadBundle(context.userId, row.id, { sql, role: my_role });
      out.push({ ...strategy, my_role, attention: attentionOf(bundle), validity: validityOf(bundle.assumptions) });
    }
    return out;
  });

export const createStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.create))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      insert into strategies (user_id, title, domain, vision, language, jurisdiction, horizon_start, horizon_end)
      values (
        ${context.userId}, ${data.title}, ${data.domain ?? ""}, ${data.vision ?? ""}, ${data.language ?? ""},
        ${data.jurisdiction ?? ""}, ${data.horizon_start ?? null}, ${data.horizon_end ?? null}
      )
      returning id
    `;
    return { id: rows[0]!.id };
  });

export const updateStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.update))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.id, "editor", sql);
    const current = await loadStrategy(sql, data.id);
    await sql`
      update strategies set
        title = ${data.title ?? current.title},
        domain = ${data.domain ?? current.domain},
        vision = ${data.vision ?? current.vision},
        language = ${data.language ?? current.language},
        jurisdiction = ${data.jurisdiction ?? current.jurisdiction},
        horizon_start = ${data.horizon_start === undefined ? current.horizon_start : data.horizon_start},
        horizon_end = ${data.horizon_end === undefined ? current.horizon_end : data.horizon_end},
        updated_at = now()
      where id = ${data.id}
    `;
    return { ok: true as const };
  });

export const deleteStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.byId))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.id, "owner", sql);
    await sql`delete from strategies where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const getStrategyBundle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.byId))
  .handler(async ({ context, data }): Promise<StrategyBundle> => loadBundle(context.userId, data.id));

export const loadRomaniaSample = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const strategyId = await sql.transaction(async (tx) => {
      const created = await tx<{ id: number }>`
        insert into strategies (user_id, title, domain, vision, language, jurisdiction, horizon_start, horizon_end, delivery_rag)
        values (
          ${context.userId},
          ${ROMANIA_SEED.strategy.title},
          ${ROMANIA_SEED.strategy.domain},
          ${ROMANIA_SEED.strategy.vision},
          ${ROMANIA_SEED.strategy.language},
          ${ROMANIA_SEED.strategy.jurisdiction},
          ${ROMANIA_SEED.strategy.horizon_start},
          ${ROMANIA_SEED.strategy.horizon_end},
          ${ROMANIA_SEED.strategy.delivery_rag}
        )
        returning id
      `;
      const id = created[0]!.id;
      await tx`
        insert into delivery_ratings (strategy_id, user_id, rag, basis, source_label, as_of)
        values (
          ${id}, ${context.userId}, ${ROMANIA_SEED.strategy.delivery_rag},
          ${ROMANIA_SEED.strategy.delivery_basis}, ${ROMANIA_SEED.strategy.delivery_source},
          ${ROMANIA_SEED.strategy.delivery_as_of}
        )
      `;
      const assumptionIds: number[] = [];
      for (const a of ROMANIA_SEED.assumptions) {
        const row = await tx<{ id: number }>`
          insert into assumptions (
            strategy_id, user_id, claim, origin, status, implied_intensity, owner_label, sort_order
          ) values (
            ${id}, ${context.userId}, ${a.claim}, ${a.origin}, ${a.status},
            ${a.implied_intensity}, ${a.owner_label}, ${a.sort_order}
          ) returning id
        `;
        assumptionIds.push(row[0]!.id);
      }
      for (const s of ROMANIA_SEED.signals) {
        const row = await tx<{ id: number }>`
          insert into signals (
            strategy_id, user_id, name, category, secondary_category, layer,
            materiality, velocity, confidence, cadence, baseline, current_value, unit,
            threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
            false_positive_guard, owner_label, status
          ) values (
            ${id}, ${context.userId}, ${s.name}, ${s.category}, ${s.secondary_category},
            ${s.layer}, ${s.materiality}, ${s.velocity}, ${s.confidence}, ${s.cadence},
            ${s.baseline}, ${s.current_value}, ${s.unit}, ${s.threshold_watch}, ${s.threshold_amend},
            ${s.threshold_refresh}, ${s.threshold_reset}, ${s.false_positive_guard}, ${s.owner_label},
            'active'
          ) returning id
        `;
        for (const sort of s.links) {
          const aId = assumptionIds[sort - 1];
          if (!aId) continue;
          await tx`
            insert into assumption_signals (assumption_id, signal_id)
            values (${aId}, ${row[0]!.id})
            on conflict do nothing
          `;
        }
      }
      for (const i of ROMANIA_SEED.interrupts) {
        await tx`
          insert into interrupts (strategy_id, user_id, name, red_line, category, status)
          values (${id}, ${context.userId}, ${i.name}, ${i.red_line}, ${i.category}, 'armed')
        `;
      }
      for (const c of ROMANIA_SEED.cliffs) {
        await tx`
          insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
          values (${id}, ${context.userId}, ${c.name}, ${c.cliff_date}, ${c.kind})
        `;
      }
      for (const e of ROMANIA_SEED.evidence) {
        const aId = assumptionIds[e.assumption_sort - 1];
        if (!aId) continue;
        await tx`
          insert into evidence (strategy_id, user_id, assumption_id, note, source_url, direction)
          values (${id}, ${context.userId}, ${aId}, ${e.note}, ${e.source_url}, ${e.direction})
        `;
        await tx`update assumptions set last_evidence_at = now() where id = ${aId}`;
      }
      if (ROMANIA_SEED.excerpts.length) {
        const doc = await tx<{ id: number }>`
          insert into strategy_documents (strategy_id, user_id, filename, kind, char_count, page_count)
          values (
            ${id}, ${context.userId},
            'SNRRD 2024-2035 (seeded excerpts)', 'text',
            ${ROMANIA_SEED.excerpts.reduce((n, e) => n + e.body.length, 0)},
            null
          ) returning id
        `;
        let idx = 0;
        for (const ex of ROMANIA_SEED.excerpts) {
          await tx`
            insert into document_chunks (document_id, chunk_index, heading, body)
            values (${doc[0]!.id}, ${idx}, ${ex.heading}, ${ex.body})
          `;
          idx += 1;
        }
      }
      for (const a of ROMANIA_SEED.amendments) {
        await tx`
          insert into amendments (
            strategy_id, user_id, intensity, location, original_excerpt, proposed_text, rationale, source, excerpt_verified
          ) values (
            ${id}, ${context.userId}, ${a.intensity}, ${a.location},
            ${a.original_excerpt}, ${a.proposed_text}, ${a.rationale}, ${a.source}, true
          )
        `;
      }
      return id;
    });
    return { id: strategyId };
  });

export const upsertAssumption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.upsertAssumption))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    if (data.id) {
      await sql`
        update assumptions set
          claim = ${data.claim}, origin = ${data.origin},
          implied_intensity = ${data.implied_intensity},
          owner_label = ${data.owner_label ?? ""}
        where id = ${data.id} and strategy_id = ${data.strategy_id}
      `;
      await touch(sql, data.strategy_id);
      return { id: data.id };
    }
    const count = await sql<{ n: number; next: number }>`
      select count(*)::int as n, coalesce(max(sort_order), 0) + 1 as next
      from assumptions where strategy_id = ${data.strategy_id}
    `;
    if ((count[0]?.n ?? 0) >= BUDGET.maxAssumptions) {
      throw new Error(`Assumption budget is ${BUDGET.maxAssumptions}. Retire one first.`);
    }
    const row = await sql<{ id: number }>`
      insert into assumptions (strategy_id, user_id, claim, origin, status, implied_intensity, owner_label, sort_order)
      values (${data.strategy_id}, ${context.userId}, ${data.claim}, ${data.origin}, 'untested', ${data.implied_intensity}, ${data.owner_label ?? ""}, ${count[0]?.next ?? 1})
      returning id
    `;
    await touch(sql, data.strategy_id);
    return { id: row[0]!.id };
  });

type StatusChange = {
  id: number;
  /** Omit to keep the status on record and only file the note. */
  status?: Assumption["status"];
  note: string;
  direction?: EvidenceDirection;
  source_url?: string;
  method?: RatingMethod;
};

/**
 * The one rule for moving a bet, shared by the drawer and the assessment
 * dialog: a status change needs at least ten characters of evidence. A note
 * without a status change is simply filed.
 */
async function applyAssumptionStatus(
  tx: Sql,
  userId: string,
  strategyId: number,
  row: StatusChange,
  label = "this bet",
) {
  const current = await tx<{ status: Assumption["status"] }>`
    select status from assumptions where id = ${row.id} and strategy_id = ${strategyId}
  `;
  if (!current[0]) throw new Error(`That assumption is not in this strategy (${label}).`);
  const status = row.status ?? current[0].status;
  const changed = current[0].status !== status;
  const note = row.note.trim();
  if (changed && note.length < 10) {
    throw new Error(`Write the evidence that justifies the new status on ${label} (at least ten characters).`);
  }
  if (!changed && !note) return { changed: false, wrote: false };
  const direction =
    row.direction ?? (status === "holding" ? "supporting" : status === "untested" ? "neutral" : "weakening");
  if (note) {
    await tx`
      insert into evidence (strategy_id, user_id, assumption_id, note, source_url, direction, method)
      values (${strategyId}, ${userId}, ${row.id}, ${note}, ${row.source_url ?? ""}, ${direction}, ${row.method ?? "person"})
    `;
  }
  await tx`
    update assumptions set
      status = ${status},
      status_changed_at = case when ${changed} then now() else status_changed_at end,
      last_evidence_at = case when ${Boolean(note)} then now() else last_evidence_at end
    where id = ${row.id}
  `;
  return { changed, wrote: Boolean(note) };
}

/**
 * Move a bet between holding / weakening / broken / untested. A status change
 * needs an evidence note, which is stored against the assumption; the note is
 * optional when the status stays the same.
 */
export const setAssumptionStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.setAssumptionStatus))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const result = await sql.transaction(async (tx) => {
      const r = await applyAssumptionStatus(tx, context.userId, data.strategy_id, {
        id: data.id,
        status: data.status,
        note: data.note,
        direction: data.direction,
        source_url: data.source_url,
      });
      await touch(tx, data.strategy_id);
      return r;
    });
    return { ok: true as const, changed: result.changed };
  });

/**
 * One sitting's assessment: a delivery rating with its basis, and any bets
 * whose status or evidence changed, saved together. Delivery can only be
 * coloured here, so every colour has who, when and what report behind it.
 */
export const assessStrategy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.assess))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const delivery = data.delivery;
    if (delivery) {
      if (delivery.basis.trim().length < 20) throw new Error("Write what the report says (at least twenty characters).");
      if (delivery.rag !== "unrated" && !delivery.as_of) throw new Error("Give the as-of date of the report the rating rests on.");
      // A day of tolerance: the server does not know the caller's time zone.
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      if (delivery.as_of && delivery.as_of > tomorrow) {
        throw new Error("The as-of date cannot be in the future.");
      }
    }
    let changed = 0;
    await sql.transaction(async (tx) => {
      if (delivery) {
        await tx`
          insert into delivery_ratings (strategy_id, user_id, rag, basis, source_label, source_url, as_of, method)
          values (
            ${data.strategy_id}, ${context.userId}, ${delivery.rag}, ${delivery.basis.trim()},
            ${delivery.source_label ?? ""}, ${delivery.source_url ?? ""}, ${delivery.as_of ?? null},
            ${delivery.method ?? "person"}
          )
        `;
        await tx`update strategies set delivery_rag = ${delivery.rag} where id = ${data.strategy_id}`;
        changed += 1;
      }
      const bets = data.bets ?? [];
      for (let i = 0; i < bets.length; i += 1) {
        const r = await applyAssumptionStatus(tx, context.userId, data.strategy_id, bets[i]!, `bet ${i + 1}`);
        if (r.changed || r.wrote) changed += 1;
      }
      await touch(tx, data.strategy_id);
    });
    const rows = await sql<{ status: Assumption["status"] }>`
      select status from assumptions where strategy_id = ${data.strategy_id}
    `;
    const current = await sql<{ delivery_rag: Strategy["delivery_rag"] }>`
      select delivery_rag from strategies where id = ${data.strategy_id}
    `;
    return { ok: true as const, delivery_rag: current[0]!.delivery_rag, validity: validityOf(rows), changed };
  });

export const deleteAssumption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`delete from assumptions where id = ${data.id} and strategy_id = ${data.strategy_id}`;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

const READING_FIELDS = [
  "materiality",
  "velocity",
  "confidence",
  "layer",
  "status",
  "current_value",
  "crossed_level",
  "threshold_watch",
  "threshold_amend",
  "threshold_refresh",
  "threshold_reset",
] as const;

export const upsertSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.upsertSignal))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const status = data.status ?? "active";
    const crossed = data.crossed_level ?? "none";

    if (data.linked_assumption_ids?.length) {
      const owned = await sql<{ id: number }>`
        select id from assumptions where strategy_id = ${data.strategy_id}
      `;
      const ok = new Set(owned.map((r) => r.id));
      if (data.linked_assumption_ids.some((id) => !ok.has(id))) {
        throw new Error("Linked assumptions must belong to this strategy.");
      }
    }

    const counts = await sql<{ active: number; sentinels: number }>`
      select
        count(*) filter (where status = 'active' and id <> ${data.id ?? 0})::int as active,
        count(*) filter (where status = 'active' and layer = 'sentinel' and id <> ${data.id ?? 0})::int as sentinels
      from signals where strategy_id = ${data.strategy_id}
    `;
    if (status === "active") {
      if ((counts[0]?.active ?? 0) >= BUDGET.maxActiveSignals) {
        throw new Error(`Active signal budget is ${BUDGET.maxActiveSignals}. Park or retire one first.`);
      }
      if (data.layer === "sentinel" && (counts[0]?.sentinels ?? 0) >= BUDGET.maxSentinels) {
        throw new Error(`Sentinel budget is ${BUDGET.maxSentinels}. Make one rotating first.`);
      }
    }

    const id = await sql.transaction(async (tx) => {
      let signalId = data.id;
      if (signalId) {
        const current = await tx<SignalRow>`
          select * from signals where id = ${signalId} and strategy_id = ${data.strategy_id}
        `;
        if (!current[0]) throw new Error("Signal not found");
        const next = { ...data, status, crossed_level: crossed };
        const readingChanged = READING_FIELDS.some(
          (f) => String(current[0]![f] ?? "") !== String((next as Record<string, unknown>)[f] ?? ""),
        );
        await tx`
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
            owner_label = ${data.owner_label ?? ""}, status = ${status},
            crossed_level = ${crossed},
            updated_at = case when ${readingChanged} then now() else updated_at end
          where id = ${signalId}
        `;
      } else {
        const row = await tx<{ id: number }>`
          insert into signals (
            strategy_id, user_id, name, category, secondary_category, layer,
            materiality, velocity, confidence, cadence, baseline, current_value, unit,
            threshold_watch, threshold_amend, threshold_refresh, threshold_reset,
            false_positive_guard, owner_label, status, crossed_level
          ) values (
            ${data.strategy_id}, ${context.userId}, ${data.name}, ${data.category},
            ${data.secondary_category ?? null}, ${data.layer}, ${data.materiality},
            ${data.velocity}, ${data.confidence}, ${data.cadence}, ${data.baseline ?? ""},
            ${data.current_value ?? ""}, ${data.unit ?? ""}, ${data.threshold_watch ?? ""},
            ${data.threshold_amend ?? ""}, ${data.threshold_refresh ?? ""},
            ${data.threshold_reset ?? ""}, ${data.false_positive_guard ?? ""},
            ${data.owner_label ?? ""}, ${status}, ${crossed}
          ) returning id
        `;
        signalId = row[0]!.id;
      }
      if (data.linked_assumption_ids) {
        await tx`delete from assumption_signals where signal_id = ${signalId}`;
        for (const aId of new Set(data.linked_assumption_ids)) {
          await tx`
            insert into assumption_signals (assumption_id, signal_id)
            values (${aId}, ${signalId}) on conflict do nothing
          `;
        }
      }
      await touch(tx, data.strategy_id);
      return signalId;
    });
    return { id };
  });

export const deleteSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`delete from signals where id = ${data.id} and strategy_id = ${data.strategy_id}`;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

/**
 * A new reading on a signal: the value, the evidence behind it, and which
 * pre-committed threshold (if any) it has crossed. Refreshes the evidence date,
 * so the signal stops being stale.
 */
export const recordSignalReading = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.recordReading))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const current = await sql<{ current_value: string; crossed_level: string }>`
      select current_value, crossed_level from signals
      where id = ${data.signal_id} and strategy_id = ${data.strategy_id}
    `;
    if (!current[0]) throw new Error("Signal not found");
    const note = data.note.trim();
    if (note.length < 3) throw new Error("Write what the reading is based on.");
    const value = data.current_value === undefined ? current[0].current_value : data.current_value;
    const crossed = data.crossed_level ?? current[0].crossed_level;
    const changed = value !== current[0].current_value || crossed !== current[0].crossed_level;
    await sql.transaction(async (tx) => {
      await tx`
        insert into evidence (strategy_id, user_id, signal_id, note, reading, source_url, direction)
        values (${data.strategy_id}, ${context.userId}, ${data.signal_id}, ${note}, ${value}, ${data.source_url ?? ""}, ${data.direction})
      `;
      await tx`
        update signals set
          current_value = ${value},
          crossed_level = ${crossed},
          last_evidence_at = now(),
          updated_at = case when ${changed} then now() else updated_at end
        where id = ${data.signal_id}
      `;
      await touch(tx, data.strategy_id);
    });
    return { ok: true as const };
  });

export const fireInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.fireInterrupt))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    const days = data.review_days ?? 30;
    const reviewBy = new Date(Date.now() + days * 86400000).toISOString();
    await sql`
      update interrupts
      set status = 'open', fired_at = now(), review_by = ${reviewBy}::timestamptz
      where id = ${data.id} and strategy_id = ${data.strategy_id}
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

export const closeInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      update interrupts set status = 'closed'
      where id = ${data.id} and strategy_id = ${data.strategy_id}
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

/** Put a closed red line back on watch. */
export const rearmInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      update interrupts set status = 'armed', fired_at = null, review_by = null
      where id = ${data.id} and strategy_id = ${data.strategy_id}
    `;
    return { ok: true as const };
  });

export const addInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.addInterrupt))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      insert into interrupts (strategy_id, user_id, name, red_line, category, status)
      values (${data.strategy_id}, ${context.userId}, ${data.name}, ${data.red_line}, ${data.category ?? null}, 'armed')
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

/** Which room a red line belongs to. Null means "not named"; the room reads it as Risks. */
export const setInterruptRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.setInterruptRoom))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      update interrupts set category = ${data.category}
      where id = ${data.id} and strategy_id = ${data.strategy_id}
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

export const deleteInterrupt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`delete from interrupts where id = ${data.id} and strategy_id = ${data.strategy_id}`;
    return { ok: true as const };
  });

export const logDecision = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.logDecision))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    if (data.signal_id) {
      const s = await sql<{ id: number }>`select id from signals where id = ${data.signal_id} and strategy_id = ${data.strategy_id}`;
      if (!s[0]) throw new Error("That signal is not in this strategy.");
    }
    if (data.assumption_id) {
      const a = await sql<{ id: number }>`select id from assumptions where id = ${data.assumption_id} and strategy_id = ${data.strategy_id}`;
      if (!a[0]) throw new Error("That assumption is not in this strategy.");
    }
    await sql`
      insert into decisions (strategy_id, user_id, intensity, summary, rationale, item_key, signal_id, assumption_id)
      values (
        ${data.strategy_id}, ${context.userId}, ${data.intensity}, ${data.summary},
        ${data.rationale.trim()}, ${data.item_key ?? ""}, ${data.signal_id ?? null}, ${data.assumption_id ?? null}
      )
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

export const addCliff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.addCliff))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`
      insert into cliffs (strategy_id, user_id, name, cliff_date, kind)
      values (${data.strategy_id}, ${context.userId}, ${data.name}, ${data.cliff_date}, ${data.kind})
    `;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

export const deleteCliff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.scoped))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "editor", sql);
    await sql`delete from cliffs where id = ${data.id} and strategy_id = ${data.strategy_id}`;
    await touch(sql, data.strategy_id);
    return { ok: true as const };
  });

export const addStrategyMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.addMember))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertAccess(context.userId, data.strategy_id, "owner", sql);
    const person = await findUserByEmail(data.email);
    if (!person) {
      throw new Error("No account with that email. Ask them to sign in to Vigil once, then add them.");
    }
    if (person.user_id === context.userId) throw new Error("You already own this strategy.");
    await sql`
      insert into strategy_members (strategy_id, user_id, role, added_by)
      values (${data.strategy_id}, ${person.user_id}, ${data.role}, ${context.userId})
      on conflict (strategy_id, user_id) do update set role = excluded.role
    `;
    return { ok: true as const, user_id: person.user_id };
  });

export const removeStrategyMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.removeMember))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    // Owners remove anyone; a member can remove themselves.
    if (data.user_id !== context.userId) await assertAccess(context.userId, data.strategy_id, "owner", sql);
    await sql`
      delete from strategy_members where strategy_id = ${data.strategy_id} and user_id = ${data.user_id}
    `;
    return { ok: true as const };
  });
