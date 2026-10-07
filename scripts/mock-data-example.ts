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
 *   # cohort.jsonl comes from: npx tsx src/cli.ts personas --size N --seed 1 > cohort.jsonl
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
// Persona attributes use MatrAIx Persona 1M field ids (list: synthusers fields).
// Missing fields are normal (rows are sparse), so always provide a fallback.
const localeByRegion: Record<string, string> = {
  "North America": "en-US",
  "Western Europe": "en-GB",
  "Eastern Europe": "en",
  "Latin America": "es-419",
  "South Asia": "en-IN",
  "East Asia": "en",
  "Southeast Asia": "en",
  MENA: "ar",
  "Sub-Saharan Africa": "en",
  Oceania: "en-AU",
};
const incomeByBand: Record<string, number> = {
  "Low income": 1500,
  "Lower-middle": 2800,
  Middle: 4800,
  "Upper-middle": 7500,
  "High income": 12000,
};
const riskByValue: Record<string, AppUser["riskTolerance"]> = {
  "Risk-averse": "low",
  Cautious: "low",
  Balanced: "medium",
  "Risk-tolerant": "high",
  "Risk-seeking": "high",
};

function mapPersona(p: Persona): AppUser {
  const band = String(p.attributes.socioeconomic_band ?? "Middle");
  const income = incomeByBand[band] ?? 4800;
  return {
    id: p.id,
    displayName: p.name || `User ${p.id}`,
    ageRange: p.ageRange,
    region: p.region,
    locale: localeByRegion[p.region] ?? "en",
    segment: `${p.attributes.tech_savviness ?? "?"} / ${band}`,
    monthlyIncomeEstimate: income,
    savingsGoal: Math.round(income * (income < 3000 ? 3 : 6)),
    riskTolerance: riskByValue[String(p.attributes.risk_tolerance)] ?? "medium",
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
    prompt: `Generate 3-5 realistic recent bank transactions for this person, consistent with who they are. Return amounts in USD.\n\nPerson: ${persona.ageRange}, ${persona.region}, ${persona.occupation}.\n${persona.summary}\nMonthly income ~$${user.monthlyIncomeEstimate}, income band ${persona.attributes.socioeconomic_band ?? "unknown"}.`,
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
