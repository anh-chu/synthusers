import type { CohortFilter, Persona } from "../types.js";
import { fieldValue, recPopulated, recSource, type Codebook, type RowOverrides } from "./codec.js";
import { cachedShards, loadCodebook, loadShard, overridesAt, recordAt } from "./store.js";
import { toPersona } from "./toPersona.js";

export type FieldSpec = Record<string, (string | number | boolean)[] | string | number | boolean>;

export type SampleOpts = {
  size: number;
  /** field id -> allowed value(s). OR within a field, AND across fields. Missing never matches. */
  filter?: FieldSpec;
  /**
   * Restrict to these dataset sources (synthetic, wiki, stackoverflow, gss, amazon, prism, real_human_survey).
   * Default: everything except `wiki` (model-extracted profiles of notable, mostly older real people:
   * a poor fit for product testing and a responsible-use risk). Pass sources: ["wiki"] to opt in.
   */
  sources?: string[];
  /** Skip sparse rows. Default 60 (Amazon/GSS rows carry only ~12-16 attributes). */
  minAttrs?: number;
  includeMinors?: boolean;
  seed?: number;
  /** Proportional allocation across the combinations of these fields. Rows missing a field are dropped. */
  stratify?: string[];
  summaryFields?: string[];
  /** Arbitrary filter on decoded attributes. Decodes every candidate row: slower than `filter`. */
  predicate?: CohortFilter;
};
export type SampleResult = { personas: Persona[]; scanned: number; matched: number; seed: number };

const MINOR_BRACKETS = new Set(["Under 5", "5-12", "13-17"]);

// --- "did you mean" ---------------------------------------------------------
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
export function suggest(input: string, candidates: string[], n = 5): string[] {
  const q = input.toLowerCase();
  const scored = candidates.map((c) => {
    const l = c.toLowerCase();
    return { c, s: l.includes(q) || q.includes(l) ? 0 : lev(q, l) };
  });
  return scored
    .filter((x) => x.s <= Math.max(2, Math.floor(q.length / 3)))
    .sort((a, b) => a.s - b.s)
    .slice(0, n)
    .map((x) => x.c);
}

export function fieldIndex(cb: Codebook, id: string): number {
  const i = cb.index.get(id);
  if (i !== undefined) return i;
  const hint = suggest(id, cb.fields.map((f) => f.id));
  throw new Error(
    `Unknown MatrAIx field "${id}".${hint.length ? ` Did you mean: ${hint.join(", ")}?` : ""} (list fields: synthusers fields)`
  );
}

/** Validate a spec against the codebook; canonicalize value case. Returns [fieldIdx, allowed values][]. */
export function compileSpec(cb: Codebook, spec: FieldSpec): { idx: number; allowed: Set<string> }[] {
  return Object.entries(spec).map(([id, want]) => {
    const idx = fieldIndex(cb, id);
    const values = cb.fields[idx]!.values;
    const allowed = new Set<string>();
    for (const w of Array.isArray(want) ? want : [want]) {
      const hit = values.find((v) => v.toLowerCase() === String(w).toLowerCase());
      if (!hit) {
        const hint = suggest(String(w), values);
        throw new Error(
          `Field "${id}" has no value "${w}". ${hint.length ? `Did you mean: ${hint.join(", ")}? ` : ""}Values: ${values.join(" | ")}`
        );
      }
      allowed.add(hit);
    }
    return { idx, allowed };
  });
}

// --- seeded PRNG ------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Item = { row: number; rec: Uint8Array; ov?: RowOverrides; source: string };
type Bucket = { seen: number; items: Item[] };

function pushReservoir(b: Bucket, item: Item, cap: number, rnd: () => number): void {
  b.seen++;
  if (b.items.length < cap) b.items.push(item);
  else {
    const j = Math.floor(rnd() * b.seen);
    if (j < cap) b.items[j] = item;
  }
}

/** Largest-remainder proportional allocation of `size` across bucket counts. */
function allocate(counts: number[], size: number): number[] {
  const total = counts.reduce((s, c) => s + c, 0);
  const exact = counts.map((c) => (c / total) * size);
  const out = exact.map(Math.floor);
  let left = size - out.reduce((s, c) => s + c, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left <= 0) break;
    if (out[i]! < counts[i]!) (out[i]!++, left--);
  }
  return out;
}

/**
 * Seeded, one-pass sample over every cached shard (up to ~1M personas).
 * Reservoir sampling keeps memory at O(size); stratified mode keeps one
 * reservoir per stratum.
 * ponytail: with --stratify, memory is strata x size records (~810 B each).
 * Fine for size <= a few thousand; upgrade to a two-pass count-then-sample if it hurts.
 */
export function sampleMatraix(opts: SampleOpts): SampleResult {
  const cb = loadCodebook();
  const shards = cachedShards();
  if (!shards.length) throw new Error("No MatrAIx shards cached. Run: synthusers fetch");
  const filters = compileSpec(cb, opts.filter ?? {});
  const strata = (opts.stratify ?? []).map((id) => fieldIndex(cb, id));
  const ageIdx = cb.index.get("age_bracket")!;
  const minAttrs = opts.minAttrs ?? 60;
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = mulberry32(seed);
  const wantSources = opts.sources?.length ? new Set(opts.sources) : undefined;
  const skipSources = wantSources ? undefined : new Set(["wiki"]);
  const buckets = new Map<string, Bucket>();
  let scanned = 0;
  let matched = 0;

  for (const n of shards) {
    const s = loadShard(n);
    if (wantSources) {
      const unknown = [...wantSources].filter((w) => !s.meta.sources.includes(w));
      if (unknown.length) throw new Error(`Unknown source "${unknown[0]}". Sources: ${s.meta.sources.join(", ")}`);
    }
    for (let i = 0; i < s.meta.rows; i++) {
      scanned++;
      const rec = recordAt(s, i);
      if (recPopulated(rec) < minAttrs) continue;
      const source = s.meta.sources[recSource(rec)]!;
      if (wantSources ? !wantSources.has(source) : skipSources!.has(source)) continue;
      const ov = s.meta.overrides[i] ? overridesAt(s, i) : undefined;
      if (!opts.includeMinors) {
        const age = fieldValue(cb, rec, ageIdx, ov);
        if (age !== undefined && MINOR_BRACKETS.has(age)) continue;
      }
      let ok = true;
      for (const f of filters) {
        const v = fieldValue(cb, rec, f.idx, ov);
        if (v === undefined || !f.allowed.has(v)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let key = "";
      if (strata.length) {
        const vals = strata.map((k) => fieldValue(cb, rec, k, ov));
        if (vals.includes(undefined)) continue;
        key = vals.join("\u0000");
      }
      const row = s.meta.base + i;
      if (opts.predicate && !opts.predicate(toPersona(cb, rec, ov, row, source, { light: true }))) continue;
      matched++;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { seen: 0, items: [] }));
      // Copy: the record is a view into the shard buffer, which is freed after the loop.
      pushReservoir(b, { row, rec: Uint8Array.from(rec), ov, source }, opts.size, rnd);
    }
  }

  let picked: Item[];
  const all = [...buckets.values()];
  if (!strata.length) picked = all[0]?.items ?? [];
  else {
    const take = allocate(all.map((b) => b.seen), Math.min(opts.size, matched));
    picked = all.flatMap((b, k) => {
      const items = [...b.items];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [items[i], items[j]] = [items[j]!, items[i]!];
      }
      return items.slice(0, take[k]);
    });
  }
  picked.sort((a, b) => a.row - b.row);
  const personas = picked.map((p) => toPersona(cb, p.rec, p.ov, p.row, p.source, { summaryFields: opts.summaryFields }));
  return { personas, scanned, matched, seed };
}
