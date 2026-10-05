// Whether a figure is fine, by its thresholds, and the chart range. Pure: no React.
import type { Series } from "../server/history.ts";

export type Level = "ok" | "warn" | "hot";

// Under `warn` is ok, from `warn` amber, from `hot` red. A missing figure has no level.
export function level(value: number | null, warn: number, hot: number): Level | null {
  if (value === null) return null;
  return value >= hot ? "hot" : value >= warn ? "warn" : "ok";
}

// The colour class for a level: green ok rings, amber warn, red hot.
export const LEVEL_TEXT: Record<Level, string> = { ok: "text-state-ok", warn: "text-warn", hot: "text-hot" };

// The points at or after `fromMs`, every key cut alike.
export function sinceMs(series: Series, fromMs: number): Series {
  const first = series.at.findIndex((at) => at >= fromMs);
  const start = first === -1 ? series.at.length : first;
  const values: Series["values"] = {};
  for (const [key, list] of Object.entries(series.values)) values[key] = list.slice(start);
  return { at: series.at.slice(start), values };
}
