/**
 * `synthusers fetch`: download the parts of MatrAIx Persona 1M we need into a
 * local cache (never into git: the dataset is research-only licensed).
 *
 * Each 1 GB shard is range-read over HTTP, one row group at a time, taking only
 * the compact columns (attributes, null_bitmap, overrides, source, count). The
 * multi-GB `descriptions` / `grounding` columns are skipped. All 10 shards come
 * to about 810 MB on disk (~80 MB each); `--shards` takes a subset.
 */
import { closeSync, existsSync, openSync, renameSync, writeFileSync, writeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { ATTR_BYTES, BITMAP_BYTES, REC_BYTES, packRecord } from "./codec.js";
import { DATASET, cacheDir, shardPaths, type Manifest, type ShardMeta } from "./store.js";

const endpoint = () => (process.env.HF_ENDPOINT ?? "https://huggingface.co").replace(/\/$/, "");
const url = (path: string) => `${endpoint()}/datasets/${DATASET}/resolve/main/${path}`;
const headers = (): Record<string, string> =>
  process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};

async function download(path: string, dest: string): Promise<void> {
  const res = await fetch(url(path), { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

/** Parse "0-3,7" / "9" / "all" into shard numbers. */
export function parseShards(spec: string | undefined): number[] {
  if (!spec || spec === "all") return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`Bad --shards "${spec}" (use e.g. 9, 0-3, 0,5,9, or all)`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= b; n++) {
      if (n > 9) throw new Error(`Shard ${n} out of range (0-9)`);
      out.add(n);
    }
  }
  return [...out].sort((x, y) => x - y);
}

async function fetchShard(n: number, manifest: Manifest, base: number, dir: string): Promise<void> {
  const rel = manifest.files[n]!.path;
  const expected = manifest.files[n]!.rows;
  const sources = Object.keys(manifest.sources);
  const file = await asyncBufferFromUrl({ url: url(rel), requestInit: { headers: headers() } });
  const metadata = await retry(() => parquetMetadataAsync(file));
  const paths = shardPaths(dir, n);
  const fd = openSync(paths.bin + ".part", "w");
  const overrides: ShardMeta["overrides"] = {};
  let row = 0;
  const t0 = Date.now();
  try {
    for (const rg of metadata.row_groups) {
      const count = Number(rg.num_rows);
      const rows = await retry(() =>
        parquetReadObjects({
          file,
          metadata,
          compressors,
          rowStart: row,
          rowEnd: row + count,
          columns: ["source", "attributes", "null_bitmap", "attribute_overrides", "populated_attribute_count"],
        })
      );
      const buf = new Uint8Array(rows.length * REC_BYTES);
      rows.forEach((r, i) => {
        const attrs = r.attributes as Uint8Array;
        if (!attrs || attrs.length !== ATTR_BYTES) throw new Error(`shard ${n} row ${row + i}: bad attributes length`);
        const bm = r.null_bitmap as Uint8Array | null;
        if (bm && bm.length !== BITMAP_BYTES) throw new Error(`shard ${n} row ${row + i}: bad null_bitmap length`);
        const si = sources.indexOf(String(r.source));
        if (si < 0) throw new Error(`shard ${n} row ${row + i}: unknown source ${r.source}`);
        packRecord(buf, i * REC_BYTES, attrs, bm ?? null, si, Number(r.populated_attribute_count ?? 0));
        const ov = r.attribute_overrides as { field_index: number; value: string }[] | null;
        if (ov?.length) overrides[row + i] = ov.flatMap((o) => [Number(o.field_index), String(o.value)]);
      });
      writeSync(fd, buf);
      row += rows.length;
      const pct = ((row / expected) * 100).toFixed(0);
      process.stderr.write(`\r  shard ${n}: ${row}/${expected} (${pct}%) ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
    }
  } finally {
    closeSync(fd);
  }
  if (row !== expected) throw new Error(`shard ${n}: got ${row} rows, manifest says ${expected}`);
  renameSync(paths.bin + ".part", paths.bin);
  // Meta last: its presence marks the shard as complete (makes fetch resumable).
  const meta: ShardMeta = { rows: row, base, sources, overrides };
  writeFileSync(paths.meta, JSON.stringify(meta));
  process.stderr.write("\n");
}

export async function fetchCommand(opts: { shards?: string; force?: boolean }): Promise<void> {
  const dir = cacheDir();
  const shards = parseShards(opts.shards);
  const first = !existsSync(join(dir, "manifest.json"));
  if (first) {
    console.error(
      `MatrAIx Persona 1M is released for NON-COMMERCIAL RESEARCH use only, and subsets inherit that\n` +
        `license. Data is cached in ${dir} (outside git). Do not commit or redistribute it.\n` +
        `Terms: https://huggingface.co/datasets/${DATASET}\n`
    );
  }
  for (const f of ["persona_codes.schema.json", "manifest.json"]) {
    if (opts.force || !existsSync(join(dir, f))) await retry(() => download(f, join(dir, f)));
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  let base = 0;
  const bases = manifest.files.map((f) => (base += f.rows) - f.rows);
  for (const n of shards) {
    if (!opts.force && existsSync(shardPaths(dir, n).meta)) {
      console.error(`  shard ${n}: cached, skipping`);
      continue;
    }
    await fetchShard(n, manifest, bases[n]!, dir);
  }
  console.error(`Done. Cache: ${dir}`);
}
