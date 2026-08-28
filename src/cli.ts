#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { loadPersonas, sampleCohort } from "./personas/load.js";
import { loadScenario } from "./scenario.js";
import { runCohort } from "./runner.js";
import { buildReport, formatReport } from "./report.js";

const USAGE = `synthusers - persona-driven synthetic-user testing

usage:
  synthusers run [scenario.ts|scenario.json] [options]
  synthusers run --system "<what the product is>" --task "<what to attempt>" [options]
  synthusers personas [--personas file.jsonl] [--filter attr=val ...] [--size N]

options:
  --system TEXT        inline survey: product/context (with --task)
  --task TEXT          inline survey: what the persona attempts
  --id TEXT            id for an inline scenario (default "inline")
  --size N             cap cohort size
  --concurrency N      parallel trials (default 4)
  --personas FILE      persona pool jsonl (default bundled sample)
  --filter attr=val    repeatable cohort filter (personas cmd + inline run)
  --segment attr       repeatable report breakdown
  --out FILE           dump every trial (transcript + report) as jsonl`;

function parseFilters(pairs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const eq = p.indexOf("=");
    if (eq === -1) throw new Error(`--filter must be attr=val, got: ${p}`);
    out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return out;
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
    },
  });

  const [cmd, scenarioPath] = positionals;
  const filters = parseFilters(values.filter);
  const size = values.size ? Number(values.size) : undefined;

  if (cmd === "personas") {
    const all = loadPersonas(values.personas);
    const filterFn =
      Object.keys(filters).length === 0
        ? undefined
        : (p: (typeof all)[number]) =>
            Object.entries(filters).every(([k, v]) => {
              const got = k in p.attributes ? p.attributes[k] : (p as Record<string, unknown>)[k];
              return String(got) === v;
            });
    const cohort = sampleCohort(all, { filter: filterFn, size });
    for (const p of cohort) console.log(JSON.stringify(p));
    console.error(`\n${cohort.length} personas`);
    return;
  }

  if (cmd !== "run") {
    console.error(USAGE);
    process.exit(cmd ? 1 : 0);
  }

  const { scenario, cohort: cohortFilter, segmentBy: scenarioSegs } = await loadScenario({
    path: scenarioPath,
    system: values.system,
    task: values.task,
    id: values.id,
  });

  const inlineFilter =
    Object.keys(filters).length === 0
      ? undefined
      : (p: { attributes: Record<string, unknown> }) =>
          Object.entries(filters).every(([k, v]) => {
            const got = k in p.attributes ? p.attributes[k] : (p as Record<string, unknown>)[k];
            return String(got) === v;
          });

  const all = loadPersonas(values.personas);
  const cohort = sampleCohort(all, { filter: cohortFilter ?? inlineFilter, size });
  if (cohort.length === 0) throw new Error("Cohort is empty (check filter / personas file)");

  const segmentBy = values.segment ?? scenarioSegs ?? [];
  console.error(
    `Running "${scenario.id}" (${scenario.env}) on ${cohort.length} personas, model=${process.env.MODEL ?? "openai/gpt-4o-mini"} ...`
  );

  const results = await runCohort(cohort, scenario, Number(values.concurrency));
  console.log(formatReport(buildReport(results, segmentBy)));

  if (values.out) {
    writeFileSync(values.out, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.error(`\nWrote ${results.length} trials to ${values.out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
