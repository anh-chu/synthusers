import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PersonaSchema, type Persona, type CohortFilter } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load personas from a JSONL file (one JSON persona per line). Defaults to the
 * bundled sample; point at the converted Persona 1M export for real cohorts via
 * PERSONAS_FILE or the `file` arg.
 */
export function loadPersonas(file?: string): Persona[] {
  const path =
    file ??
    process.env.PERSONAS_FILE ??
    resolve(here, "sample.jsonl");
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

/** Build a cohort: filter then take up to `size` (deterministic order). */
export function sampleCohort(
  personas: Persona[],
  opts: { filter?: CohortFilter; size?: number } = {}
): Persona[] {
  const filtered = opts.filter ? personas.filter(opts.filter) : personas;
  return opts.size ? filtered.slice(0, opts.size) : filtered;
}
