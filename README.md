# Vigil

A living-document monitor for national strategies and roadmaps.

Vigil does not ask whether the activities happened. It asks whether the strategy still needs to change, and writes the words that should go back into the original document.

## What it does

- Extracts load-bearing assumptions, signals, interrupts and cliffs from an uploaded strategy (PDF, Word, spreadsheet, text, or URL). The whole document is read: in one pass when it fits the model's window, otherwise in several passes that are consolidated. Every page is stored in chunks with its page number, and the workspace records exactly how much text the extraction read and with which model.
- Scores watchpoints on a **1–125 pressure scale** (how much it matters × how fast it can move × how little you trust the number), and lets each signal name the readings that would justify a **watch, amend, refresh, or reset**.
- Keeps the register alive: record readings and evidence, move a bet between holding / weakening / broken / untested (with the evidence that justifies it), mark which threshold a reading has crossed, fire and close red lines, add and remove cliffs, park and retire signals within the 30-signal, 8-sentinel budget.
- Assesses each strategy on two questions, scored separately. **Delivery** (did we do the plan?) is rated from a progress report with its source, as-of date and a written basis, kept as an append-only history. **Validity** (are the bets still true?) is never set by hand: it is derived from the bets' statuses and is green only when every bet has been checked and holds. A model can propose an assessment from what is on file, but a person accepts each row, and accepted rows stay marked as model-drafted.
- Ranks a **decision queue of at most 12** by urgency. A logged decision clears its item until the condition changes again; items beyond the twelve are counted, not lost.
- Reads every strategy through **ten rooms** (external, technology, assumptions, delivery, resources, mandate, legitimacy, risks, evidence, opportunity). Each room is filled from three places. The **register**: the watchpoints filed there, the bets those watchpoints test, the red lines assigned to it and the cliffs its kind places there. The **uploaded document**: verbatim sentences with the page they sit on, found by lexical search with no model and no key, so a room the strategy never addressed says so. The **world**: what a search found about that room since a date you pick, one search and one model call, only when you ask, and every candidate must quote a source the search returned. Only the register can colour a room; the other two are material for a person to act on.
- Drafts **quoted amendments** against the original text, in the document's language, from the passages that match what has moved. Every quotation is checked against the stored text and flagged if it is not found.
- Researches **peer national strategies** in a recency window you set (Exa + a language-model key). Findings must cite a returned source; they are offered to the drafter as ideas, not pasted in as text.
- Shares a strategy with named **editors and viewers**, and records who logged each decision.
- Downloads an analysis and a revision brief.

Bring-your-own-keys (xAI, OpenAI, Anthropic, OpenRouter, Gemini, Perplexity, Exa, Jina). Keys are encrypted at rest. An administrator can persist organisation keys for selected users.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:8080. The first account created becomes administrator. Load the Romania DRR sample from **Strategies** to see the method on a real document, and set language-model and Exa keys in **Keys**.

Without `DATABASE_URL` the app uses an embedded Postgres (PGLite) persisted under `.pglite/`, so your work survives a restart. With `DATABASE_URL` it uses Neon or any Postgres. See `.env.example` for every setting, including:

- `VIGIL_KEY_SECRET` — encrypts stored API keys (falls back to `BETTER_AUTH_SECRET`, then a local file).
- `VIGIL_PLATFORM_KEYS_FOR` — who may spend keys set in the environment: `admins` (default), `all`, or `none`.
- `VITE_DISABLE_SIGNUP=true` — close self-registration once the team is on board.
- `VITE_GROK_OAUTH=true` — show Google / X sign-in, which only works when the Grok auth broker is configured. Outside that, sign-in is email and password.

Language-model and search calls are rate-limited per user (20 model calls and 40 searches per ten minutes on each server instance).

## What is not automated

Nothing runs on a schedule. Vigil computes what needs attention whenever someone opens it and shows it on the Strategies page, but it does not send email or push alerts when a review deadline passes or a cliff approaches. That needs a scheduler and a mail provider; the `listStrategies` server function returns the per-strategy attention summary a job would use.

## Tests

```bash
npm test                # Vigil's own logic: queue ranking and suppression, category verdicts, chunking, retrieval, crypto, rate limits
npm run gauntlet        # end to end in a real browser on a fresh database, with an offline stand-in for the model, Exa and Jina
npm run gauntlet -- --real   # the same run against your real keys (set XAI_API_KEY or another provider key, plus EXA_API_KEY and JINA_API_KEY)
npm run test:scaffold   # the Grok app-builder scaffold's own tests; some need that workspace's files and fail outside it
```

The gauntlet uploads a 45-page synthetic strategy as a PDF, extracts it in several passes, edits the register, logs decisions, drafts amendments, runs peer research, downloads the briefs, shares the strategy with a viewer, and checks the keys page. It starts its own server on port 8091 with its own database and leaves your data alone.

## Method in one line

Watch the conditions under which a strategy needs to change.
