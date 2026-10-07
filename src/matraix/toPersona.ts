import type { Persona } from "../types.js";
import { decodeRecord, type Codebook, type RowOverrides } from "./codec.js";

/** Categories in the order they are written into a persona's prompt summary. */
const CATEGORY_ORDER = [
  "Demographic: Core",
  "Demographic: Life Events",
  "Demographic: Family",
  "Demographic: Cultural",
  "Personality: Big Five",
  "Personality: Character",
  "Personality: MBTI",
  "Personality: Relationships",
  "Values & Motivation",
  "Risk & Decision",
  "Worldview: Beliefs",
  "State: Emotional",
  "Behavior: Preferences",
  "Behavior: Habits",
  "Behavior: Time",
  "Behavior: Work",
  "Linguistic: Communication",
  "Linguistic: Language",
  "Professional: Career",
  "Professional: Industry",
  "Learning: Academic",
  "Learning: Style",
  "Health: Physical",
  "Health: Lifestyle",
  "Health: Fitness",
  "Expertise: Domains",
  "Expertise: Skills",
  "Skills: Tools",
  "Skills: Programming",
];
const PER_CATEGORY = 6;
const MAX_LINES = 40;
/** Values that say nothing about the person; skipped unless a scenario pins the field. */
const FILLER = new Set(["None", "Absent", "Neutral", "Irrelevant", "Indifferent", "Not applicable", "Prefer not to say"]);
/** Shown in the header line instead of the bullet list. */
const HEADER_FIELDS = new Set(["age_bracket", "region"]);

export type PersonaOpts = {
  /** Field ids always put first in the summary (scenario-relevant fields, filters, segments). */
  summaryFields?: string[];
  /** Skip the summary text (used for cheap predicate checks). */
  light?: boolean;
};

function occupation(a: Record<string, string>): string {
  const role = [a.seniority, a.role_function].filter(Boolean).join(" ");
  const parts = [role, a.domain ?? a.subject_specialty].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return a.demo_employment_status ?? "unknown";
}

function summarize(cb: Codebook, a: Record<string, string>, first: string[]): string {
  const lines: string[] = [];
  const used = new Set<string>(HEADER_FIELDS);
  const add = (id: string, pinned = false): void => {
    const i = cb.index.get(id);
    const v = a[id];
    if (i === undefined || v === undefined || used.has(id)) return;
    if (!pinned && FILLER.has(v)) return;
    used.add(id);
    lines.push(`- ${cb.fields[i]!.label}: ${v}`);
  };
  for (const id of first) add(id, true);
  const byCat = new Map<string, string[]>();
  for (const f of cb.fields) {
    if (a[f.id] === undefined) continue;
    (byCat.get(f.category) ?? byCat.set(f.category, []).get(f.category)!).push(f.id);
  }
  const cats = [...CATEGORY_ORDER, ...[...byCat.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
  for (const cat of cats) {
    let taken = 0;
    for (const id of byCat.get(cat) ?? []) {
      if (lines.length >= MAX_LINES) break;
      if (used.has(id)) continue;
      add(id);
      if (++taken >= PER_CATEGORY) break;
    }
  }
  return lines.join("\n");
}

/**
 * Turn one decoded MatrAIx record into a Persona. The dataset has no names and
 * its terms forbid tying records to real people, so `name` is empty and no
 * provenance id reaches the prompt. Every decoded field lands in `attributes`
 * under its codebook id, so --filter / --segment work on all 1,290 fields.
 */
export function toPersona(
  cb: Codebook,
  rec: Uint8Array,
  ov: RowOverrides | undefined,
  row: number,
  source: string,
  opts: PersonaOpts = {}
): Persona {
  const a = decodeRecord(cb, rec, ov);
  return {
    id: `mx-${row}`,
    name: "",
    ageRange: a.age_bracket ?? "unknown",
    region: a.region ?? "unknown",
    occupation: occupation(a),
    summary: opts.light ? "" : summarize(cb, a, opts.summaryFields ?? []),
    attributes: { ...a, source },
  };
}
