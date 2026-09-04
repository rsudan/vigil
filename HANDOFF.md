# Vigil handoff

Last updated 2026-09-04, after PR #2. Read this before touching the code in a new session.

## What Vigil is

A living-document monitor for national strategies. It does not ask whether activities happened; it asks whether the strategy still needs to change, and writes the words that should go back into the document. The method is in `src/lib/methodology.ts` and `src/lib/glossary.ts`: load-bearing assumptions (bets) with statuses, signals with pressure and pre-committed thresholds, sentinels, interrupts (red lines), cliffs (dated events), a ranked decision queue, a decision log, two separate colours (delivery: did we do the plan; validity: are the bets still true), and quoted amendments against the original text.

Owner: Randeep Sudan (rsudan@gmail.com, GitHub `rsudan`). He is the method's author. He reviews the app one screen at a time and gives numbered observations; address them fully before moving to the next screen.

## Where things are

- GitHub: `https://github.com/rsudan/vigil`, branch `main`. Merged so far: PR #1 (review fixes, whole-document extraction, gauntlet) and PR #2 (Overview clarity and the assessment mechanism).
- `~/vigil`: Randeep's own checkout. He runs `npm run dev` there (port 8080) and tests in the browser. Keep it on `main`; after merging, `git -C ~/vigil pull --ff-only` and, when a migration was added, restart his dev server.
- `~/Code/vigil`: the working clone for changes. Branch per change, push, `gh pr create`, `gh pr merge --squash`, then pull `~/vigil`. He has authorised this pattern; the only thing he has asked not to do without asking is spend money (real model or search calls).
- `~/Code/vigil-source`: the untouched original export from the Grok app-builder. Reference only.
- `~/Code/.claude/launch.json`: lets the Claude preview tool run the app on port 8090 without colliding with 8080.
- No provider keys exist on this machine. Everything model-dependent is verified through the offline mock (`VIGIL_LLM_MOCK=1`).

## How to run and verify

```bash
npm run dev                      # http://localhost:8080; first account is administrator; data persists in .pglite/
npm test                         # 114 unit tests (queue, validity, rooms, reading the document, extraction windows, retrieval, crypto, rate limits)
npm run gauntlet                 # end to end in a real browser on a fresh database with the mock: 31 steps
npm run gauntlet -- --real       # same against real keys (XAI_API_KEY etc., EXA_API_KEY, JINA_API_KEY); costs money
npx tsc --noEmit && npx eslint . # both must be clean
npm run build                    # production build must pass
```

The gauntlet starts its own server on 8091, writes artifacts (screenshots, downloaded briefs, server log) to a temp dir it prints, and captures `overview-assessed.png` after the assessment step. After any change to upload, extraction, the queue, sharing or the Overview, run it until three consecutive passes.

Settings are documented in `.env.example`: `VIGIL_KEY_SECRET`, `VIGIL_PLATFORM_KEYS_FOR`, `VITE_DISABLE_SIGNUP`, `VITE_GROK_OAUTH`, `VIGIL_EXTRACT_CHARS`, `VIGIL_LLM_MOCK`, `PGLITE_DATA_DIR`.

## Code map

- `src/lib/compute.ts`: `buildQueue` (ranked, decision-aware), `buildMetrics`, `validityOf`, `cellReading`, `thresholdText`, `daysUntil` (calendar days, shared with the rooms). Pure, unit-tested.
- `src/lib/room-read.ts`: reading the uploaded document into the ten rooms. Pure and modelless: lexical search over stored chunks, then a sentence is kept only if it carries two of that room's `terms` (in `category-guide.ts`), folded so "ministries" meets "ministry" and "assumes" meets "assumption". Segmentation works on lines before anything is flattened, so a heading never welds onto the sentence below it, a list item stands alone, and sentences end at a full stop and never at a semicolon or colon. `readsLikeProse` rejects flattened table rows, column-header strips and all-caps titles. Returns a verbatim sentence with its page, or its position when the document has no pages.
- `src/lib/server/rooms.ts`: `readDocumentIntoRooms` (free, no key), `searchRoom` (one Exa call and one model call per room, only on a click, grounded like `researchPeers`), `decideRoomFinding`.
- `src/lib/category-analysis.ts`: the ten rooms. What sits in a room (watchpoints by their own room; bets only through a home watchpoint; red lines by `interrupts.category`, Risks when unset; cliffs by kind), the verdict, and a reading that names the strongest fact ranked as `RANK` in compute.ts ranks it. `src/lib/day.ts` is the one calendar-day helper for every screen and export.
- `src/lib/glossary.ts`: all user-facing terms, `RAG_HELP` with `deliveryWord()`, `VALIDITY_HELP`, `CELL_READINGS` (the nine cell sentences, in Randeep's voice, not yet signed off by him).
- `src/lib/server/strategies.ts`: `loadBundle`, every register mutation, `assessStrategy`, `applyAssumptionStatus` (the one rule for moving a bet: a status change needs ten characters of evidence), sharing.
- `src/lib/server/ai.ts` + `extract.ts` + `extract-plan.ts`: parsing (page-aware PDF), whole-document extraction (one pass or multi-pass plus consolidation), coverage note.
- `src/lib/server/research.ts`: `draftAmendments` (retrieval-grounded, quotes verified), `researchPeers` (source-enforced), `proposeAssessment` (model proposes, person accepts; a bet is never coloured from the strategy text alone).
- `src/lib/server/mock.ts`: deterministic stand-ins for the model, Exa and Jina; any key starting with `mock` in mock mode.
- `src/lib/server/keys.ts`, `crypto.ts`, `rate-limit.ts`, `access.ts`, `schemas.ts`: keys encrypted at rest, per-user rate limits, roles, zod on every input.
- `src/components/strategy-workspace.tsx`: the workspace shell, Overview, Categories, boards, log. `src/components/workspace/*`: assessment card and dialog, assumption and signal drawers and forms, queue, review, peers, team, settings.
- `scripts/gauntlet/run.mjs` and `fixture-pdf.mjs`: the end-to-end runner and the synthetic 41-page strategy.
- `migrations/0001`–`0010`: applied automatically by PGLite; `0009_room_evidence.sql` adds `strategies.jurisdiction`, `room_passages`, `room_reads` and `room_findings`, and `0010_room_finding_quote.sql` adds `room_findings.quote_verified`. Never edit a migration that has been committed: both appliers key `_migrations` by filename, so an edited file is never re-run and the change silently never reaches a database that already had it.

## Working conventions that have held

- Substantive design questions go to a judge panel (three proposals from different angles, two judges); implementations get an adversarial review (three lenses, each finding checked by three skeptics) before merging. Both have caught real defects.
- Copy is plain and in the method's voice: two questions, no jargon on the card, one word per grey state everywhere ("Not rated" for delivery; "Not assessed" / "Partly checked" for validity).
- No rating or colour without a dated, attributed basis. Model output is proposed, never applied.
- Romania is the sample, not the product: no Romania text in generic copy or exports.

## State of the screens

Reviewed with Randeep and reworked: **Overview** (collapsible terms, plain totals, Assessment card and dialog); **Categories** (rooms hold red lines and cliffs, bets sit only through their home watchpoints, a room can no longer read calm over a fired red line or a passed cliff). Not yet reviewed by him: Assumptions, Signals, Queue, Log, Review, Peers, Team, the Strategies portfolio, Keys, Admin, Login. He tested with a Romanian youth strategy he uploaded himself.

On Categories he then asked for more than membership: "These categories should be populated based on the strategy uploaded or under review coupled with web search." That is now built. A room shows three things, and only the first can colour it: the register; what the uploaded document says here (verbatim sentences with page numbers, found by lexical search, no model, no key); and what a search found about this room since a date the user picks (one Exa call and one model call, only on a click). A test asserts every room's verdict, headline, pressure and second sentence are byte-identical with and without that material loaded.

## Open items

- `CELL_READINGS` in `src/lib/glossary.ts` need his sign-off.
- `strategies.jurisdiction` is new and only extraction and Settings fill it. Strategies created before 0009 have none, and a room refuses to search the world until it is set. His youth strategy needs it typed in, or a re-extraction.
- The per-room search has never run against a real Exa key or a real model; the offline mock proves the grounding rule and the query-per-room, not the quality of live results.
- `CATEGORY_GUIDE[].terms` are hand-written and English. A document stored in another language reports "too few of this room's words appear in this text" rather than silence, which is honest but not useful; the terms would have to be translated per strategy. Note that `strategies.language` describes the official instrument, not the stored text — his own upload is an English translation of a Romanian instrument — so the terms must never be chosen from that field.
- Scheduled alerts do not exist; the portfolio computes attention on open. Needs a scheduler and a mail provider.
- The real-key gauntlet has never been run; a live model's JSON discipline and quotation fidelity are unverified.
- Large PDFs travel to and from the client as JSON (12 MB cap); a 4.5 MB request limit on Vercel would bite on very long text-heavy documents.
- `listStrategies` loads a full bundle per strategy; fine for tens, slow for hundreds.
- The Grok app-builder scaffold (PWA plugin, preview bridge, brand checks) is still in the tree; its own tests run under `npm run test:scaffold` and need that workspace's files.
