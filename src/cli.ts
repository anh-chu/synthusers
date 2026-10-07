#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { buildCohort } from "./personas/load.js";
import { loadScenario } from "./scenario.js";
import { runCohort } from "./runner.js";
import { buildReport, formatReport } from "./report.js";
import { fetchCommand } from "./matraix/fetch.js";
import { loadCodebook } from "./matraix/store.js";
import { fieldIndex, suggest, type FieldSpec } from "./matraix/sample.js";

const USAGE = `synthusers - persona-driven synthetic-user testing

usage:
  synthusers fetch [--shards 0-9|9|all] [--force]   cache MatrAIx Persona 1M (~810 MB for all)
  synthusers fields [fieldId | --category X | --search text]   browse the 1,290 persona fields
  synthusers personas [options]                     print a sampled cohort as jsonl
  synthusers run [scenario.ts|scenario.json] [options]
  synthusers run --system "<what the product is>" --task "<what to attempt>" [options]

cohort options (personas, run):
  --size N             cohort size (default 100 on MatrAIx; all matches on JSONL pools)
  --filter f=v1|v2     repeatable. OR within a field, AND across fields. Run "fields" to find ids
  --source LIST        comma list: synthetic,stackoverflow,gss,amazon,prism,real_human_survey,wiki
                       (default: all except wiki, which profiles notable real people, mostly older)
  --stratify f1,f2     proportional spread across these fields, e.g. region,age_bracket
  --seed N             reproducible sampling
  --min-attrs N        skip personas with fewer populated fields (default 60)
  --include-minors     keep personas under 18 (excluded by default)
  --personas FILE      use a JSONL pool instead of the cached MatrAIx data

run options:
  --system TEXT / --task TEXT / --id TEXT   inline survey
  --concurrency N      parallel trials (default 4)
  --segment field      repeatable report breakdown
  --out FILE           dump every trial (transcript + report) as jsonl`;

function parseFilters(pairs: string[] | undefined): FieldSpec {
  const out: FieldSpec = {};
  for (const p of pairs ?? []) {
    const eq = p.indexOf("=");
    if (eq < 1) throw new Error(`--filter must be field=value[|value...], got: ${p}`);
    const id = p.slice(0, eq);
    const vals = p.slice(eq + 1).split("|");
    out[id] = [...((out[id] as string[] | undefined) ?? []), ...vals];
  }
  return out;
}

function fieldsCommand(arg: string | undefined, o: { category?: string; search?: string }): void {
  const cb = loadCodebook();
  if (arg) {
    const i = fieldIndex(cb, arg);
    const f = cb.fields[i]!;
    console.log(`${f.id}  (${f.label}; ${f.category})\n  values: ${f.values.join(" | ")}`);
    return;
  }
  if (o.category || o.search) {
    const q = (o.search ?? "").toLowerCase();
    const cat = (o.category ?? "").toLowerCase();
    const hits = cb.fields.filter(
      (f) =>
        (!cat || f.category.toLowerCase().includes(cat)) &&
        (!q || f.id.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
    );
    for (const f of hits) console.log(`${f.id}\t[${f.category}]\t${f.values.join(" | ")}`);
    console.error(`\n${hits.length} fields`);
    return;
  }
  const counts = new Map<string, number>();
  for (const f of cb.fields) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  for (const [c, n] of counts) console.log(`${String(n).padStart(4)}  ${c}`);
  console.error(`\n${cb.fields.length} fields. Use: fields --category "<name>" | fields --search <text> | fields <fieldId>`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      system: { type: "string" },
      task: { type: "string" },
      id: { type: "string" },
      size: { type: "string" },
      concurrency: { type: "string", default: "4" },
      personas: { type: "string" },
      out: { type: "string" },
      segment: { type: "string", multiple: true },
      filter: { type: "string", multiple: true },
      source: { type: "string" },
      stratify: { type: "string" },
      seed: { type: "string" },
      "min-attrs": { type: "string" },
      "include-minors": { type: "boolean", default: false },
      shards: { type: "string" },
      force: { type: "boolean", default: false },
      category: { type: "string" },
      search: { type: "string" },
    },
  });

  const [cmd, scenarioPath] = positionals;
  const num = (k: string): number | undefined => {
    const raw = values[k as keyof typeof values] as string | undefined;
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`--${k} must be a number, got: ${raw}`);
    return n;
  };

  if (cmd === "fetch") return fetchCommand({ shards: values.shards, force: values.force });
  if (cmd === "fields") return fieldsCommand(scenarioPath, values);

  const cohortReq = {
    size: num("size"),
    file: values.personas,
    sources: values.source?.split(",").map((s) => s.trim()).filter(Boolean),
    stratify: values.stratify?.split(",").map((s) => s.trim()).filter(Boolean),
    seed: num("seed"),
    minAttrs: num("min-attrs"),
    includeMinors: values["include-minors"],
  };
  const cliSpec = parseFilters(values.filter);

  if (cmd === "personas") {
    const { personas, pool, note } = buildCohort({ ...cohortReq, spec: cliSpec, summaryFields: Object.keys(cliSpec) });
    for (const p of personas) console.log(JSON.stringify(p));
    console.error(`\n${personas.length} personas from ${pool}. ${note}`);
    return;
  }

  if (cmd !== "run") {
    console.error(USAGE);
    process.exit(cmd ? 1 : 0);
  }

  const loaded = await loadScenario({
    path: scenarioPath,
    system: values.system,
    task: values.task,
    id: values.id,
  });
  const { scenario } = loaded;
  const segmentBy = values.segment ?? loaded.segmentBy ?? [];
  const spec: FieldSpec = { ...(loaded.cohortSpec ?? {}), ...cliSpec };
  const summaryFields = [...new Set([...segmentBy, ...Object.keys(spec), ...(loaded.summaryFields ?? [])])];

  const { personas: cohort, pool, note } = buildCohort({
    ...cohortReq,
    spec,
    predicate: loaded.cohort,
    summaryFields,
  });
  if (cohort.length === 0) throw new Error("Cohort is empty (check --filter / --source / --personas)");
  if (pool === "MatrAIx Persona 1M") {
    const cb = loadCodebook();
    for (const s of segmentBy) {
      if (!cb.index.has(s) && s !== "source") {
        const hint = suggest(s, cb.fields.map((f) => f.id));
        throw new Error(`Unknown --segment field "${s}".${hint.length ? ` Did you mean: ${hint.join(", ")}?` : ""}`);
      }
    }
  }

  console.error(
    `Running "${scenario.id}" (${scenario.env}) on ${cohort.length} personas from ${pool}, model=${process.env.MODEL ?? "openai/gpt-4o-mini"}. ${note}`
  );

  const results = await runCohort(cohort, scenario, Number(values.concurrency));
  console.log(formatReport(buildReport(results, segmentBy)));

  if (values.out) {
    writeFileSync(values.out, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.error(`\nWrote ${results.length} trials to ${values.out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
