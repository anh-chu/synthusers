/**
 * TEMPLATE: turn personas into realistic mock/seed rows.
 *
 * Copy this, then replace `AppUser` + `mapPersona` with your real schema and
 * rules. Two modes:
 *   - direct map (default): deterministic, no LLM, cheap.
 *   - --expand: adds an LLM step to generate nested domain data per persona.
 *
 * Usage:
 *   npx tsx scripts/mock-data-example.ts <cohort.jsonl> <out.jsonl> [--expand]
 *   # cohort.jsonl comes from: npx tsx src/cli.ts personas --size N > cohort.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { generateObject } from "ai";
import { getModel } from "../src/llm.js";
import { PersonaSchema, type Persona } from "../src/types.js";

// --- Replace this with YOUR app's row shape ------------------------------
type AppUser = {
  id: string;
  displayName: string;
  ageRange: string;
  region: string;
  locale: string;
  segment: string;
  monthlyIncomeEstimate: number;
  savingsGoal: number;
  riskTolerance: "low" | "medium" | "high";
  // added only in --expand mode:
  recentTransactions?: { merchant: string; amountUSD: number; category: string }[];
};

// --- Deterministic mapping: persona fields -> row ------------------------
const localeByRegion: Record<string, string> = {
  "North America": "en-US",
  Europe: "en-GB",
  "Latin America": "es-419",
  "South Asia": "en-IN",
  "Middle East": "ar",
  Africa: "en",
};

function mapPersona(p: Persona): AppUser {
  const budget = String(p.attributes.budget ?? "medium");
  const income = budget === "tight" ? 2200 : budget === "medium" ? 4800 : 9000;
  const risk =
    p.attributes.patience === "high" ? "low" : p.attributes.techSavvy === "high" ? "high" : "medium";
  return {
    id: p.id,
    displayName: p.name,
    ageRange: p.ageRange,
    region: p.region,
    locale: localeByRegion[p.region] ?? "en",
    segment: `${p.attributes.techSavvy ?? "?"}-tech/${budget}-budget`,
    monthlyIncomeEstimate: income,
    savingsGoal: Math.round(income * (budget === "tight" ? 3 : 6)),
    riskTolerance: risk as AppUser["riskTolerance"],
  };
}

// --- Optional LLM expansion: nested domain rows consistent w/ the persona -
const TxnSchema = z.object({
  recentTransactions: z
    .array(
      z.object({
        merchant: z.string(),
        amountUSD: z.number(),
        category: z.string(),
      })
    )
    .max(5),
});

async function expand(user: AppUser, persona: Persona): Promise<AppUser> {
  const { object } = await generateObject({
    model: getModel(),
    schema: TxnSchema,
    prompt: `Generate 3-5 realistic recent bank transactions for this person, consistent with who they are. Return amounts in USD.\n\nPerson: ${persona.name}, ${persona.ageRange}, ${persona.region}, ${persona.occupation}.\n${persona.summary}\nMonthly income ~$${user.monthlyIncomeEstimate}, budget ${persona.attributes.budget}.`,
  });
  return { ...user, recentTransactions: object.recentTransactions };
}

async function main() {
  const [src, out, ...rest] = process.argv.slice(2);
  if (!src || !out) {
    console.error("usage: tsx scripts/mock-data-example.ts <cohort.jsonl> <out.jsonl> [--expand]");
    process.exit(1);
  }
  const doExpand = rest.includes("--expand");
  const personas = readFileSync(src, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => PersonaSchema.parse(JSON.parse(l)));

  const rows: AppUser[] = [];
  for (const p of personas) {
    const row = mapPersona(p);
    rows.push(doExpand ? await expand(row, p) : row);
  }

  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.error(`Wrote ${rows.length} rows to ${out}${doExpand ? " (LLM-expanded)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
