/**
 * Convert the MatrAIx Persona 1M public release into our compact JSONL shape.
 *
 * The dataset lives on Hugging Face as parquet:
 *   MatrAIx2026/MatrAIx_Persona_1M_Public_Release
 *
 * Simplest path (no HF client needed): download the parquet files once with the
 * huggingface-cli or a plain HTTPS fetch, then run this over them. Because the
 * exact column names in the release may evolve, this script is intentionally a
 * thin, adjustable mapper: point it at a source JSONL/NDJSON export and it maps
 * fields to our Persona schema. Adjust `mapRecord` to the real columns.
 *
 * Usage:
 *   tsx scripts/download-personas.ts <source.jsonl> <out.jsonl> [limit]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PersonaSchema, type Persona } from "../src/types.js";

function mapRecord(raw: Record<string, unknown>, i: number): Persona {
  const s = (k: string, d = "") => (raw[k] == null ? d : String(raw[k]));
  // TODO: align these keys with the actual Persona 1M columns once inspected.
  const persona = {
    id: s("id", `persona-${i}`),
    name: s("name", `Persona ${i}`),
    ageRange: s("age_range", s("age", "unknown")),
    region: s("region", s("country", "unknown")),
    occupation: s("occupation", s("job", "unknown")),
    summary: s("summary", s("description", "")),
    attributes: (typeof raw.attributes === "object" && raw.attributes
      ? (raw.attributes as Record<string, string | number | boolean>)
      : {}) as Persona["attributes"],
  };
  return PersonaSchema.parse(persona);
}

function main() {
  const [src, out, limitArg] = process.argv.slice(2);
  if (!src || !out) {
    console.error("usage: tsx scripts/download-personas.ts <source.jsonl> <out.jsonl> [limit]");
    process.exit(1);
  }
  const limit = limitArg ? Number(limitArg) : Infinity;
  const lines = readFileSync(src, "utf8").split("\n").filter((l) => l.trim());
  const personas: Persona[] = [];
  for (let i = 0; i < lines.length && personas.length < limit; i++) {
    try {
      personas.push(mapRecord(JSON.parse(lines[i]!), i));
    } catch (e) {
      console.error(`skip line ${i + 1}: ${(e as Error).message}`);
    }
  }
  writeFileSync(out, personas.map((p) => JSON.stringify(p)).join("\n") + "\n");
  console.error(`Wrote ${personas.length} personas to ${out}`);
}

main();
