import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { z } from "zod";
import type { CohortFilter, Persona, Scenario } from "./types.js";

/**
 * A cohort spec is plain data an agent can emit: attribute -> allowed value(s).
 * A persona matches if, for every key, its value (checked in `attributes` then
 * top-level fields) equals the value or is contained in the array.
 */
export const CohortSpecSchema = z.record(
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ])
);
export type CohortSpec = z.infer<typeof CohortSpecSchema>;

const personaValue = (p: Persona, key: string): unknown =>
  key in p.attributes ? p.attributes[key] : (p as unknown as Record<string, unknown>)[key];

export function compileCohort(spec: CohortSpec): CohortFilter {
  const entries = Object.entries(spec);
  return (p) =>
    entries.every(([k, want]) => {
      const got = personaValue(p, k);
      return Array.isArray(want) ? want.some((w) => String(w) === String(got)) : String(want) === String(got);
    });
}

/** JSON survey scenario: no code, safe for an agent to author. */
export const JsonScenarioSchema = z.object({
  id: z.string(),
  env: z.literal("survey").default("survey"),
  system: z.string(),
  task: z.string(),
  cohort: CohortSpecSchema.optional(),
  segmentBy: z.array(z.string()).optional(),
});

export type LoadedScenario = {
  scenario: Scenario;
  cohort?: CohortFilter;
  segmentBy?: string[];
};

/**
 * Resolve a scenario from (in priority): a .ts module, a .json file, or inline
 * flags (--system/--task). TS modules support code hooks like chat respond();
 * JSON/flags cover the survey case an agent can produce directly.
 */
export async function loadScenario(opts: {
  path?: string;
  system?: string;
  task?: string;
  id?: string;
}): Promise<LoadedScenario> {
  if (opts.path) {
    const abs = resolve(opts.path);
    if (!existsSync(abs)) throw new Error(`Scenario not found: ${abs}`);
    if (extname(abs) === ".ts" || extname(abs) === ".js") {
      const mod = (await import(pathToFileURL(abs).href)) as {
        default: Scenario;
        cohort?: CohortFilter;
        segmentBy?: string[];
      };
      if (!mod.default?.id) throw new Error(`${opts.path} must default-export a Scenario`);
      return { scenario: mod.default, cohort: mod.cohort, segmentBy: mod.segmentBy };
    }
    const raw = JsonScenarioSchema.parse(JSON.parse(readFileSync(abs, "utf8")));
    return {
      scenario: { id: raw.id, env: raw.env, system: raw.system, task: raw.task },
      cohort: raw.cohort ? compileCohort(raw.cohort) : undefined,
      segmentBy: raw.segmentBy,
    };
  }

  if (opts.system && opts.task) {
    return {
      scenario: {
        id: opts.id ?? "inline",
        env: "survey",
        system: opts.system,
        task: opts.task,
      },
    };
  }

  throw new Error("Provide a scenario file, or both --system and --task");
}
