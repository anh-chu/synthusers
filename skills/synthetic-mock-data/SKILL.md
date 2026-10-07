---
name: synthetic-mock-data
description: >
  Generate realistic, diverse seed/mock data for any app by grounding it in a
  pool of real-ish personas instead of random fakers. Each persona becomes one
  coherent domain record (demographics + correlated attributes preserved), then
  you map or LLM-expand it into the target schema. Use when the user asks to
  "generate synthetic mock data", "seed the database with realistic users",
  "create diverse test fixtures", or "make demo data based on the persona dataset".
---

# Synthetic mock data (personas -> rows)

Different job from synthetic-user *testing*. There, personas ACT. Here, personas
BECOME ROWS. Same persona pool at `~/synthusers`, different consumer.

Why this beats faker/random: Persona 1M preserves attribute correlation (no
19-year-old retired surgeon). Your seed data ends up demographically realistic
and diverse, not `Test User 1..N`.

## The key boundary (read this)
A persona gives you WHO the user is: age, region, occupation, budget, tech
savvy, psychology. It does NOT contain your domain rows (transactions, orders,
goals). YOU still generate the domain-specific records; the persona just makes
them coherent and varied. So the workflow is always: sample personas -> read the
target schema -> map/expand -> emit seed script.

## Step 1: sample a persona pool
```bash
cd ~/synthusers
npx tsx src/cli.ts personas --filter "socioeconomic_band=Low income|Lower-middle" --size 200 --seed 1 > cohort.jsonl
# population-like spread: npx tsx src/cli.ts personas --size 500 --stratify region,age_bracket --seed 1 > cohort.jsonl
```
The pool is MatrAIx Persona 1M (~1M personas x up to 1,290 fields). If `fetch` has not
been run, only 8 fallback personas exist: run `npx tsx src/cli.ts fetch --shards all`
first (~810 MB). Browse fields with `fields --search <text>`; wrong field ids or
values fail with suggestions.

Persona shape (fields you map from):
`id, name (empty), ageRange, region, occupation, summary, attributes{ <MatrAIx field id>: value }`.
Rows are sparse: always give a fallback when an attribute is missing.

## Step 2: read the TARGET schema
Open the actual schema in the project you are seeding (e.g. a Convex
`schema.ts`, a Prisma model, SQL DDL). Map persona fields to real columns. Do
NOT invent columns; match what exists.

## Step 3: choose fidelity

### A. Direct map (cheap, deterministic, no LLM)
Best default. Derive columns from persona fields with simple rules. See the
runnable template `scripts/mock-data-example.ts` — it maps each persona to a
generic user record. Copy it, replace the record shape + heuristics with the
real schema, run:
```bash
npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl
```

### B. LLM expansion (richer nested data)
When you need long-tail domain rows (a transaction history, past orders, a chat
log) consistent with the persona, add an LLM step. The template supports
`--expand` and reuses `src/llm.ts`:
```bash
MODEL=openai/gpt-4o-mini npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl --expand
```
Cost: 1 LLM call per persona. Keep the cohort small while iterating.

## Step 4: emit the seed script
Turn the mapped records into whatever the project ingests: a Convex mutation
batch, a Prisma `createMany`, SQL inserts, or a fixtures file. Match the
project's existing seeding convention if one exists.

## Guardrails
- License: repo code is MIT, but Persona 1M is NON-COMMERCIAL RESEARCH use only and
  subsets inherit that. Do not commit persona rows to a repo and do not ship them in a
  commercial product. Derive rows from persona fields, generate fresh values, and treat
  the output as a derivative under the same terms unless the user confirms otherwise.
- Never present a persona as a real person; no re-identification.
- Never write real secrets, emails, or payment details. Generate placeholder
  contact/auth fields; personas have no names: generate fictional ones.
- Keep it deterministic where possible (seed any randomness) so reseeding is
  reproducible.
