// @ts-check
/**
 * Gauntlet: drive the whole system end to end in a real browser against a
 * fresh database, and fail loudly on the first thing that breaks.
 *
 *   npm run gauntlet            offline: deterministic mock model, Exa and Jina
 *   npm run gauntlet -- --real  your real keys from the environment (XAI_API_KEY, EXA_API_KEY, …)
 *   npm run gauntlet -- --keep  leave the server and database running afterwards
 *
 * Each run starts its own dev server on GAUNTLET_PORT (default 8091) with its
 * own PGLite directory, so it never touches your working data.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { companionMarkdown, makePdf, pastedText, strategyPages } from "./fixture-pdf.mjs";

const REAL = process.argv.includes("--real");
const KEEP = process.argv.includes("--keep");
const PORT = Number(process.env.GAUNTLET_PORT ?? 8091);
const BASE = `http://localhost:${PORT}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const WORK = join(tmpdir(), `vigil-gauntlet-${RUN}`);
const LOG = join(WORK, "server.log");
mkdirSync(WORK, { recursive: true });

const results = [];
let page;
let failures = 0;

function log(msg) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${msg}\n`);
}

async function step(name, fn, { fatal = false } = {}) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    failures += 1;
    const file = join(WORK, `fail-${results.length + 1}.png`);
    try {
      if (page) await page.screenshot({ path: file, fullPage: true });
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    results.push({ name, ok: false, ms: Date.now() - t0, error: message, screenshot: file });
    log(`  FAIL ${name}: ${message}`);
    if (fatal) throw new Error(`fatal step failed: ${name}`);
  }
}

function startServer() {
  const env = {
    ...process.env,
    PGLITE_DATA_DIR: join(WORK, "pglite"),
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: "gauntlet-session-secret-not-for-production",
    VIGIL_KEY_SECRET: "gauntlet-key-secret",
    VIGIL_DATA_DIR: join(WORK, "data"),
    VIGIL_LLM_MOCK: REAL ? "0" : "1",
    VIGIL_EXTRACT_CHARS: REAL ? (process.env.VIGIL_EXTRACT_CHARS ?? "") : "60000",
    VIGIL_PLATFORM_KEYS_FOR: "all",
  };
  const child = spawn("npx", ["vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  const sink = (d) => {
    chunks.push(d);
    writeFileSync(LOG, Buffer.concat(chunks));
  };
  child.stdout.on("data", sink);
  child.stderr.on("data", sink);
  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}; see ${LOG}`);
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`server did not answer on ${BASE} within 120 s; see ${LOG}`);
}

async function signUp(p, email, name) {
  await p.goto(`${BASE}/login`);
  await p.waitForLoadState("networkidle");
  // Vite may reload the page once while it optimises dependencies; retry the toggle.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await p.getByRole("button", { name: /Need an account/ }).click();
    try {
      await p.getByLabel("Name").waitFor({ timeout: 4000 });
      break;
    } catch {
      await p.waitForTimeout(1500);
    }
  }
  await p.getByLabel("Name").fill(name);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("gauntlet-password-2026");
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL(/\/app/, { timeout: 30_000 });
  await p.getByRole("heading", { name: "Strategies" }).waitFor({ timeout: 30_000 });
}

async function toast(p, re, timeout = 30_000) {
  const wanted = p.locator("[data-sonner-toast]").filter({ hasText: re }).first();
  const any = p.locator("[data-sonner-toast]").first();
  const deadline = Date.now() + timeout;
  let lastOther = "";
  while (Date.now() < deadline) {
    if (await wanted.count()) return (await wanted.textContent()) ?? "";
    if (await any.count()) {
      const text = ((await any.textContent()) ?? "").trim();
      if (text && !re.test(text)) lastOther = text;
    }
    await p.waitForTimeout(250);
  }
  throw new Error(`no toast matching ${re}${lastOther ? ` (saw: “${lastOther.slice(0, 160)}”)` : ""} within ${timeout} ms`);
}

/** Visit every screen once so the dev server finishes optimising before the real steps. */
async function warmUp(p) {
  for (const path of ["/app", "/app/keys", "/app/admin", "/app"]) {
    await p.goto(`${BASE}${path}`);
    await p.waitForLoadState("networkidle");
  }
  await p.getByRole("button", { name: "Upload a strategy" }).click();
  await p.getByLabel(/Or a public URL/).waitFor();
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "New strategy" }).click();
  await p.getByLabel("Title").waitFor();
  await p.keyboard.press("Escape");
  await p.waitForTimeout(3000);
  await p.goto(`${BASE}/app`);
  await p.waitForLoadState("networkidle");
}

async function tab(p, name) {
  await p.getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) }).click();
}

async function download(p, buttonName) {
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: buttonName }).click()]);
  const path = await dl.path();
  if (!path) throw new Error("download had no path");
  return readFileSync(path, "utf8");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  log(`gauntlet ${REAL ? "REAL" : "MOCK"} · ${BASE} · work dir ${WORK}`);
  const pdfPath = join(WORK, "meridia-strategy.pdf");
  const mdPath = join(WORK, "implementation-note.md");
  const pages = strategyPages();
  writeFileSync(pdfPath, makePdf(pages));
  writeFileSync(mdPath, companionMarkdown());
  const fixtureChars = pages.reduce((n, pg) => n + pg.length, 0);
  log(`fixture: ${pages.length} pages, ~${fixtureChars.toLocaleString()} characters`);

  const server = startServer();
  const cleanup = () => {
    if (!KEEP && server.exitCode === null) server.kill("SIGTERM");
  };
  process.on("exit", cleanup);
  await waitForServer(server);
  log("server up");
  // Warm the dev server so dependency optimisation and its reload happen before the steps.
  for (const path of ["/", "/login", "/app"]) {
    try {
      await fetch(`${BASE}${path}`);
    } catch {
      /* ignore */
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${m.location().url}`);
  });
  page.on("dialog", (d) => d.accept());
  const ownerEmail = `owner-${RUN.toLowerCase()}@example.com`;
  const viewerEmail = `viewer-${RUN.toLowerCase()}@example.com`;

  await step("landing page renders", async () => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: /Watch the conditions/ }).first().waitFor();
    await page.waitForTimeout(2500);
  });

  await step("sign up (first account becomes administrator)", async () => {
    await signUp(page, ownerEmail, "Gauntlet Owner");
    await page.getByRole("link", { name: "Admin" }).waitFor();
    await warmUp(page);
  }, { fatal: true });

  await step("empty portfolio", async () => {
    await page.getByText("Nothing watched yet").waitFor();
  });

  await step("load the Romania sample and tour every tab", async () => {
    await page.getByRole("button", { name: "Load Romania sample" }).click();
    await page.getByRole("heading", { name: /Romania National Disaster Risk Reduction/ }).waitFor({ timeout: 30_000 });
    const queueTab = await page.getByRole("button", { name: /^Queue/ }).textContent();
    assert(/\d/.test(queueTab ?? ""), `queue tab shows no count: ${queueTab}`);
    for (const name of ["Categories", "Assumptions", "Signals", "Queue", "Log", "Review", "Peers", "Team", "Overview"]) {
      await tab(page, name);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(2000);
  });

  await step("portfolio shows attention chips", async () => {
    await page.goto(`${BASE}/app`);
    await page.getByText(/queue \d+/).first().waitFor();
    await page.getByText(/you are owner/).first().waitFor();
  });

  let extractionNote = "";
  await step("upload PDF + markdown, extract the whole document", async () => {
    await page.getByRole("button", { name: "Upload a strategy" }).click();
    await page.locator("#strategy-files").setInputFiles([pdfPath, mdPath]);
    await toast(page, /Read 2 files/, 60_000);
    await page.getByText(/\d+ pages/).first().waitFor();
    await page.getByRole("button", { name: "Extract monitoring architecture" }).click();
    extractionNote = await toast(page, /Architecture extracted/, REAL ? 900_000 : 180_000);
    await page.getByRole("heading", { name: /NATIONAL DIGITAL TRANSFORMATION STRATEGY|Meridia|Digital/i }).waitFor({ timeout: 30_000 });
  }, { fatal: true });

  await step("extraction read every character, in several passes", async () => {
    const note = await page.getByText(/Extraction read/).first().textContent();
    assert(note && /read all [\d,]+ characters/.test(note), `note does not claim full coverage: ${note}`);
    assert(note.includes(`${pages.length} pages`), `note does not mention ${pages.length} pages: ${note}`);
    if (!REAL) assert(/in \d+ passes plus a consolidation pass/.test(note), `expected multi-pass note, got: ${note}`);
    log(`    ${note}`);
  });

  await step("extracted architecture is populated", async () => {
    await tab(page, "Assumptions");
    const bets = await page.getByText(/of 12 bets named/).textContent();
    const n = Number((bets ?? "").match(/(\d+) of 12/)?.[1] ?? 0);
    assert(n >= 6, `expected at least 6 assumptions, got ${n}`);
    await tab(page, "Signals");
    const active = await page.getByText(/Active \d+\/30/).textContent();
    const a = Number((active ?? "").match(/Active (\d+)\/30/)?.[1] ?? 0);
    assert(a >= 8, `expected at least 8 active signals, got ${a}`);
    await tab(page, "Review");
    await page.getByRole("button", { name: "Fire" }).first().waitFor();
    await tab(page, "Overview");
    await page.getByText(/meridia-strategy\.pdf/).waitFor();
    await page.getByText(/implementation-note\.md/).waitFor();
  });

  const strategyUrl = page.url();

  await step("change an assumption status with evidence", async () => {
    await tab(page, "Assumptions");
    await page.getByRole("row").nth(1).click();
    await page.getByLabel("Status").selectOption("broken");
    await page.getByLabel(/Evidence for the change/).fill("Ministry letter: the loan will not be extended beyond 2029.");
    await page.getByRole("button", { name: /Set to broken/ }).click();
    await toast(page, /Status set to broken/);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByText("1 broken bet").waitFor();
  });

  await step("record a reading that crosses the amend threshold", async () => {
    await tab(page, "Signals");
    await page.getByRole("row").nth(1).click();
    await page.getByLabel(/Current value/).fill("99");
    await page.getByLabel("Threshold crossed").selectOption("amend");
    await page.getByLabel(/Evidence \(required\)/).fill("Regulator coverage map, Q2 2026.");
    await page.getByRole("button", { name: "Record reading" }).click();
    await toast(page, /amend threshold crossed/);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByText(/1 threshold crossed/i).waitFor();
  });

  await step("queue ranks the broken bet first and a decision clears it", async () => {
    await tab(page, "Queue");
    const first = page.locator("article, .rounded-xl").filter({ hasText: "#1" }).first();
    await first.waitFor();
    const text = await first.textContent();
    assert(/assumption · suggested/.test(text ?? ""), `first card is not the broken assumption: ${text?.slice(0, 120)}`);
    await first.getByRole("textbox").fill("Reviewed at the gauntlet sitting.");
    await first.getByRole("button", { name: "no-change" }).click();
    await first.getByRole("button", { name: "Log decision" }).click();
    await toast(page, /Decision logged/);
    await page.getByText(/hidden by a logged decision/).waitFor();
  });

  await step("fire and close a red line", async () => {
    await tab(page, "Review");
    await page.getByRole("button", { name: "Fire" }).first().click();
    await toast(page, /Interrupt fired/);
    await tab(page, "Queue");
    const first = page.locator("article, .rounded-xl").filter({ hasText: "#1" }).first();
    assert(/interrupt · suggested refresh/.test((await first.textContent()) ?? ""), "fired interrupt is not first in the queue");
    await tab(page, "Review");
    await page.getByRole("button", { name: "Close" }).first().click();
    await toast(page, /Interrupt closed/);
    await page.getByRole("button", { name: "Re-arm" }).first().waitFor();
  });

  await step("assess the strategy: rate delivery with a basis, check a bet, then accept a model proposal", async () => {
    await tab(page, "Overview");
    await page.getByRole("button", { name: /Assess this strategy|Update assessment/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByLabel(/^Amber/).check();
    await dialog.getByLabel("Source of the score").fill("Annual progress report 2025, Ministry of Digital, p. 31");
    await dialog.getByLabel("As of").fill("2025-12-31");
    await dialog.getByLabel(/^Basis/).fill("2025 progress report: 14 of 41 Annex 1 actions delivered on time; two connectivity packages stalled.");
    const row = dialog.locator("[data-bet-row]").nth(1);
    await row.getByRole("button", { name: "Change" }).click();
    await row.getByLabel("Status").selectOption("weakening");
    await row.getByLabel(/Evidence for the change/).fill("County returns Q2 2026: three of eight counties below 50 percent absorption.");
    await dialog.getByRole("button", { name: "Save assessment" }).click();
    const t = await toast(page, /Assessment saved · delivery amber · validity/);
    log(`    ${t}`);
    await page.getByText("Delivery · did we do the plan?").waitFor();
    assert((await page.getByText(/Rated by .* as of 2025-12-31/).count()) >= 1, "delivery provenance line missing");
    await page.getByText(/What sets the colour/).waitFor();
    await page.screenshot({ path: join(WORK, "overview-assessed.png"), fullPage: true });
    // Second pass: the model proposes, a person accepts one row, and the desk mark is kept.
    await page.getByRole("button", { name: "Update assessment" }).click();
    const again = page.getByRole("dialog");
    await again.getByRole("button", { name: "Propose from what is on file" }).click();
    await again.getByText(/\d+ proposals?\./).waitFor({ timeout: REAL ? 600_000 : 60_000 });
    const accept = again.locator("[data-bet-row]").first().getByRole("checkbox");
    await accept.check();
    await again.getByRole("button", { name: "Save assessment" }).click();
    await toast(page, /Assessment saved/);
    await tab(page, "Assumptions");
    await page.getByRole("row").nth(1).click();
    await page.getByText("model-drafted").first().waitFor();
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("add and remove a cliff", async () => {
    await tab(page, "Review");
    await page.getByLabel("New cliff").fill("Gauntlet funding sunset");
    await page.getByLabel("Date").fill("2027-06-30");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await toast(page, /Cliff added/);
    const row = page.locator("div").filter({ hasText: /^Gauntlet funding sunset/ }).first();
    await row.getByRole("button", { name: "Remove" }).click();
    await page.getByText("Gauntlet funding sunset").waitFor({ state: "detached" });
  });

  await step("add a signal and an assumption within the budgets", async () => {
    await tab(page, "Signals");
    const before = Number(((await page.getByText(/Active \d+\/30/).textContent()) ?? "").match(/Active (\d+)/)?.[1] ?? 0);
    await page.getByRole("button", { name: "Add signal" }).click();
    await page.getByLabel("Name").fill("Gauntlet watchpoint");
    await page.getByRole("button", { name: "Add signal" }).last().click();
    await toast(page, /Signal added/);
    const after = Number(((await page.getByText(/Active \d+\/30/).textContent()) ?? "").match(/Active (\d+)/)?.[1] ?? 0);
    assert(after === before + 1, `active count went ${before} -> ${after}`);
    await tab(page, "Assumptions");
    const bets = Number(((await page.getByText(/of 12 bets named/).textContent()) ?? "").match(/(\d+) of 12/)?.[1] ?? 0);
    if (bets < 12) {
      await page.getByRole("button", { name: "Add assumption" }).click();
      await page.getByLabel("Claim").fill("The county operators will maintain the networks after handover.");
      await page.getByRole("button", { name: "Add assumption" }).last().click();
      await toast(page, /Assumption added/);
    }
  });

  await step("draft amendments with verified quotations", async () => {
    await tab(page, "Review");
    await page.getByRole("button", { name: "Draft changes from the original" }).click();
    const t = await toast(page, /changes drafted/, REAL ? 600_000 : 60_000);
    log(`    ${t}`);
    await page.getByText("Proposed text").first().waitFor();
    if (!REAL) {
      assert((await page.getByText("quote verified").count()) >= 2, "expected two verified quotes");
      assert((await page.getByText("quote not found in text").count()) === 1, "expected one flagged quote");
    } else {
      const verified = await page.getByText("quote verified").count();
      const flagged = await page.getByText("quote not found in text").count();
      log(`    quotes verified: ${verified}, flagged: ${flagged}`);
    }
  });

  await step("peer research keeps only findings that cite a returned source", async () => {
    await tab(page, "Peers");
    await page.getByRole("button", { name: "Run research brief" }).click();
    const t = await toast(page, /Compared \d+ ideas/, REAL ? 600_000 : 60_000);
    log(`    ${t}`);
    if (!REAL) {
      assert(/Compared 3 ideas from 4 sources \(1 dropped/.test(t), `unexpected peer toast: ${t}`);
      await page.getByText("Estonia").first().waitFor();
    }
    await page.getByRole("heading", { name: "Latest research brief" }).waitFor();
  });

  await step("search adjacent evidence from an assumption", async () => {
    await tab(page, "Assumptions");
    await page.getByRole("row").nth(1).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    if (!REAL) await page.getByText("Estonia Digital Agenda").waitFor();
    else await page.locator("a[target=_blank]").first().waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("downloads carry the analysis and the brief without sample leakage", async () => {
    const analysis = await download(page, "Download analysis");
    const brief = await download(page, "Download revision brief");
    assert(analysis.includes("## Snapshot"), "analysis lacks the snapshot");
    assert(analysis.includes("## Ideas from peer strategies"), "analysis lacks the peer section");
    assert(!/Romania|DesInventar|Vrancea/.test(analysis), "analysis leaks Romania copy");
    assert(brief.includes("## Proposed changes to the original document"), "brief lacks amendments");
    if (!REAL) assert(brief.includes("not found in the stored text"), "brief does not flag the unverified quote");
    writeFileSync(join(WORK, "analysis.md"), analysis);
    writeFileSync(join(WORK, "brief.md"), brief);
  });

  await step("settings change the document language", async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Document language").fill("Meridian");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await toast(page, /Strategy updated/);
    await page.getByText("· Meridian").waitFor();
  });

  await step("paste path: new strategy from pasted text", async () => {
    await page.goto(`${BASE}/app`);
    await page.getByRole("button", { name: "New strategy" }).click();
    await page.getByLabel("Title").fill("Meridia Climate Adaptation Roadmap 2027-2035");
    await page.getByLabel("Strategy text (optional)").fill(pastedText());
    await page.getByRole("button", { name: "Create and extract architecture" }).click();
    await page.getByRole("heading", { name: /Climate Adaptation Roadmap/ }).waitFor({ timeout: REAL ? 600_000 : 60_000 });
    const note = await page.getByText(/Extraction read/).first().textContent();
    assert(note && /in one pass/.test(note), `pasted text should be read in one pass: ${note}`);
  });

  if (!REAL) {
    await step("url path: pull a page through the reader and extract", async () => {
      await page.goto(`${BASE}/app`);
      await page.getByRole("button", { name: "Upload a strategy" }).click();
      await page.getByLabel(/Or a public URL/).fill("https://example.org/meridia-digital-strategy");
      await page.getByRole("button", { name: "Extract monitoring architecture" }).click();
      await toast(page, /Architecture extracted/, 60_000);
      await page.getByRole("heading", { name: /National Digital Transformation Strategy/ }).waitFor();
    });
  }

  await step("keys page saves, tests and removes a personal key", async () => {
    await page.goto(`${BASE}/app/keys`);
    const card = page.locator("section").filter({ hasText: "Language models" }).locator("div.rounded-xl").first();
    await card.getByLabel("Save to my account").fill(REAL ? (process.env.XAI_API_KEY ?? "mock-key-12345678") : "mock-key-12345678");
    await card.getByRole("button", { name: "Persist" }).click();
    await toast(page, /key saved to your account/);
    await card.getByText(/Active via personal · ends/).waitFor();
    await card.getByRole("button", { name: "Test key" }).click();
    await toast(page, REAL ? /models available|Key accepted/ : /Offline mock accepted/, 60_000);
    await card.getByRole("button", { name: "Remove" }).click();
    await toast(page, /Key removed/);
  });

  await step("share with a viewer who can read but not edit", async () => {
    const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const vp = await viewerContext.newPage();
    vp.on("dialog", (d) => d.accept());
    await signUp(vp, viewerEmail, "Gauntlet Viewer");
    await page.goto(strategyUrl);
    await tab(page, "Team");
    await page.getByLabel("Add by email").fill(viewerEmail);
    await page.getByLabel("Role").selectOption("viewer");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await toast(page, /added as viewer/);
    await vp.goto(strategyUrl);
    await vp.getByText("viewer", { exact: true }).first().waitFor({ timeout: 30_000 });
    assert((await vp.getByRole("button", { name: "Settings" }).count()) === 0, "viewer sees Settings");
    await vp.getByRole("button", { name: /^Signals/ }).click();
    assert((await vp.getByRole("button", { name: "Add signal" }).count()) === 0, "viewer can add signals");
    await vp.getByRole("button", { name: /^Queue/ }).click();
    await vp.getByText("Read-only access").first().waitFor();
    await vp.goto(`${BASE}/app`);
    await vp.getByText(/you are viewer/).waitFor();
    await viewerContext.close();
  });

  await step("owner deletes a strategy after confirming", async () => {
    await page.goto(`${BASE}/app`);
    const card = page.locator("li").filter({ hasText: "Climate Adaptation Roadmap" }).first();
    await card.getByRole("button", { name: "Delete" }).click();
    await toast(page, /Strategy deleted/);
    await page.getByText("Climate Adaptation Roadmap").waitFor({ state: "detached" });
  });

  await step("unknown route shows the not-found page", async () => {
    await page.goto(`${BASE}/definitely-not-a-page`);
    await page.getByText("Nothing here").waitFor();
  });

  await step("sign out", async () => {
    await page.goto(`${BASE}/app`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/app"), { timeout: 30_000 });
  });

  await step("no page errors during the run", async () => {
    // The not-found step expects an HTTP 404; platform assets do not exist locally.
    const real = consoleErrors.filter((e) => !/favicon|manifest|__grok|definitely-not-a-page|Download the React DevTools/i.test(e));
    assert(real.length === 0, `console/page errors: ${real.slice(0, 3).join(" | ")}`);
  });

  await browser.close();
  cleanup();

  const passed = results.filter((r) => r.ok).length;
  log("");
  log(`${passed}/${results.length} steps passed${failures ? `, ${failures} failed` : ""} · artifacts in ${WORK}`);
  for (const r of results.filter((x) => !x.ok)) log(`  FAIL ${r.name}: ${r.error}  (${r.screenshot})`);
  if (extractionNote) log(`  extraction toast: ${extractionNote.trim()}`);
  writeFileSync(join(WORK, "results.json"), JSON.stringify({ real: REAL, results }, null, 2));
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  log(`gauntlet aborted: ${err instanceof Error ? err.message : String(err)}`);
  if (existsSync(LOG)) log(`server log tail:\n${readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n")}`);
  process.exit(2);
});
