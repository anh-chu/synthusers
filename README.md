# synthusers

Persona-driven synthetic-user testing harness. Sample realistic personas, let an
LLM play each one, run them through a scenario you define, and get an aggregated
report of where different user types succeed, stall, or bail.

Project-agnostic: point a scenario at any product (a described flow, or a live
chat endpoint). Inspired by [MatrAIx](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B),
but trimmed to the cheap, useful core: personas + LLM runner + report. No Docker,
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
npm run run -- run scenarios/example-onboarding.ts --segment patience --out out/trials.jsonl

# Chat: personas talk to your bot (respond()) then self-report.
npm run run -- run scenarios/example-chat.ts --size 8
```

Flags: `--size N` (cap cohort), `--concurrency N` (default 4),
`--personas file.jsonl` (custom pool), `--segment attr` (repeatable breakdown),
`--out trials.jsonl` (dump every transcript + report).

## Define a scenario

A scenario is a small TS module. Two flavors:

- **survey** (`env: "survey"`): set `system` (what the product is) and `task`
  (what to attempt). One LLM call per persona.
- **chat** (`env: "chat"`): also provide `respond(messages, persona)` — this is
  your assistant under test. Swap the example's stub for a `fetch()` to your real
  endpoint to stress-test the actual bot.

Optional named exports: `cohort` (filter predicate) and `segmentBy` (attributes
to break the report down on). See `scenarios/example-onboarding.ts`.

## Personas

A `Persona` is compact and prompt-ready: `id, name, ageRange, region,
occupation, summary` plus free-form `attributes` used for cohort filtering and
report segmentation. The bundled `src/personas/sample.jsonl` has 8 archetypes to
start.

For real scale, import the MatrAIx Persona 1M coreset and map it in:

```bash
huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
  --repo-type dataset --local-dir persona/release
# convert an exported jsonl to our shape (adjust mapRecord to real columns):
npm run download-personas -- persona/release/some-export.jsonl personas.jsonl 5000
PERSONAS_FILE=./personas.jsonl npm run run -- run scenarios/example-onboarding.ts
```

## Layout

```
src/
  types.ts          Persona, Scenario, SurveyReport, TrialResult
  llm.ts            provider-agnostic model factory (MODEL="provider/id")
  personas/load.ts  load + filter/sample the pool
  personas/sample.jsonl
  runner.ts         run one persona (survey/chat), run a cohort concurrently
  report.ts         aggregate: success rate, avg rating, top frictions, segments
  cli.ts            `synthusers run <scenario.ts>`
scenarios/          project-defined tests (example-onboarding[.ts|.json], example-chat)
scripts/            Persona 1M converter + mock-data-example template
skills/             agent-facing skills (synthetic-user-testing, synthetic-mock-data)
```

## Two uses

- **Testing** (`skills/synthetic-user-testing`): personas *act* through a
  scenario, you get a UX/product-signal report.
- **Mock data** (`skills/synthetic-mock-data`): personas *become rows*. Sample a
  cohort, map or LLM-expand into your schema for realistic, diverse seed data.
  ```bash
  npx tsx src/cli.ts personas --size 200 > cohort.jsonl
  npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl        # direct map
  npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl --expand  # + LLM
  ```

## Cost

Each persona = LLM calls (1 for survey, up to ~2*turns for chat). A 1000-persona
survey ≈ 1000 calls. Use a cheap model and `--size` while iterating.
