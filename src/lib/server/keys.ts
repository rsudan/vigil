import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { defaultModel, envKeyFor, listModels, testProvider } from "@/lib/server/llm";
import { MOCK_KEY, mockEnabled } from "@/lib/server/mock";
import { assertRateLimit } from "@/lib/server/rate-limit";
import { keys as schema, validate } from "@/lib/server/schemas";
import { PROVIDERS, isLlmProvider, providerById, type LlmProviderId, type ProviderId } from "@/lib/taxonomy";
import type { ExtractPreference, KeyStatus, Profile, SessionKeys } from "@/lib/types";

type CredRow = {
  id: number;
  owner_user_id: string;
  provider: ProviderId;
  scope: "personal" | "org";
  secret: string;
  last_four: string;
  label: string | null;
  selected_model: string | null;
};

function lastFour(secret: string) {
  const t = secret.trim();
  return t.length <= 4 ? t : t.slice(-4);
}

async function readSecret(row: CredRow): Promise<string> {
  try {
    return await decryptSecret(row.secret);
  } catch {
    throw new Error(
      `The stored ${row.provider} key cannot be decrypted with the current key secret. Re-enter it on the Keys page.`,
    );
  }
}

/**
 * Keys set in the environment belong to whoever runs the instance. By default
 * only administrators spend them; `VIGIL_PLATFORM_KEYS_FOR=all` opens them to
 * every signed-in user, `none` disables them.
 */
export async function platformKeysAllowed(userId: string): Promise<boolean> {
  const policy = (process.env.VIGIL_PLATFORM_KEYS_FOR ?? "admins").trim().toLowerCase();
  if (policy === "all") return true;
  if (policy === "none") return false;
  const sql = await getSql();
  const me = await sql<{ role: string }>`select role from profiles where user_id = ${userId}`;
  return me[0]?.role === "admin";
}

export async function resolveKey(
  userId: string,
  provider: ProviderId,
  session?: SessionKeys,
  opts?: { platform?: boolean },
): Promise<{ key: string; source: KeyStatus["source"]; model: string | null } | null> {
  const fromSession = session?.[provider]?.trim();
  if (fromSession) return { key: fromSession, source: "session", model: null };

  const sql = await getSql();
  const personal = await sql<CredRow>`
    select id, owner_user_id, provider, scope, secret, last_four, label, selected_model
    from api_credentials
    where owner_user_id = ${userId} and provider = ${provider} and scope = 'personal'
    limit 1
  `;
  if (personal[0]) {
    return { key: await readSecret(personal[0]), source: "personal", model: personal[0].selected_model };
  }

  const granted = await sql<CredRow>`
    select c.id, c.owner_user_id, c.provider, c.scope, c.secret, c.last_four, c.label, c.selected_model
    from api_credentials c
    join api_credential_grants g on g.credential_id = c.id
    where g.grantee_user_id = ${userId} and c.provider = ${provider} and c.scope = 'org'
    order by c.created_at desc
    limit 1
  `;
  if (granted[0]) {
    return { key: await readSecret(granted[0]), source: "org", model: granted[0].selected_model };
  }

  const platform = opts?.platform ?? (await platformKeysAllowed(userId));
  if (platform) {
    const env = envKeyFor(provider);
    if (env) {
      return { key: env, source: "platform", model: isLlmProvider(provider) ? defaultModel(provider) : null };
    }
  }
  // Offline test mode: a deterministic stand-in when nothing real is configured.
  if (mockEnabled()) return { key: MOCK_KEY, source: "platform", model: isLlmProvider(provider) ? "mock" : null };
  return null;
}

/**
 * Pick the language model to use: the preferred provider if it has a key, else
 * the first provider that does. A model name only travels with its own
 * provider, so a fallback never receives another provider's model id.
 */
export async function resolveLlm(
  userId: string,
  session: SessionKeys | undefined,
  preferred?: { provider?: string; model?: string },
): Promise<{ provider: LlmProviderId; key: string; model: string; source: KeyStatus["source"] } | null> {
  let pref = preferred?.provider ? preferred : undefined;
  if (!pref) {
    const sql = await getSql();
    const row = await sql<{ extract_provider: string; extract_model: string }>`
      select extract_provider, extract_model from user_preferences where user_id = ${userId}
    `;
    if (row[0] && isLlmProvider(row[0].extract_provider)) {
      pref = { provider: row[0].extract_provider, model: row[0].extract_model };
    }
  }
  const platform = await platformKeysAllowed(userId);
  const order: LlmProviderId[] = [];
  if (pref?.provider && isLlmProvider(pref.provider)) order.push(pref.provider);
  for (const p of PROVIDERS) {
    if (isLlmProvider(p.id) && !order.includes(p.id)) order.push(p.id);
  }
  for (const provider of order) {
    const resolved = await resolveKey(userId, provider, session, { platform });
    if (!resolved) continue;
    const preferredModel = pref?.provider === provider ? pref.model?.trim() : undefined;
    const model = preferredModel || resolved.model || defaultModel(provider);
    return { provider, key: resolved.key, model, source: resolved.source };
  }
  return null;
}

export const listKeyStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const platform = await platformKeysAllowed(context.userId);
    const out: KeyStatus[] = [];
    for (const p of PROVIDERS) {
      const resolved = await resolveKey(context.userId, p.id, undefined, { platform });
      if (!resolved) {
        out.push({
          provider: p.id,
          configured: false,
          source: "none",
          last_four: null,
          label: null,
          selected_model: isLlmProvider(p.id) ? defaultModel(p.id) : null,
          kind: p.kind,
        });
        continue;
      }
      const four =
        resolved.source === "personal"
          ? (
              await sql<{ last_four: string; label: string | null; selected_model: string | null }>`
                select last_four, label, selected_model from api_credentials
                where owner_user_id = ${context.userId} and provider = ${p.id} and scope = 'personal'
              `
            )[0]
          : resolved.source === "org"
            ? (
                await sql<{ last_four: string; label: string | null; selected_model: string | null }>`
                  select c.last_four, c.label, c.selected_model from api_credentials c
                  join api_credential_grants g on g.credential_id = c.id
                  where g.grantee_user_id = ${context.userId} and c.provider = ${p.id} and c.scope = 'org'
                  limit 1
                `
              )[0]
            : undefined;
      out.push({
        provider: p.id,
        configured: true,
        source: resolved.source,
        last_four: resolved.source === "platform" ? "env" : (four?.last_four ?? "••••"),
        label: resolved.source === "platform" ? "Platform key" : (four?.label ?? null),
        selected_model:
          four?.selected_model ?? resolved.model ?? (isLlmProvider(p.id) ? defaultModel(p.id) : null),
        kind: p.kind,
      });
    }
    return out;
  });

export const savePersonalKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.savePersonal))
  .handler(async ({ context, data }) => {
    const secret = data.secret.trim();
    if (!providerById(data.provider)) throw new Error("Unknown provider");
    const sql = await getSql();
    const model = data.selected_model || (isLlmProvider(data.provider) ? defaultModel(data.provider) : null);
    await sql`
      insert into api_credentials (owner_user_id, provider, scope, secret, last_four, label, selected_model)
      values (${context.userId}, ${data.provider}, 'personal', ${await encryptSecret(secret)}, ${lastFour(secret)}, ${data.label ?? null}, ${model})
      on conflict (owner_user_id, provider, scope)
      do update set secret = excluded.secret, last_four = excluded.last_four, label = excluded.label,
        selected_model = coalesce(excluded.selected_model, api_credentials.selected_model)
    `;
    return { ok: true as const, last_four: lastFour(secret) };
  });

export const deletePersonalKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.provider))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      delete from api_credentials
      where owner_user_id = ${context.userId} and provider = ${data.provider} and scope = 'personal'
    `;
    return { ok: true as const };
  });

async function requireAdmin(userId: string) {
  const sql = await getSql();
  const me = await sql<Profile>`select role from profiles where user_id = ${userId}`;
  if (me[0]?.role !== "admin") throw new Error("Forbidden");
}

export const saveOrgKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.saveOrg))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const secret = data.secret.trim();
    const model = isLlmProvider(data.provider) ? defaultModel(data.provider) : null;
    await sql`
      insert into api_credentials (owner_user_id, provider, scope, secret, last_four, label, selected_model)
      values (${context.userId}, ${data.provider}, 'org', ${await encryptSecret(secret)}, ${lastFour(secret)}, ${data.label || "Organisation"}, ${model})
      on conflict (owner_user_id, provider, scope)
      do update set secret = excluded.secret, last_four = excluded.last_four, label = excluded.label
    `;
    return { ok: true as const, last_four: lastFour(secret) };
  });

export const listOrgKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      provider: ProviderId;
      last_four: string;
      label: string | null;
      created_at: string;
    }>`
      select id, provider, last_four, label, created_at::text as created_at
      from api_credentials where scope = 'org' order by provider
    `;
    const grants = await sql<{ credential_id: number; grantee_user_id: string }>`
      select credential_id, grantee_user_id from api_credential_grants
    `;
    return rows.map((k) => ({
      ...k,
      grantees: grants.filter((g) => g.credential_id === k.id).map((g) => g.grantee_user_id),
    }));
  });

export const setOrgKeyGrants = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.grants))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    const owned = await sql<{ id: number }>`
      select id from api_credentials where id = ${data.credential_id} and scope = 'org'
    `;
    if (!owned[0]) throw new Error("Unknown organisation key");
    await sql.transaction(async (tx) => {
      await tx`delete from api_credential_grants where credential_id = ${data.credential_id}`;
      for (const uid of new Set(data.grantee_user_ids)) {
        await tx`
          insert into api_credential_grants (credential_id, grantee_user_id, granted_by)
          values (${data.credential_id}, ${uid}, ${context.userId})
        `;
      }
    });
    return { ok: true as const };
  });

export const deleteOrgKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.credential))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const sql = await getSql();
    await sql`delete from api_credentials where id = ${data.credential_id} and scope = 'org'`;
    return { ok: true as const };
  });

export const testApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.test))
  .handler(async ({ context, data }) => {
    assertRateLimit(context.userId, "keys");
    const resolved = data.secret?.trim()
      ? { key: data.secret.trim() }
      : await resolveKey(context.userId, data.provider, data.sessionKeys);
    if (!resolved) return { ok: false as const, error: "No key to test." };
    return testProvider(data.provider, resolved.key);
  });

export const refreshModels = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.test))
  .handler(async ({ context, data }) => {
    if (!isLlmProvider(data.provider)) return { ok: false as const, error: "This provider has no model list." };
    assertRateLimit(context.userId, "keys");
    const resolved = data.secret?.trim()
      ? { key: data.secret.trim() }
      : await resolveKey(context.userId, data.provider, data.sessionKeys);
    if (!resolved) return { ok: false as const, error: "Add a key first." };
    const models = await listModels(data.provider, resolved.key);
    return { ok: true as const, models };
  });

export const setSelectedModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.selectModel))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update api_credentials set selected_model = ${data.model}
      where owner_user_id = ${context.userId} and provider = ${data.provider} and scope = 'personal'
    `;
    return { ok: true as const };
  });

export const getExtractPreference = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ExtractPreference> => {
    const sql = await getSql();
    const row = await sql<{ extract_provider: string; extract_model: string }>`
      select extract_provider, extract_model from user_preferences where user_id = ${context.userId}
    `;
    if (row[0] && isLlmProvider(row[0].extract_provider)) {
      return { provider: row[0].extract_provider, model: row[0].extract_model };
    }
    return { provider: "xai", model: defaultModel("xai") };
  });

export const setExtractPreference = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(validate(schema.extractPreference))
  .handler(async ({ context, data }) => {
    if (!isLlmProvider(data.provider)) throw new Error("Pick a language-model provider");
    const sql = await getSql();
    await sql`
      insert into user_preferences (user_id, extract_provider, extract_model)
      values (${context.userId}, ${data.provider}, ${data.model})
      on conflict (user_id)
      do update set extract_provider = excluded.extract_provider, extract_model = excluded.extract_model, updated_at = now()
    `;
    return { ok: true as const };
  });

/** Which policy governs environment keys; shown on the Keys and Admin pages. */
export const platformKeyPolicy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const policy = (process.env.VIGIL_PLATFORM_KEYS_FOR ?? "admins").trim().toLowerCase();
    return {
      policy: policy === "all" || policy === "none" ? policy : "admins",
      allowed_for_me: await platformKeysAllowed(context.userId),
      configured: PROVIDERS.filter((p) => Boolean(envKeyFor(p.id))).map((p) => p.id),
    };
  });
