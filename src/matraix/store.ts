import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCodebook, REC_BYTES, type Codebook, type RowOverrides } from "./codec.js";

export const DATASET = "MatrAIx2026/MatrAIx_Persona_1M";

export const cacheDir = (): string => {
  const dir = process.env.SYNTHUSERS_CACHE ?? join(homedir(), ".cache", "synthusers", "matraix");
  mkdirSync(dir, { recursive: true });
  return dir;
};

export type Manifest = {
  rows: number;
  sources: Record<string, number>;
  files: { path: string; rows: number }[];
};
/** Sidecar for one cached shard: source names + sparse per-row overrides (flat [field, value, ...]). */
export type ShardMeta = {
  rows: number;
  base: number;
  sources: string[];
  overrides: Record<string, (number | string)[]>;
};
export type Shard = { n: number; bin: Buffer; meta: ShardMeta };

export const shardPaths = (dir: string, n: number) => ({
  bin: join(dir, `shard-${n}.bin`),
  meta: join(dir, `shard-${n}.json`),
});

/** Cached shard numbers that are complete (meta is written last, so its presence means done). */
export function cachedShards(dir = cacheDir()): number[] {
  const out: number[] = [];
  for (let n = 0; n < 10; n++) if (existsSync(shardPaths(dir, n).meta)) out.push(n);
  return out;
}

export function matraixAvailable(): boolean {
  const dir = cacheDir();
  return existsSync(join(dir, "persona_codes.schema.json")) && cachedShards(dir).length > 0;
}

let cb: Codebook | undefined;
export function loadCodebook(): Codebook {
  if (!cb) {
    const p = join(cacheDir(), "persona_codes.schema.json");
    if (!existsSync(p)) throw new Error("MatrAIx codebook not cached. Run: synthusers fetch");
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (raw.packing !== "nibble" || raw.row_bytes !== 645 || raw.columns?.length !== 1290)
      throw new Error("Unexpected MatrAIx codebook layout (expected nibble packing, 645 bytes, 1,290 fields). Upstream may have changed; update synthusers.");
    cb = buildCodebook(raw);
  }
  return cb;
}

const metas = new Map<number, ShardMeta>();
function loadMeta(n: number, dir: string): ShardMeta {
  let m = metas.get(n);
  if (!m) metas.set(n, (m = JSON.parse(readFileSync(shardPaths(dir, n).meta, "utf8")) as ShardMeta));
  return m;
}

/**
 * Exact values that appear only as per-row overrides (e.g. age_bracket "65+",
 * region "Southern Europe"): not in the codebook, but real. Filters accept them.
 */
export function overrideValues(shards: number[], dir = cacheDir()): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const n of shards)
    for (const flat of Object.values(loadMeta(n, dir).overrides))
      for (let k = 0; k < flat.length; k += 2) {
        const v = String(flat[k + 1]);
        if (v === "null") continue;
        const f = flat[k] as number;
        (out.get(f) ?? out.set(f, new Set()).get(f)!).add(v);
      }
  return out;
}

export function loadShard(n: number, dir = cacheDir()): Shard {
  const p = shardPaths(dir, n);
  const meta = loadMeta(n, dir);
  const bin = readFileSync(p.bin);
  if (bin.length !== meta.rows * REC_BYTES) throw new Error(`Corrupt cache for shard ${n}; rerun: synthusers fetch --shards ${n} --force`);
  return { n, bin, meta };
}

export const recordAt = (s: Shard, i: number): Uint8Array =>
  s.bin.subarray(i * REC_BYTES, (i + 1) * REC_BYTES);

export function overridesAt(s: Shard, i: number): RowOverrides | undefined {
  const flat = s.meta.overrides[i];
  if (!flat) return undefined;
  const m: RowOverrides = new Map();
  for (let k = 0; k < flat.length; k += 2) m.set(flat[k] as number, String(flat[k + 1]));
  return m;
}
