---
name: synthetic-user-testing
description: >
  Test a product with a pool of realistic synthetic users before real users see
  it. Sample personas from MatrAIx Persona 1M, let an LLM (or your subagents) play each one, run them through a scenario you
  define (a described flow, or a live chat endpoint), and get an aggregated
  report of where different user types succeed, stall, or bail. Use when the user
  asks to "test with synthetic/simulated users", "run a persona study", "see how
  different users react", "find UX drop-off", or "simulate a focus group".
---

# Synthetic user testing (synthusers)

You (the agent) drive this. The harness lives at `~/synthusers` (a standalone
repo). It is project-agnostic: point a scenario at ANY product.

## When to use
- The user wants product/UX signal across diverse user types before shipping.
- Questions like: "would low-tech users finish onboarding?", "does our support
  bot actually resolve refund requests?", "which segment drops off?"

Not a substitute for real users. Results are directional (hypothesis generation).

## Setup (once)
```bash
cd ~/synthusers && npm install
npx tsx src/cli.ts fetch --shards all   # MatrAIx Persona 1M cache, ~880 MB (see Cohorts below)
```
No model key is needed for the default path below: YOU and your subagents play the
personas. A key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, `MODEL="provider/id"`) is
only needed for the optional `run` command.

## Default path: you fan out subagents (no key)
1. Write a survey scenario (JSON file, or inline `--system` / `--task`; see below).
2. Print one ready role-play prompt per persona:
   ```bash
   npx tsx src/cli.ts prompts scenarios/my.json --size 30 --stratify region --seed 1 > out/prompts.jsonl
   ```
   Each line is `{id, persona, prompt}`. The prompt already has the persona, the product
   context, the task and the reporting instruction.
3. For each line, start one subagent (dsh `subagent`, Claude Code `Task`) with `prompt`
   as its whole task. Start them in parallel batches. Tell each to reply with ONLY this JSON:
   `{"answer": string, "rating": 1-5, "reasoning": string, "frictions": string[], "succeeded": boolean}`
   Use a cheap model. Subagents must not use tools or read the repo: they only role-play.
4. Write one line per reply to `out/results.jsonl`: `{"id": "<id from prompts>", "report": {...}}`.
5. Aggregate:
   ```bash
   npx tsx src/cli.ts report out/results.jsonl --prompts out/prompts.jsonl --segment tech_savviness --segment region
   ```
   Bad or missing reports are listed as warnings and left out of the rates.
Survey scenarios only: chat scenarios call a live endpoint from code, so use `run` for them.

## Alternative: `run` (needs a model key)
One command samples, calls the LLM per persona and prints the same report:
```bash
MODEL=openai/gpt-4o-mini npx tsx src/cli.ts run \
  --system "You just installed <app>, a <what it is>." \
  --task "Do <flow step by step>. At each step decide continue or bail, and why. Your 'answer' must be '<outcome A>' or '<outcome B>'." \
  --segment tech_savviness --segment cog_patience --out out/trials.jsonl
```
Open `out/trials.jsonl` to read individual transcripts and cite the exact ones that failed.

## Reusable survey: a JSON scenario (safe to author)
Write a JSON file, no code needed:
```json
{
  "id": "checkout-v2",
  "env": "survey",
  "system": "You are buying a laptop on <site>.",
  "task": "Find a laptop under $800 you trust and reach the payment screen. Decide at each step continue or bail. 'answer' = 'reached payment' or 'abandoned at <step>'.",
  "cohort": { "cog_patience": ["Low", "None", "Moderate"] },
  "segmentBy": ["tech_savviness", "socioeconomic_band"]
}
```
Run with `prompts` (default path above) or `run path/to/checkout-v2.json` (needs a key).

## Higher fidelity: chat against a REAL endpoint
Survey mode tests your *description* of the flow (can drift from the built app).
To test real behavior, write a TS scenario whose `respond()` calls the live bot:
```ts
// myscenario.ts
import type { Scenario, ChatMessage } from "~/synthusers/src/types.js";
const s: Scenario = {
  id: "support-refund", env: "chat", turns: 6,
  system: "You are chatting with <app>'s support assistant.",
  task: "You were double-charged. Get a refund. See if the bot actually helps.",
  respond: async (messages: ChatMessage[]) => {
    const r = await fetch("https://your-app/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    return (await r.json()).reply;
  },
};
export default s;
```
Run: `npx tsx src/cli.ts run myscenario.ts`

## Cohorts and personas
- Pool: MatrAIx Persona 1M (~1M personas x up to 1,290 fields). One-time setup:
  `npx tsx src/cli.ts fetch --shards all` (~880 MB; `--shards 9` for a quick 80 MB start of synthetic personas).
  Without the cache you only get 8 fallback personas: tell the user to run `fetch`.
- Find fields: `npx tsx src/cli.ts fields --search patience`, `fields <fieldId>` for values.
  Useful ones: `tech_savviness`, `cog_patience`, `socioeconomic_band`, `risk_tolerance`,
  `time_pressure`, `device_context`, `age_bracket`, `region`, `demo_parental_status`.
- Select a cohort: `--filter "tech_savviness=Reluctant|Avoidant" --filter region=South\ Asia`,
  `--stratify region,age_bracket` for a population-like spread, `--seed N` to reproduce,
  `--source synthetic,stackoverflow,...`, `--size N`. Use field ids in `cohort` and
  `segmentBy` of scenarios too. Wrong ids or values fail with suggestions.
- Preview first: `npx tsx src/cli.ts personas --filter ... --size 20`.
- Data is research-only licensed: do not commit cached data or paste many personas into repos.

## Workflow for the agent
1. Read the target flow in the codebase (don't guess it).
2. Author an inline/JSON survey, or a chat scenario against the live endpoint.
3. Run with a cheap model + small `--size` first to sanity-check (try 5 personas).
4. Read the report AND a few failing transcripts.
5. Report findings to the user as segment-level insights ("low-patience users
   bail at bank-connect: 6/10"), citing transcripts. Rerun after fixes to compare.

## Cost
1 LLM call per persona (survey), up to ~2*turns (chat), whether through subagents or
`run`. Keep `--size` at 10 to 30 while iterating; 100+ only for a final read.
