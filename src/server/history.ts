// The cluster figures over time, kept in memory for a window (lost on restart). A missing
// figure is a gap (null), never 0. Rules: docs/ARCHITECTURE.md "Figures over time".
import type { ModelFigures } from "./metrics.ts";
import type { NodeFigures } from "./nodes.ts";

export const MODEL_KEYS = ["running", "waiting", "kvCachePercent", "decodeTokensPerSecond"] as const;
export const NODE_KEYS = ["cpuPercent", "gpuPercent", "cpuTempC", "gpuTempC"] as const;

export interface Series {
  at: number[];                               // ms since the epoch, oldest first
  values: Record<string, (number | null)[]>;  // one array per key, aligned with `at`
}

export interface ClusterHistory {
  windowSeconds: number;
  model: Series;
  nodes: { name: string; series: Series }[];  // in the order the nodes were configured
}

// One window of points for a fixed set of keys.
export class FigureHistory {
  private readonly windowMs: number;
  private readonly keys: readonly string[];
  private readonly series: Series;

  constructor(windowSeconds: number, keys: readonly string[]) {
    this.windowMs = windowSeconds * 1000;
    this.keys = keys;
    this.series = { at: [], values: Object.fromEntries(keys.map((k) => [k, []])) };
  }

  // Add a point (a key missing from `figures`, or not a finite number, is a gap) and drop
  // every point older than the window before `atMs`. A point not newer than the last is ignored.
  push(atMs: number, figures: Record<string, unknown>): void {
    const at = this.series.at;
    if (at.length > 0 && atMs <= at[at.length - 1]) {
      return;
    }
    at.push(atMs);
    for (const key of this.keys) {
      const value = figures[key];
      this.series.values[key].push(typeof value === "number" && Number.isFinite(value) ? value : null);
    }
    const cutoff = atMs - this.windowMs;
    while (at.length > 0 && at[0] < cutoff) {
      at.shift();
      for (const key of this.keys) {
        this.series.values[key].shift();
      }
    }
  }

  snapshot(): Series {
    return { at: [...this.series.at], values: Object.fromEntries(Object.entries(this.series.values).map(([k, v]) => [k, [...v]])) };
  }
}

// The model server's and each node's history. A figures source that is not "ok" adds a
// point of gaps, so the chart shows the outage instead of joining across it.
export class ClusterHistoryStore {
  private readonly windowSeconds: number;
  private readonly model: FigureHistory;
  private readonly nodes = new Map<string, FigureHistory>();

  constructor(windowSeconds: number) {
    this.windowSeconds = windowSeconds;
    this.model = new FigureHistory(windowSeconds, MODEL_KEYS);
  }

  pushModel(atMs: number, figures: ModelFigures): void {
    this.model.push(atMs, figures.status === "ok" ? { ...figures } : {});
  }

  pushNodes(atMs: number, list: NodeFigures[]): void {
    for (const node of list) {
      let history = this.nodes.get(node.name);
      if (history === undefined) {
        history = new FigureHistory(this.windowSeconds, NODE_KEYS);
        this.nodes.set(node.name, history);
      }
      history.push(atMs, node.status === "ok" ? { ...node } : {});
    }
  }

  snapshot(): ClusterHistory {
    return {
      windowSeconds: this.windowSeconds,
      model: this.model.snapshot(),
      nodes: [...this.nodes].map(([name, h]) => ({ name, series: h.snapshot() })),
    };
  }
}
