// Pure helpers for the cluster-figures sparklines: no React, no DOM. The history is a
// fixed set of keys (one array per key, aligned with `at`); a missing figure is a gap
// (null), never 0.
import type { Series } from "../server/history.ts";
import type { ModelFigures } from "../server/metrics.ts";
import type { NodeFigures } from "../server/nodes.ts";

export interface Point {
  atMs: number;
  values: Record<string, number | null>;
}

// Returns a NEW series with the point added at atMs, dropping every point older than
// atMs - windowMs from `at` and from each values array. A point not newer than the last
// `at` is ignored (the series is returned unchanged), and a key missing from `values` is
// recorded as null.
export function appendPoint(
  series: Series,
  atMs: number,
  values: Record<string, number | null>,
  windowMs: number,
): Series {
  const at = series.at;
  if (at.length > 0 && atMs <= at[at.length - 1]) {
    return series;
  }
  const keys = Object.keys(series.values);
  const cutoff = atMs - windowMs;
  const nextAt: number[] = [];
  const nextValues: Record<string, (number | null)[]> = Object.fromEntries(
    keys.map((key): [string, (number | null)[]] => [key, []]),
  );
  for (let i = 0; i < at.length; i++) {
    if (at[i] < cutoff) continue;
    nextAt.push(at[i]);
    for (const key of keys) {
      nextValues[key].push(series.values[key][i]);
    }
  }
  nextAt.push(atMs);
  for (const key of keys) {
    nextValues[key].push(key in values ? values[key] : null);
  }
  return { at: nextAt, values: nextValues };
}

// One model reading as a point. When the model is not "ok", every figure is a gap and the
// point is placed at "now", so the chart shows the outage instead of joining across it. An
// "ok" model with no reading time yields no point.
export function pointFromModel(model: ModelFigures): Point | null {
  if (model.status !== "ok") {
    return {
      atMs: Date.now(),
      values: { running: null, waiting: null, kvCachePercent: null, decodeTokensPerSecond: null },
    };
  }
  if (model.readAt === null) return null;
  return {
    atMs: Date.parse(model.readAt),
    values: {
      running: model.running,
      waiting: model.waiting,
      kvCachePercent: model.kvCachePercent,
      decodeTokensPerSecond: model.decodeTokensPerSecond,
    },
  };
}

// One node reading as a point, with the same not-ok/gap rules as pointFromModel.
export function pointFromNode(node: NodeFigures): Point | null {
  if (node.status !== "ok") {
    return {
      atMs: Date.now(),
      values: { cpuPercent: null, gpuPercent: null, cpuTempC: null, gpuTempC: null },
    };
  }
  if (node.readAt === null) return null;
  return {
    atMs: Date.parse(node.readAt),
    values: {
      cpuPercent: node.cpuPercent,
      gpuPercent: node.gpuPercent,
      cpuTempC: node.cpuTempC,
      gpuTempC: node.gpuTempC,
    },
  };
}

// The uPlot-friendly view of one key: x in seconds (at / 1000), nulls kept as null.
export function toUplotData(series: Series, key: string): [number[], (number | null)[]] {
  return [series.at.map((atMs) => atMs / 1000), series.values[key] ?? []];
}
