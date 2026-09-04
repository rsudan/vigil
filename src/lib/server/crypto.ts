/**
 * API keys at rest are AES-256-GCM encrypted. The key is derived from, in order:
 *   1. VIGIL_KEY_SECRET
 *   2. BETTER_AUTH_SECRET (already required on a deployment)
 *   3. a random secret written once to `.data/key-secret` (local runs)
 * Rotating the secret makes stored keys unreadable; users re-enter them.
 *
 * Node built-ins are imported lazily inside the functions: this module sits in
 * the import graph of server-function files that client components also load,
 * and a top-level `node:crypto` import would be evaluated in the browser.
 */
const PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;

async function loadOrCreateLocalSecret(): Promise<string> {
  const [{ randomBytes }, fs, path] = await Promise.all([
    import("node:crypto"),
    import("node:fs"),
    import("node:path"),
  ]);
  const dir = process.env.VIGIL_DATA_DIR?.trim() || ".data";
  const file = path.join(dir, "key-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // first run
  }
  const fresh = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, fresh, { mode: 0o600 });
  } catch {
    // Read-only filesystem: keys encrypted this process will not survive a restart.
    console.warn("[crypto] could not persist a local key secret; set VIGIL_KEY_SECRET");
  }
  return fresh;
}

export function keySecretSource(): "env" | "auth-secret" | "local-file" {
  if (process.env.VIGIL_KEY_SECRET?.trim()) return "env";
  if (process.env.BETTER_AUTH_SECRET?.trim()) return "auth-secret";
  return "local-file";
}

/** Derive the 32-byte AES key from any secret string. */
export async function keyFromSecret(secret: string): Promise<Buffer> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(secret).digest();
}

async function activeKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.VIGIL_KEY_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    (await loadOrCreateLocalSecret());
  cachedKey = await keyFromSecret(secret);
  return cachedKey;
}

export function isEncrypted(stored: string) {
  return stored.startsWith(PREFIX);
}

export async function encryptSecret(plain: string, key?: Buffer): Promise<string> {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const k = key ?? (await activeKey());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Decrypt a stored value. Rows written before encryption existed pass through unchanged. */
export async function decryptSecret(stored: string, key?: Buffer): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  const { createDecipheriv } = await import("node:crypto");
  const k = key ?? (await activeKey());
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Stored key is corrupt");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
