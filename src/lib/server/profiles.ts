import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { Profile, Role } from "@/lib/types";

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const existing = await sql<Profile>`
      select user_id, display_name, email, role, created_at::text as created_at
      from profiles where user_id = ${context.userId}
    `;
    if (existing[0]) return existing[0];
    const count = await sql<{ n: number }>`select count(*)::int as n from profiles`;
    const role: Role = count[0]?.n === 0 ? "admin" : "member";
    await sql`
      insert into profiles (user_id, role) values (${context.userId}, ${role})
      on conflict (user_id) do nothing
    `;
    const created = await sql<Profile>`
      select user_id, display_name, email, role, created_at::text as created_at
      from profiles where user_id = ${context.userId}
    `;
    return created[0]!;
  });

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
  .validator((input: { user_id: string; role: Role }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await sql<Profile>`select role from profiles where user_id = ${context.userId}`;
    if (me[0]?.role !== "admin") throw new Error("Forbidden");
    if (data.user_id === context.userId) throw new Error("You cannot change your own role");
    await sql`update profiles set role = ${data.role} where user_id = ${data.user_id}`;
    return { ok: true as const };
  });
