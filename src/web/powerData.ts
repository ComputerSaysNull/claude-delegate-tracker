// The History tab's GPU power figures, computed from the per-UTC-hour power buckets and the run
// records. Pure: no React, no fetch.
import type { PowerBucket } from "../server/power.ts";
import type { RunRecord } from "../server/runs.ts";
import { bucketIndex, type Span } from "./historyData.ts";

export interface PowerDay {
  label: string;                                  // "12 Oct", as kvPerDay labels days
  byNode: { node: string; wh: number | null; averageW: number | null; maxW: number | null }[];
  wh: number | null;                              // all nodes' Wh that day; null when no node has a figure
  whPerKiloToken: number | null;                  // wh ÷ (that day's output tokens ÷ 1000)
  outputTokens: number;                           // output tokens of the turns that finished that day
}

// One entry per span bucket, oldest first: each bucket's per-node Wh, whole-watt average and peak,
// and the bucket's Wh per 1k output tokens of the turns that finished in it.
export function powerPerDay(buckets: PowerBucket[], runs: RunRecord[], span: Span): PowerDay[] {
  const result: PowerDay[] = span.buckets.map((b) => ({
    label: b.label, byNode: [], wh: null, whPerKiloToken: null, outputTokens: 0,
  }));
  const nodes = new Set<string>();
  const acc = span.buckets.map(() => new Map<string, { whSum: number; seconds: number; maxW: number | null }>());
  for (const b of buckets) {
    const index = bucketIndex(span, b.hour);
    if (index === undefined) continue;
    nodes.add(b.node);
    let a = acc[index].get(b.node);
    if (!a) {
      a = { whSum: 0, seconds: 0, maxW: null };
      acc[index].set(b.node, a);
    }
    a.whSum += b.wh;
    a.seconds += b.seconds;
    if (b.maxW !== null && (a.maxW === null || b.maxW > a.maxW)) a.maxW = b.maxW;
  }
  // The output tokens per bucket: the turns whose slot finished in it; a null figure adds nothing.
  const tokens = span.buckets.map(() => 0);
  for (const r of runs) {
    for (const slot of r.slots) {
      const output = slot[3];
      if (output === null) continue;
      const index = bucketIndex(span, slot[0]);
      if (index === undefined) continue;
      tokens[index] += output;
    }
  }
  const nodeList = [...nodes].sort();
  for (let i = 0; i < result.length; i++) {
    const dayAcc = acc[i];
    const byNode = nodeList.map((node) => {
      const a = dayAcc.get(node);
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
    const dayTokens = tokens[i];
    const whPerKiloToken = dayWh !== null && dayTokens > 0 ? Math.round((dayWh / (dayTokens / 1000)) * 100) / 100 : null;
    result[i] = { label: result[i].label, byNode, wh: dayWh, whPerKiloToken, outputTokens: dayTokens };
  }
  return result;
}
