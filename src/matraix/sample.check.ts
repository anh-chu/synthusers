// Run: npx tsx src/matraix/sample.check.ts   (exits non-zero on failure)
import assert from "node:assert/strict";
import { allocateBalanced, allocateProportional } from "./sample.js";

const sum = (a: number[]) => a.reduce((s, c) => s + c, 0);

// Proportional: never exceeds a stratum, always hits the target.
const counts = [1000, 500, 100, 50, 10];
const p = allocateProportional(counts, 300);
assert.equal(sum(p), 300);
p.forEach((v, i) => assert.ok(v <= counts[i]!, `proportional exceeds stratum ${i}`));
assert.ok(p[0]! > p[1]! && p[1]! > p[4]!, "proportional follows stratum size");
assert.deepEqual(p, allocateProportional(counts, 300), "deterministic");

// A tiny stratum keeps a tiny proportional share: it is not inflated to fill the budget.
const skewed = allocateProportional([900, 5], 100);
assert.equal(sum(skewed), 100);
assert.equal(skewed[1], 1, "5 of 905 rows is about one slot");

// With a floor, a stratum that cannot meet it takes only what exists.
const floorShort = allocateProportional([1000, 3], 300, 20);
assert.equal(sum(floorShort), 300);
assert.equal(floorShort[1], 3);
assert.equal(floorShort[0], 297);

// Floor: every stratum gets at least the floor, then the rest is proportional.
const f = allocateProportional(counts, 300, 20);
assert.equal(sum(f), 300);
f.forEach((v, i) => assert.ok(v >= Math.min(20, counts[i]!), `floor not met for stratum ${i}`));
assert.ok(f[0]! > f[4]!, "leftovers still follow size");

// Floor that cannot fit must fail loudly, not silently.
assert.throws(() => allocateProportional([100, 100, 100], 50, 30), /min-per-stratum/);

// Balanced: equal shares, and what a small stratum cannot take goes to the others.
const b = allocateBalanced([1000, 1000, 1000, 1000], 400);
assert.deepEqual(b, [100, 100, 100, 100]);
const scarce = allocateBalanced([1000, 1000, 3], 300);
assert.equal(sum(scarce), 300);
assert.equal(scarce[2], 3, "small stratum capped at what exists");
assert.ok(Math.abs(scarce[0]! - scarce[1]!) <= 1, "remainder shared evenly between the rest");
assert.deepEqual(scarce, allocateBalanced([1000, 1000, 3], 300), "deterministic");

// Balanced with fewer slots than strata still spends the whole budget.
const tight = allocateBalanced([10, 10, 10, 10, 10], 3);
assert.equal(sum(tight), 3);

// Size above supply returns everything available.
assert.deepEqual(allocateProportional([7, 3], 1000), [7, 3]);
assert.deepEqual(allocateBalanced([7, 3], 1000), [7, 3]);

console.log("sample ok");
