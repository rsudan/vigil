import { getSql, type Sql } from "@/lib/db";
import type { MemberRole } from "@/lib/taxonomy";

const ORDER: Record<MemberRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** The caller's role on a strategy: owner (created it), editor or viewer (shared), or null. */
export async function strategyRole(
  userId: string,
  strategyId: number,
  sql?: Sql,
): Promise<MemberRole | null> {
  const db = sql ?? (await getSql());
  const own = await db<{ id: number }>`
    select id from strategies where id = ${strategyId} and user_id = ${userId}
  `;
  if (own[0]) return "owner";
  const member = await db<{ role: "editor" | "viewer" }>`
    select role from strategy_members where strategy_id = ${strategyId} and user_id = ${userId}
  `;
  return member[0]?.role ?? null;
}

/** Throw unless the caller holds at least `min` on the strategy. Returns the role. */
export async function assertAccess(
  userId: string,
  strategyId: number,
  min: MemberRole,
  sql?: Sql,
): Promise<MemberRole> {
  const role = await strategyRole(userId, strategyId, sql);
  if (!role) throw new Error("Strategy not found");
  if (ORDER[role] < ORDER[min]) {
    throw new Error(
      min === "owner" ? "Only the owner can do that." : "You have read-only access to this strategy.",
    );
  }
  return role;
}

export function roleAtLeast(role: MemberRole, min: MemberRole) {
  return ORDER[role] >= ORDER[min];
}
