import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PersonaSchema, type Persona, type CohortFilter } from "../types.js";
import { matraixAvailable } from "../matraix/store.js";
import { sampleMatraix, type SampleOpts } from "../matraix/sample.js";
import { compileCohort, compileExclude, type CohortSpec } from "../scenario.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Load personas from a JSONL file (one JSON persona per line). */
export function loadPersonas(file?: string): Persona[] {
  const path = file ?? process.env.PERSONAS_FILE ?? resolve(here, "sample.jsonl");
  if (!existsSync(path)) throw new Error(`Persona file not found: ${path}`);

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  return lines.map((line, i) => {
    try {
      return PersonaSchema.parse(JSON.parse(line));
    } catch (e) {
      throw new Error(`Bad persona on line ${i + 1} of ${path}: ${(e as Error).message}`);
    }
  });
}

/** Build a cohort from a small in-memory pool: filter then take up to `size`. */
export function sampleCohort(
  personas: Persona[],
  opts: { filter?: CohortFilter; size?: number } = {}
): Persona[] {
  const filtered = opts.filter ? personas.filter(opts.filter) : personas;
  return opts.size ? filtered.slice(0, opts.size) : filtered;
}

export type CohortRequest = Omit<SampleOpts, "size" | "filter"> & {
  size?: number;
  /** Persona JSONL path. Forces the JSONL pool. */
  file?: string;
  /** Data filter (field -> value | values). Validated against the codebook on the MatrAIx pool. */
  spec?: CohortSpec;
  /** Predicate from a TS scenario. */
  predicate?: CohortFilter;
};
export type Cohort = { personas: Persona[]; pool: string; note: string };

/**
 * One entry point for the CLI. Uses the cached MatrAIx Persona 1M pool when it
 * exists (and no JSONL file is requested); otherwise the JSONL pool, which is
 * the 8-persona sample unless --personas / PERSONAS_FILE says otherwise.
 */
export function buildCohort(req: CohortRequest): Cohort {
  const useJsonl = req.file || process.env.PERSONAS_FILE || !matraixAvailable();
  if (useJsonl) {
    const filters = [
      req.spec ? compileCohort(req.spec) : undefined,
      req.exclude ? compileExclude(req.exclude) : undefined,
      req.predicate,
    ].filter(Boolean) as CohortFilter[];
    const personas = sampleCohort(loadPersonas(req.file), {
      filter: filters.length ? (p) => filters.every((f) => f(p)) : undefined,
      size: req.size,
    });
    const ignored = (["stratify", "sources", "seed", "minAttrs", "balance", "minPerStratum"] as const).filter((k) => req[k] !== undefined && !(Array.isArray(req[k]) && !(req[k] as unknown[]).length));
    if (ignored.length || req.includeMinors) console.error(`warning: ${[...ignored, ...(req.includeMinors ? ["includeMinors"] : [])].join(", ")} only apply to the MatrAIx pool; ignored for JSONL pools.`);
    const bundled = !req.file && !process.env.PERSONAS_FILE;
    return {
      personas,
      pool: bundled ? "bundled sample (8 personas)" : `jsonl (${req.file ?? process.env.PERSONAS_FILE})`,
      note: bundled ? "Only 8 sample personas. For the full MatrAIx Persona 1M pool run: synthusers fetch" : "",
    };
  }
  const size = req.size ?? 100;
  const r = sampleMatraix({ ...req, size, filter: req.spec, predicate: req.predicate });
  return {
    personas: r.personas,
    pool: "MatrAIx Persona 1M",
    note: `scanned ${r.scanned.toLocaleString()} cached personas, ${r.matched.toLocaleString()} matched, seed=${r.seed}`,
  };
}
