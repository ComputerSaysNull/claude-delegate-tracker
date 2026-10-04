// One test per rule in docs/ARCHITECTURE.md "Figures over time".
import { describe, expect, it } from "vitest";
import {
  ClusterHistoryStore,
  FigureHistory,
  MODEL_KEYS,
  NODE_KEYS,
} from "../../src/server/history.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

const T0 = 1_700_000_000_000;

const model = (over: Partial<ModelFigures> = {}): ModelFigures => ({
  status: "ok",
  running: 1,
  waiting: 2,
  kvCachePercent: 50,
  decodeTokensPerSecond: 12.5,
  decodeWindowSeconds: 5,
  prefixHitPercent: 50,
  preemptions: 0,
  readAt: new Date(T0).toISOString(),
  ...over,
});

const node = (name: string, over: Partial<NodeFigures> = {}): NodeFigures => ({
  name,
  status: "ok",
  cpuPercent: 10,
  cpuWindowSeconds: 2,
  cpuTempC: 40,
  gpuPercent: 20,
  gpuTempC: 50,
  readAt: new Date(T0).toISOString(),
  ...over,
});

describe("FigureHistory", () => {
  it("records a pushed point with its values aligned to `at`", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(T0, { running: 1, waiting: 2, kvCachePercent: 50, decodeTokensPerSecond: 12.5 });
    const s = h.snapshot();
    expect(s.at).toEqual([T0]);
    expect(s.values["running"]).toEqual([1]);
    expect(s.values["waiting"]).toEqual([2]);
    expect(s.values["kvCachePercent"]).toEqual([50]);
    expect(s.values["decodeTokensPerSecond"]).toEqual([12.5]);
  });

  it("records a missing key as a gap (null), never 0", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(T0, { running: 1 });
    const s = h.snapshot();
    expect(s.at).toEqual([T0]);
    expect(s.values["running"]).toEqual([1]);
    expect(s.values["waiting"]).toEqual([null]);
    expect(s.values["kvCachePercent"]).toEqual([null]);
    expect(s.values["decodeTokensPerSecond"]).toEqual([null]);
  });

  it("records a value that is not a finite number (NaN, ±Infinity, a string) as a gap, never 0", () => {
    for (const bad of [NaN, Infinity, -Infinity, "oops"]) {
      const h = new FigureHistory(10, MODEL_KEYS);
      h.push(T0, { running: bad });
      const s = h.snapshot();
      expect(s.values["running"]).toEqual([null]);
    }
  });

  it("keeps a measured 0 as 0", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(T0, { running: 0 });
    const s = h.snapshot();
    expect(s.values["running"]).toEqual([0]);
  });

  it("drops points older than the window before the newest, from `at` and every values array alike", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(0, { running: 1 });
    h.push(5_000, { running: 2 });
    h.push(11_000, { running: 3 });
    h.push(16_000, { running: 4 });
    const s = h.snapshot();
    expect(s.at).toEqual([11_000, 16_000]);
    expect(s.values["running"]).toEqual([3, 4]);
    expect(s.values["waiting"]).toEqual([null, null]);
    expect(s.values["kvCachePercent"]).toEqual([null, null]);
    expect(s.values["decodeTokensPerSecond"]).toEqual([null, null]);
  });

  it("ignores a point not newer than the last", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(T0, { running: 1 });
    h.push(T0, { running: 2 });
    h.push(T0 - 1_000, { running: 3 });
    const s = h.snapshot();
    expect(s.at).toEqual([T0]);
    expect(s.values["running"]).toEqual([1]);
  });

  it("returns copies from snapshot, so mutating one does not change the store", () => {
    const h = new FigureHistory(10, MODEL_KEYS);
    h.push(T0, { running: 1, waiting: 2, kvCachePercent: 3, decodeTokensPerSecond: 4 });
    const s = h.snapshot();
    s.at.push(999);
    s.values["running"].push(999);
    const s2 = h.snapshot();
    expect(s2.at).toEqual([T0]);
    expect(s2.values["running"]).toEqual([1]);
  });
});

describe("ClusterHistoryStore", () => {
  it("records running/waiting/kvCachePercent/decodeTokensPerSecond when the model is ok", () => {
    const store = new ClusterHistoryStore(10);
    store.pushModel(T0, model({ running: 1, waiting: 2, kvCachePercent: 50, decodeTokensPerSecond: 12.5 }));
    const s = store.snapshot();
    expect(s.windowSeconds).toBe(10);
    expect(s.model.at).toEqual([T0]);
    expect(s.model.values["running"]).toEqual([1]);
    expect(s.model.values["waiting"]).toEqual([2]);
    expect(s.model.values["kvCachePercent"]).toEqual([50]);
    expect(s.model.values["decodeTokensPerSecond"]).toEqual([12.5]);
  });

  it("records a point of gaps when the model is unreachable", () => {
    const store = new ClusterHistoryStore(10);
    store.pushModel(T0, model({ status: "unreachable", running: 5, waiting: 6, kvCachePercent: 7, decodeTokensPerSecond: 8 }));
    const s = store.snapshot();
    expect(s.model.at).toEqual([T0]);
    for (const key of MODEL_KEYS) {
      expect(s.model.values[key]).toEqual([null]);
    }
  });

  it("keeps one series per node name, in first-seen order", () => {
    const store = new ClusterHistoryStore(10);
    store.pushNodes(T0, [node("node-b"), node("node-a"), node("node-b")]);
    const s = store.snapshot();
    expect(s.windowSeconds).toBe(10);
    expect(s.nodes.map((n) => n.name)).toEqual(["node-b", "node-a"]);
  });

  it("gives an unreachable or host-key-refused node a gap point while the other node gets its values", () => {
    for (const status of ["unreachable", "host key refused"] as const) {
      const store = new ClusterHistoryStore(10);
      store.pushNodes(T0, [
        node("node-a", { status }),
        node("node-b", { status: "ok", cpuPercent: 11, cpuTempC: 41, gpuPercent: 22, gpuTempC: 51 }),
      ]);
      const s = store.snapshot();
      const a = s.nodes.find((n) => n.name === "node-a")!;
      const b = s.nodes.find((n) => n.name === "node-b")!;
      expect(a.series.at).toEqual([T0]);
      for (const key of NODE_KEYS) {
        expect(a.series.values[key]).toEqual([null]);
      }
      expect(b.series.at).toEqual([T0]);
      expect(b.series.values["cpuPercent"]).toEqual([11]);
      expect(b.series.values["cpuTempC"]).toEqual([41]);
      expect(b.series.values["gpuPercent"]).toEqual([22]);
      expect(b.series.values["gpuTempC"]).toEqual([51]);
    }
  });
});
