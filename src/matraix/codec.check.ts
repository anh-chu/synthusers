// Run: npx tsx src/matraix/codec.check.ts   (exits non-zero on failure)
import assert from "node:assert/strict";
import { ATTR_BYTES, BITMAP_BYTES, REC_BYTES, buildCodebook, decodeRecord, fieldValue, packRecord, recPopulated, recSource } from "./codec.js";

const cb = buildCodebook({
  columns: Array.from({ length: 1290 }, (_, i) => ({
    id: `f${i}`,
    label: `F${i}`,
    category: "c",
    values: ["a", "b", "c"],
  })),
});
const attrs = new Uint8Array(ATTR_BYTES);
attrs[0] = 0x21; // field 0 (low nibble)=1 -> "b", field 1 (high nibble)=2 -> "c"
attrs[1] = 0x0f; // field 2 = 15 (outside codebook) -> missing; field 3 = 0 -> "a"
attrs[2] = 0x11; // fields 4,5 = "b"; field 5 flagged missing in bitmap
const bitmap = new Uint8Array(BITMAP_BYTES);
bitmap[0] = (bitmap[0] ?? 0) | (1 << 5); // field 5 missing (LSB first)
const rec = new Uint8Array(REC_BYTES);
packRecord(rec, 0, attrs, bitmap, 3, 700);

assert.equal(fieldValue(cb, rec, 0), "b");
assert.equal(fieldValue(cb, rec, 1), "c");
assert.equal(fieldValue(cb, rec, 2), undefined, "out-of-codebook code is missing");
assert.equal(fieldValue(cb, rec, 3), "a");
assert.equal(fieldValue(cb, rec, 4), "b");
assert.equal(fieldValue(cb, rec, 5), undefined, "bitmap bit set = missing");
assert.equal(fieldValue(cb, rec, 0, new Map([[0, "65+"]])), "65+", "override wins");
assert.equal(fieldValue(cb, rec, 0, new Map([[0, "null"]])), undefined, "null override = missing");
assert.equal(recSource(rec), 3);
assert.equal(recPopulated(rec), 700);

// null bitmap: nothing is missing
const rec2 = new Uint8Array(REC_BYTES);
packRecord(rec2, 0, attrs, null, 0, 1290);
assert.equal(fieldValue(cb, rec2, 5), "b");
const d = decodeRecord(cb, rec);
assert.equal(d.f0, "b");
assert.equal("f5" in d, false);
console.log("codec ok");
