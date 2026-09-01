# Vigil

A living-document monitor for national strategies and roadmaps.

Vigil does not ask whether the activities happened. It asks whether the strategy still needs to change — and writes the words that should go back into the original document.

## What it does

- Extracts load-bearing assumptions, sentinels, interrupts and cliffs from an uploaded strategy (PDF, Word, spreadsheet, or URL)
- Scores watchpoints on a **1–125 pressure scale** (how much it matters × how fast it can move × how little you trust the number)
- Reads every strategy through **ten rooms** (external, technology, assumptions, delivery, resources, mandate, legitimacy, risks, evidence, opportunity)
- Triages a **queue of at most 12** items for a review sitting
- Drafts **quoted amendments** against the original text
- Researches **peer national strategies** in a recency window you set (Exa + a language-model key)
- Downloads an analysis and a revision brief

Bring-your-own-keys (xAI, OpenAI, Anthropic, OpenRouter, Gemini, Perplexity, Exa, Jina). An administrator can persist organisation keys for selected users.

## Run it

```bash
npm install
npm run dev
```

Auth is on. The first signed-in user becomes administrator. Without `DATABASE_URL` it uses an embedded Postgres (PGLite). With `DATABASE_URL` it uses Neon or any Postgres.

Set language-model and Exa keys in **Keys**. Load the Romania DRR sample from **Strategies** to see the method on a real document.

## Method in one line

Watch the conditions under which a strategy needs to change.
