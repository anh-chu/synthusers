/**
 * A reusable cohort definition: one JSON file that both `personas` and `run` accept,
 * so a curated set of personas can be reviewed, diffed and reused.
 *
 *   {
 *     "filter":  { "cog_patience": ["Low", "None"] },
 *     "exclude": { "demo_employment_status": ["Retired"] },
 *     "source": ["synthetic", "stackoverflow"],
 *     "stratify": ["region", "age_bracket"],
 *     "min-per-stratum": 8,
 *     "size": 40,
 *     "seed": 1
 *   }
 *
 * Command-line flags override the file, and the file overrides a scenario's own
 * `cohort` map, so the explicit always wins.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const Value = z.union([z.string(), z.number(), z.boolean()]);
/** One field -> allowed value(s). */
export const CohortMapSchema = z.record(z.union([Value, z.array(Value)]));
export type CohortMap = z.infer<typeof CohortMapSchema>;

export const CohortFileSchema = z
  .object({
    filter: CohortMapSchema.optional(),
    exclude: CohortMapSchema.optional(),
    source: z.array(z.string()).optional(),
    stratify: z.array(z.string()).optional(),
    balance: z.boolean().optional(),
    "min-per-stratum": z.number().int().nonnegative().optional(),
    "min-attrs": z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    seed: z.number().int().nonnegative().optional(),
    "include-minors": z.boolean().optional(),
  })
  .strict();
export type CohortFile = z.infer<typeof CohortFileSchema>;

export function loadCohortFile(path: string): CohortFile {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Cohort file not found: ${abs}`);
  try {
    return CohortFileSchema.parse(JSON.parse(readFileSync(abs, "utf8")));
  } catch (e) {
    const detail =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
        : (e as Error).message;
    throw new Error(`Bad cohort file ${abs}: ${detail}`);
  }
}
