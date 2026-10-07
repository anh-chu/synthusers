/**
 * MatrAIx Persona 1M codec.
 *
 * Upstream packs each persona's 1,290 categorical attributes as 4-bit codes
 * (645 bytes, low nibble first) plus a 162-byte "missing" bitmap. We cache one
 * fixed-size record per persona:
 *
 *   [0..645)    packed attribute codes
 *   [645..807)  null bitmap (set bit = missing, LSB first)
 *   [807]       source index (into the shard's `sources` list)
 *   [808..810)  populated attribute count, uint16 LE
 */
export const N_FIELDS = 1290;
export const ATTR_BYTES = 645;
export const BITMAP_BYTES = 162;
export const REC_BYTES = 810;
const SRC_OFF = ATTR_BYTES + BITMAP_BYTES;

export type Field = { id: string; label: string; category: string; values: string[] };
export type Codebook = { fields: Field[]; index: Map<string, number> };

export function buildCodebook(schema: { columns: Field[] }): Codebook {
  const fields = schema.columns;
  return { fields, index: new Map(fields.map((f, i) => [f.id, i])) };
}

/** Per-row exact values outside the codebook. The string "null" means missing. */
export type RowOverrides = Map<number, string>;

/** Write one record into `out` at `off`. A null `bitmap` means nothing is missing. */
export function packRecord(
  out: Uint8Array,
  off: number,
  attrs: Uint8Array,
  bitmap: Uint8Array | null,
  sourceIdx: number,
  populated: number
): void {
  out.set(attrs.subarray(0, ATTR_BYTES), off);
  if (bitmap) out.set(bitmap.subarray(0, BITMAP_BYTES), off + ATTR_BYTES);
  else out.fill(0, off + ATTR_BYTES, off + SRC_OFF);
  out[off + SRC_OFF] = sourceIdx;
  out[off + SRC_OFF + 1] = populated & 0xff;
  out[off + SRC_OFF + 2] = (populated >> 8) & 0xff;
}

export const recSource = (rec: Uint8Array): number => rec[SRC_OFF]!;
export const recPopulated = (rec: Uint8Array): number => rec[SRC_OFF + 1]! | (rec[SRC_OFF + 2]! << 8);

/** Decoded value of field `i` in one record, or undefined when missing. Overrides win. */
export function fieldValue(
  cb: Codebook,
  rec: Uint8Array,
  i: number,
  ov?: RowOverrides
): string | undefined {
  if (ov) {
    const o = ov.get(i);
    if (o !== undefined) return o === "null" ? undefined : o;
  }
  if ((rec[ATTR_BYTES + (i >> 3)]! >> (i & 7)) & 1) return undefined;
  const byte = rec[i >> 1]!;
  const code = i & 1 ? byte >> 4 : byte & 0x0f;
  return cb.fields[i]!.values[code]; // code >= values.length -> undefined (missing)
}

/** Decode every populated field of one record: { fieldId: value }. */
export function decodeRecord(
  cb: Codebook,
  rec: Uint8Array,
  ov?: RowOverrides
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < cb.fields.length; i++) {
    const v = fieldValue(cb, rec, i, ov);
    if (v !== undefined) out[cb.fields[i]!.id] = v;
  }
  return out;
}
