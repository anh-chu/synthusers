import type { TrialResult } from "./types.js";

export type Report = {
  scenarioId: string;
  n: number;
  errors: number;
  successRate: number;
  avgRating: number;
  topFrictions: { friction: string; count: number }[];
  bySegment: Record<string, { key: string; n: number; successRate: number; avgRating: number }[]>;
};

function rate(rs: TrialResult[]): { successRate: number; avgRating: number } {
  const ok = rs.filter((r) => !r.error);
  if (ok.length === 0) return { successRate: 0, avgRating: 0 };
  const succ = ok.filter((r) => r.report.succeeded).length / ok.length;
  const avg = ok.reduce((s, r) => s + r.report.rating, 0) / ok.length;
  return { successRate: succ, avgRating: avg };
}

/** Aggregate trials. `segmentBy` are persona.attributes keys to break down on. */
export function buildReport(results: TrialResult[], segmentBy: string[] = []): Report {
  const scenarioId = results[0]?.scenarioId ?? "unknown";
  const errors = results.filter((r) => r.error).length;
  const { successRate, avgRating } = rate(results);

  const frictionCounts = new Map<string, number>();
  for (const r of results)
    for (const f of r.report.frictions) {
      const k = f.trim().toLowerCase();
      if (k) frictionCounts.set(k, (frictionCounts.get(k) ?? 0) + 1);
    }
  const topFrictions = [...frictionCounts.entries()]
    .map(([friction, count]) => ({ friction, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const bySegment: Report["bySegment"] = {};
  for (const dim of segmentBy) {
    const groups = new Map<string, TrialResult[]>();
    for (const r of results) {
      const v = r.persona.attributes[dim];
      const key = v === undefined ? "(unset)" : String(v);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    bySegment[dim] = [...groups.entries()]
      .map(([key, rs]) => ({ key, n: rs.length, ...rate(rs) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  return { scenarioId, n: results.length, errors, successRate, avgRating, topFrictions, bySegment };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Human-readable console summary. */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`\n=== ${report.scenarioId} ===`);
  lines.push(`n=${report.n}  errors=${report.errors}`);
  lines.push(`success: ${pct(report.successRate)}   avg rating: ${report.avgRating.toFixed(2)}/5`);
  if (report.topFrictions.length) {
    lines.push(`\ntop frictions:`);
    for (const f of report.topFrictions) lines.push(`  ${f.count.toString().padStart(3)}  ${f.friction}`);
  }
  for (const [dim, rows] of Object.entries(report.bySegment)) {
    lines.push(`\nby ${dim}:`);
    for (const row of rows)
      lines.push(`  ${row.key.padEnd(12)} n=${row.n}  success ${pct(row.successRate)}  rating ${row.avgRating.toFixed(2)}`);
  }
  return lines.join("\n");
}
