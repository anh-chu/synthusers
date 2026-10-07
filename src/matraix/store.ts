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
    cb = buildCodebook(JSON.parse(readFileSync(p, "utf8")));
  }
  return cb;
}

export function loadShard(n: number, dir = cacheDir()): Shard {
  const p = shardPaths(dir, n);
  const meta = JSON.parse(readFileSync(p.meta, "utf8")) as ShardMeta;
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
