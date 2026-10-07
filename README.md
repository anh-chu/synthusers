# synthusers

Test a product on about a million realistic synthetic users. Each user is a persona from
[MatrAIx Persona 1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M)
(999,847 personas, each with up to 1,290 attributes). An LLM plays each persona through a
scenario you define, and you get a report of where different user types succeed, stall, or
bail. The same personas can also become rows of realistic mock data.

Project-agnostic: point a scenario at any product (a described flow, or a live chat
endpoint). No Docker, no browser or device automation.

> Signal, not truth. These are simulated users. Treat results as hypothesis
> generation and lead-finding, not a replacement for real-user evidence.

## Quickstart

```bash
npm install
npm run run -- fetch --shards 9            # one-time, ~80 MB: the synthetic personas
npm run run -- personas --size 20 --stratify region --seed 1
```

For the full pool run `fetch --shards all` (~880 MB). The data is cached in
`~/.cache/synthusers/matraix` and never goes into git.

Then run a study one of two ways.

### A. Through an agent harness (no API key)

An agent (Claude Code, pi, dsh, ...) plays the personas with its own subagents:

```bash
npm run run -- prompts scenarios/example-onboarding.json --size 30 --seed 1 > out/prompts.jsonl
# The agent starts one subagent per line, with `prompt` as its task. Each replies with
# {"answer", "rating", "reasoning", "frictions", "succeeded"}. The agent writes lines of
# {"id": ..., "report": {...}} to out/results.jsonl.
npm run run -- report out/results.jsonl --prompts out/prompts.jsonl --segment tech_savviness
```

`prompts` prints the same persona prompt that `run` would send. `report` aggregates the
replies and flags malformed ones. This path covers survey scenarios. See
[`skills/synthetic-user-testing`](skills/synthetic-user-testing/SKILL.md) for the agent
instructions.

### B. Standalone (needs a model key)

```bash
cp .env.example .env     # set MODEL="provider/id" and OPENAI_API_KEY or ANTHROPIC_API_KEY
npm run run -- run scenarios/example-onboarding.json --size 20 --out out/trials.jsonl
```

`run` makes one LLM call per persona (more for chat scenarios) and prints the report.
It also runs chat scenarios, where personas talk to your bot:
`npm run run -- run scenarios/example-chat.ts --size 8`.

## Choosing personas

```bash
npm run run -- fields                       # list the field categories
npm run run -- fields --search patience     # find a field
npm run run -- fields tech_savviness        # see its values
npm run run -- personas --filter "region=South Asia|East Asia" --filter tech_savviness=Reluctant --size 50
npm run run -- personas --size 200 --stratify region,age_bracket --seed 1
npm run run -- personas --exclude "demo_employment_status=Retired|Homemaker" --size 50
# Coverage instead of mirroring: every region gets the same share.
npm run run -- personas --size 200 --stratify region --balance --seed 1
```

| Flag | Meaning |
|---|---|
| `--filter field=a\|b` | Repeatable. Either value within a field; separate flags are ANDed. |
| `--exclude field=a\|b` | Repeatable. Drop personas that carry one of these values. |
| `--stratify f1,f2` | Spread the sample across these fields (proportional by default). |
| `--balance` | With `--stratify`: equal share per stratum, so small segments are covered. |
| `--min-per-stratum N` | With `--stratify`: reserve N per stratum, the rest proportional. |
| `--cohort FILE.json` | Read the curation from a reusable file (see below). Flags override it. |
| `--source list` | Comma list: `synthetic,stackoverflow,gss,amazon,prism,real_human_survey,wiki`. |
| `--seed N` | Reproducible sampling (for the same cached shards). |
| `--size N` | Cohort size. Default 100 on the MatrAIx pool. |
| `--min-attrs N` | Skip sparse personas. Default 60. |
| `--include-minors` | Keep personas under 18. |
| `--personas file.jsonl` | Use your own JSONL pool instead. |

Run `npm run run` with no command for the full usage text.

**Sampling rules**

- Unknown fields or values fail with a "did you mean" hint. A persona that lacks a filtered field never matches.
- Rows are sparse and nothing is imputed: a missing field is absent from the persona.
- Under-18 personas, and personas with fewer than 60 populated fields, are skipped by default. A persona with no age is kept.
- `wiki` personas (model-extracted profiles of notable real people) are skipped unless you pass `--source wiki`. They fill shards 0 to 2, so `fetch --shards 3-9` saves about 350 MB.
- Some personas carry exact values outside the codebook (age `65+`, region `Southern Europe`). Filters accept them and `--stratify` treats them as their own group.
- Personas have no names, and no source record id reaches the prompt. The dataset forbids impersonating or re-identifying real people.
- `--exclude f=v` drops a persona only when it carries the field and that value. A persona whose field is missing is kept, because nothing says it has that value. `--filter f=v` is the opposite: the persona must carry the field to match.
- `--stratify f1,f2` breaks the cohort into strata (all combinations of the field values). Proportional allocation mirrors the pool, so a small segment can end up with no personas once the cohort is small. `--balance` gives every stratum the same share and passes the remainder from strata that cannot fill it. `--min-per-stratum N` reserves a floor and keeps the rest proportional.

### Reusable cohort file

Put a curation in one JSON file and use it from both `personas` and `run`:

```json
{
  "filter": { "cog_patience": ["Low", "None"] },
  "exclude": { "demo_employment_status": ["Retired", "Unemployed"] },
  "source": ["synthetic", "stackoverflow"],
  "stratify": ["region"],
  "balance": true,
  "size": 40,
  "seed": 1,
  "min-attrs": 100
}
```

```bash
npm run run -- personas --cohort cohorts/low-patience.json > out/cohort.jsonl
npm run run -- prompts scenarios/example-onboarding.json --cohort cohorts/low-patience.json
```

Every key is optional and takes the same name as its flag. Command-line flags override the
file, and the file overrides a scenario's own `cohort` map, so the most explicit level wins.
An unknown key or bad value is rejected with a message naming the problem.

Without a cache, the tool falls back to `src/personas/sample.jsonl`: 8 hand-written
personas that use the same field ids. It is for offline smoke tests only.

**How `fetch` works.** It range-reads only the compact attribute columns of the Parquet
shards and skips the multi-GB description and evidence columns. Each persona is stored as
an 810-byte record, so scanning all 1M personas takes seconds. Override the cache path with
`SYNTHUSERS_CACHE`. `HF_ENDPOINT` and `HF_TOKEN` are honored.

**License.** The MatrAIx dataset is **non-commercial research use only**, and subsets
inherit that. This repo ships no dataset rows. Do not commit or redistribute the cache.
Cite the [MatrAIx paper](https://arxiv.org/abs/2608.04205).

## Define a scenario

A scenario is JSON (survey only, safe for an agent to write) or a TS module.

- **survey**: set `system` (what the product is) and `task` (what to attempt). One LLM call per persona.
- **chat** (TS only): also provide `respond(messages, persona)`, your assistant under test.
  Swap the example's stub for a `fetch()` to your real endpoint.

```json
{
  "id": "checkout-v2",
  "env": "survey",
  "system": "You are buying a laptop on <site>.",
  "task": "Reach the payment screen. Decide at each step to continue or bail. 'answer' = 'reached payment' or 'abandoned at <step>'.",
  "cohort": { "tech_savviness": ["Reluctant", "Avoidant"] },
  "segmentBy": ["tech_savviness", "age_bracket"]
}
```

TS scenarios can also export `cohort` (a predicate), `segmentBy` and `summaryFields`
(field ids listed first in each persona's prompt). See `scenarios/example-onboarding.ts`.
Write the task from the real product flow, not from memory: a survey only tests your description.

## Mock data

Personas can also *become rows*. Sample a cohort, then map or LLM-expand it into your schema.
See [`skills/synthetic-mock-data`](skills/synthetic-mock-data/SKILL.md).

```bash
npm run run -- personas --size 200 --seed 1 > cohort.jsonl
npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl            # direct map, no LLM
npx tsx scripts/mock-data-example.ts cohort.jsonl seed.jsonl --expand   # + LLM (needs a key)
```

## Layout

```
src/
  cli.ts            commands: fetch, fields, personas, prompts, report, run
  matraix/          Persona 1M: fetch (cache), codec, store, sample, toPersona
  personas/         buildCohort() and the 8-persona offline fallback
  runner.ts         play one persona (survey/chat); run a cohort concurrently
  report.ts         success rate, avg rating, top frictions, per-segment splits
  llm.ts            model factory (MODEL="provider/id")
  types.ts          Persona, Scenario, SurveyReport, TrialResult
scenarios/          example scenarios
scripts/            mock-data-example template
skills/             agent-facing skills (synthetic-user-testing, synthetic-mock-data)
```

`npx tsx src/matraix/codec.check.ts` (or `npm run check`) runs the codec self-check.

## Cost

Each persona costs one LLM call for a survey and up to about 2 × turns for chat. A
1,000-persona survey is about 1,000 calls. Use a cheap model and a small `--size` while
iterating (10 to 30), and go larger only for a final read.
