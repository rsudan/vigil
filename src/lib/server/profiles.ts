import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { profiles as schema, validate } from "@/lib/server/schemas";
import type { Profile, Role } from "@/lib/types";

type AuthUser = { id: string; email: string | null; name: string | null };

/** The Better Auth user row, when sign-in is on. Absent with auth disabled. */
async function authUser(sql: Sql, userId: string): Promise<AuthUser | null> {
  try {
    const rows = await sql<AuthUser>`select id, email, name from "user" where id = ${userId}`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function authUserByEmail(sql: Sql, email: string): Promise<AuthUser | null> {
  try {
    const rows = await sql<AuthUser>`select id, email, name from "user" where lower(email) = ${email}`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The caller's profile, created on first sight. The first profile on an instance
 * is the administrator. Email and name are copied from the sign-in record so
 * members can be found by email and the log can name who decided.
 */
export async function ensureProfile(userId: string): Promise<Profile> {
  const sql = await getSql();
  const existing = await sql<Profile>`
    select user_id, display_name, email, role, created_at::text as created_at
    from profiles where user_id = ${userId}
  `;
  const identity = await authUser(sql, userId);
  if (existing[0]) {
    if (identity && (!existing[0].email || !existing[0].display_name)) {
      await sql`
        update profiles set
          email = coalesce(email, ${identity.email}),
          display_name = coalesce(display_name, ${identity.name})
        where user_id = ${userId}
      `;
      return { ...existing[0], email: existing[0].email ?? identity.email, display_name: existing[0].display_name ?? identity.name };
    }
    return existing[0];
  }
  const count = await sql<{ n: number }>`select count(*)::int as n from profiles`;
  const role: Role = count[0]?.n === 0 ? "admin" : "member";
  await sql`
    insert into profiles (user_id, role, email, display_name)
    values (${userId}, ${role}, ${identity?.email ?? null}, ${identity?.name ?? null})
    on conflict (user_id) do nothing
  `;
  const created = await sql<Profile>`
    select user_id, display_name, email, role, created_at::text as created_at
    from profiles where user_id = ${userId}
  `;
  return created[0]!;
}

/** Find a signed-in person by email, creating their profile row if they have none yet. */
export async function findUserByEmail(
  email: string,
): Promise<{ user_id: string; email: string | null; display_name: string | null } | null> {
  const sql = await getSql();
  const wanted = email.trim().toLowerCase();
  const byProfile = await sql<{ user_id: string; email: string | null; display_name: string | null }>`
    select user_id, email, display_name from profiles where lower(email) = ${wanted} limit 1
  `;
  if (byProfile[0]) return byProfile[0];
  const user = await authUserByEmail(sql, wanted);
  if (!user) return null;
  await sql`
    insert into profiles (user_id, role, email, display_name)
    values (${user.id}, 'member', ${user.email}, ${user.name})
    on conflict (user_id) do update set email = coalesce(profiles.email, excluded.email), display_name = coalesce(profiles.display_name, excluded.display_name)
  `;
  return { user_id: user.id, email: user.email, display_name: user.name };
}

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ensureProfile(context.userId));

export const listMembers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await sql<Profile>`select user_id, role from profiles where user_id = ${context.userId}`;
    if (me[0]?.role !== "admin") {
      throw new Error("Forbidden");
    }
    return sql<Profile>`
      select user_id, display_name, email, role, created_at::text as created_at
      from profiles order by created_at asc
    `;
  });

export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.setRole))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await sql<Profile>`select role from profiles where user_id = ${context.userId}`;
    if (me[0]?.role !== "admin") throw new Error("Forbidden");
    if (data.user_id === context.userId) throw new Error("You cannot change your own role");
    await sql`update profiles set role = ${data.role} where user_id = ${data.user_id}`;
    return { ok: true as const };
  });
