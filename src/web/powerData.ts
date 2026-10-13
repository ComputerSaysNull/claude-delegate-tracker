// The History tab's GPU power figures, computed from the per-UTC-hour power buckets and the run
// records. Pure: no React, no fetch.
import type { PowerBucket } from "../server/power.ts";
import type { RunRecord } from "../server/runs.ts";
import type { Range } from "./historyData.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PowerDay {
  label: string;                                  // "12 Oct", as kvPerDay labels days
  byNode: { node: string; wh: number | null; averageW: number | null; maxW: number | null }[];
  wh: number | null;                              // all nodes' Wh that day; null when no node has a figure
  whPerKiloToken: number | null;                  // wh ÷ (that day's output tokens ÷ 1000)
  outputTokens: number;                           // output tokens of the runs that started that day
}

// Exactly `days` entries, oldest first: each day's per-node Wh, whole-watt average and peak, and
// the day's Wh per 1k output tokens of the runs that started on that local day.
export function powerPerDay(buckets: PowerBucket[], runs: RunRecord[], days: Range, now: Date): PowerDay[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const byDay = new Map<number, number>();
  const result: PowerDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    byDay.set(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), i);
    result.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, byNode: [], wh: null, whPerKiloToken: null, outputTokens: 0 });
  }
  const nodes = new Set<string>();
  const acc = new Map<number, Map<string, { whSum: number; seconds: number; maxW: number | null }>>();
  for (const b of buckets) {
    const d = new Date(b.hour);
    const index = byDay.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    if (index === undefined) continue;
    nodes.add(b.node);
    let dayAcc = acc.get(index);
    if (!dayAcc) {
      dayAcc = new Map();
      acc.set(index, dayAcc);
    }
    let a = dayAcc.get(b.node);
    if (!a) {
      a = { whSum: 0, seconds: 0, maxW: null };
      dayAcc.set(b.node, a);
    }
    a.whSum += b.wh;
    a.seconds += b.seconds;
    if (b.maxW !== null && (a.maxW === null || b.maxW > a.maxW)) a.maxW = b.maxW;
  }
  // The output tokens per day: the runs that started that local day; a null figure adds nothing.
  const tokens = new Map<number, number>();
  for (const r of runs) {
    if (r.startedAt === null || r.outputTokens === null) continue;
    const d = new Date(r.startedAt);
    const index = byDay.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    if (index === undefined) continue;
    tokens.set(index, (tokens.get(index) ?? 0) + r.outputTokens);
  }
  const nodeList = [...nodes].sort();
  for (let i = 0; i < days; i++) {
    const dayAcc = acc.get(i);
    const byNode = nodeList.map((node) => {
      const a = dayAcc?.get(node);
      if (a === undefined) return { node, wh: null, averageW: null, maxW: null };
      return {
        node,
        wh: Math.round(a.whSum * 10) / 10,
        averageW: a.seconds === 0 ? null : Math.round((a.whSum * 3600) / a.seconds),
        maxW: a.maxW,
      };
    });
    let dayWh: number | null = null;
    for (const n of byNode) {
      if (n.wh !== null) dayWh = (dayWh ?? 0) + n.wh;
    }
    if (dayWh !== null) dayWh = Math.round(dayWh * 10) / 10;
    const dayTokens = tokens.get(i) ?? 0;
    const whPerKiloToken = dayWh !== null && dayTokens > 0 ? Math.round((dayWh / (dayTokens / 1000)) * 100) / 100 : null;
    result[i] = { label: result[i].label, byNode, wh: dayWh, whPerKiloToken, outputTokens: dayTokens };
  }
  return result;
}
