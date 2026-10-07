# synthusers

Persona-driven synthetic-user testing harness. Sample realistic personas, let an
LLM play each one, run them through a scenario you define, and get an aggregated
report of where different user types succeed, stall, or bail.

Project-agnostic: point a scenario at any product (a described flow, or a live
chat endpoint). Built on the [MatrAIx](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B) Persona 1M
dataset, trimmed to the cheap, useful core: personas + LLM runner + report. No Docker,
no browser/device automation (yet).

> Signal, not truth. These are simulated users. Treat results as hypothesis
> generation and lead-finding, not a replacement for real-user evidence.

## Install

```bash
cd ~/synthusers
npm install
cp .env.example .env   # set MODEL + one API key
```

## Run

```bash
# Survey: personas read a described flow and self-report.
npm run run -- run scenarios/example-onboarding.ts --segment tech_savviness --out out/trials.jsonl

# Chat: personas talk to your bot (respond()) then self-report.
npm run run -- run scenarios/example-chat.ts --size 8
```

Flags: `--size N` (default 100 on the MatrAIx pool; every match on a JSONL pool), `--concurrency N` (default 4), `--filter`,
`--stratify`, `--source`, `--seed`, `--personas file.jsonl` (custom pool),
`--segment field` (repeatable breakdown), `--out trials.jsonl` (dump every
transcript + report). Run with no command for full usage.

## Define a scenario

A scenario is a small TS module. Two flavors:

- **survey** (`env: "survey"`): set `system` (what the product is) and `task`
  (what to attempt). One LLM call per persona.
- **chat** (`env: "chat"`): also provide `respond(messages, persona)` — this is
  your assistant under test. Swap the example's stub for a `fetch()` to your real
  endpoint to stress-test the actual bot.

Optional named exports: `cohort` (filter predicate), `segmentBy` (field ids to
break the report down on) and `summaryFields` (field ids listed first in each
persona's prompt). JSON scenarios use a `cohort` map such as
`{"tech_savviness": ["Reluctant", "Avoidant"]}`, applied while sampling. See `scenarios/example-onboarding.ts`.

## Personas

The persona pool is [MatrAIx Persona 1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M):
999,847 personas, each described by up to 1,290 categorical attributes (demographics,
Big Five and character traits, values, risk and decision style, habits, expertise,
language, developer-survey fields, and more). 600k are derived from real records
(Stack Overflow survey, GSS, Amazon reviews, PRISM, a human survey, Wikipedia) and
400k are synthetic.

```bash
npm run run -- fetch --shards all     # one-time, ~880 MB cache (try: --shards 9, ~80 MB, synthetic only)
npm run run -- fields                 # browse the 1,290 fields
npm run run -- fields --search patience
npm run run -- fields tech_savviness  # values for one field
npm run run -- personas --size 200 --stratify region,age_bracket --seed 1
npm run run -- personas --filter "region=South Asia|East Asia" --filter tech_savviness=Reluctant --size 50
```

Shards 0-2 hold only `wiki` personas, which are skipped by default. If you never use
`--source wiki`, `fetch --shards 3-9` saves about 350 MB. A seed reproduces a cohort only
for the same set of cached shards.

`fetch` range-reads only the compact attribute columns of the Parquet shards and
skips the multi-GB description/evidence columns. The cache lives in
`~/.cache/synthusers/matraix` (override with `SYNTHUSERS_CACHE`; `HF_ENDPOINT` and
`HF_TOKEN` are honored). Each persona is stored as a 810-byte record, so a scan of
all 1M personas takes seconds and sampling is seeded and reproducible.

Without the cache, the tool falls back to `src/personas/sample.jsonl`: 8 hand-written
personas that use the same field ids, so scenarios behave the same. It is for offline
smoke tests only.

**Sampling rules**

- Filters take MatrAIx field ids. `a|b` means either value; separate `--filter` flags
  are ANDed. A persona that lacks the field never matches. Unknown fields or values fail
  with a "did you mean" hint.
- Personas with fewer than 60 populated fields are skipped (`--min-attrs`): an Amazon
  or GSS row carries only 12 to 16 fields, too little to role-play.
- Under-18 personas are excluded (`--include-minors`). A persona with no age is kept.
- Some personas carry exact values outside the codebook (age `65+`, region
  `Southern Europe`). Filters accept them, and `--stratify` treats them as their own group.
- `wiki` personas (model-extracted profiles of notable real people) are excluded unless
  you pass `--source wiki`. `--source` takes a comma list of dataset sources.
- `--stratify f1,f2` spreads the sample in proportion across those fields. Without it,
  sampling is uniform over matching rows.
- Rows are sparse. Nothing is imputed: a missing field is absent from the persona.
- Personas have no names, and no source record id reaches the prompt. The dataset
  forbids impersonating or re-identifying real people.

**License.** The MatrAIx dataset is **non-commercial research use only**, and subsets
inherit that. This repo ships no dataset rows; `fetch` downloads them to your cache.
Do not commit or redistribute the cache. Cite the
[MatrAIx paper](https://arxiv.org/abs/2608.04205).

## Layout

```
src/
  types.ts          Persona, Scenario, SurveyReport, TrialResult
  llm.ts            provider-agnostic model factory (MODEL="provider/id")
  matraix/          Persona 1M: fetch (cache), codec, store, sample, toPersona
  personas/load.ts  buildCohort(): MatrAIx pool or JSONL fallback
  personas/sample.jsonl  8-persona offline fallback
  runner.ts         run one persona (survey/chat), run a cohort concurrently
  report.ts         aggregate: success rate, avg rating, top frictions, segments
  cli.ts            `synthusers run <scenario.ts>`
scenarios/          project-defined tests (example-onboarding[.ts|.json], example-chat)
scripts/            mock-data-example template
skills/             agent-facing skills (synthetic-user-testing, synthetic-mock-data)
```

## Two uses

- **Testing** (`skills/synthetic-user-testing`): personas *act* through a
  scenario, you get a UX/product-signal report.
- **Mock data** (`skills/synthetic-mock-data`): personas *become rows*. Sample a
  cohort, map or LLM-expand into your schema for realistic, diverse seed data.
  ```bash
  npx tsx src/cli.ts personas --size 200 --seed 1 > cohort.jsonl
  npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl        # direct map
  npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl --expand  # + LLM
  ```

## Cost

Each persona = LLM calls (1 for survey, up to ~2*turns for chat). A 1000-persona
survey ≈ 1000 calls. Use a cheap model and `--size` while iterating.
