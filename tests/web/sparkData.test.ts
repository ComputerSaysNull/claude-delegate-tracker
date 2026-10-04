import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendPoint,
  pointFromModel,
  pointFromNode,
  toUplotData,
} from "../../src/web/sparkData.ts";
import type { Series } from "../../src/server/history.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

function base(): Series {
  return {
    at: [1000, 2000, 3000],
    values: { running: [1, 2, 3], waiting: [4, 5, 6] },
  };
}

describe("appendPoint", () => {
  it("adds a point, returning a new object and leaving the original untouched", () => {
    const s = base();
    const out = appendPoint(s, 4000, { running: 7, waiting: 8 }, 10000);
    expect(out).not.toBe(s);
    expect(out.at).toEqual([1000, 2000, 3000, 4000]);
    expect(out.values.running).toEqual([1, 2, 3, 7]);
    expect(out.values.waiting).toEqual([4, 5, 6, 8]);
    expect(s.at).toEqual([1000, 2000, 3000]);
    expect(s.values.running).toEqual([1, 2, 3]);
  });

  it("ignores a stale point not newer than the last at", () => {
    const s = base();
    expect(appendPoint(s, 3000, { running: 99, waiting: 99 }, 10000)).toBe(s);
    expect(appendPoint(s, 1500, { running: 99, waiting: 99 }, 10000)).toBe(s);
    expect(s.at).toEqual([1000, 2000, 3000]);
  });

  it("trims the window from at and every values array", () => {
    const s = base();
    // cutoff = 3500 - 1500 = 2000; 1000 is older and dropped.
    const out = appendPoint(s, 3500, { running: 9, waiting: 9 }, 1500);
    expect(out.at).toEqual([2000, 3000, 3500]);
    expect(out.values.running).toEqual([2, 3, 9]);
    expect(out.values.waiting).toEqual([5, 6, 9]);
  });

  it("records a missing key as null, never 0", () => {
    const s = base();
    const out = appendPoint(s, 4000, { running: 7 }, 10000);
    expect(out.values.running).toEqual([1, 2, 3, 7]);
    expect(out.values.waiting).toEqual([4, 5, 6, null]);
  });
});

describe("pointFromModel", () => {
  afterEach(() => vi.useRealTimers());

  const ok = (overrides: Partial<ModelFigures> = {}): ModelFigures => ({
    status: "ok",
    running: null,
    waiting: null,
    kvCachePercent: null,
    decodeTokensPerSecond: null,
    decodeWindowSeconds: null,
    prefixHitPercent: null,
    preemptions: null,
    readAt: "2024-01-15T13:45:00.000Z",
    ...overrides,
  });

  it("records the four figures at the read time when ok", () => {
    const p = pointFromModel(ok({ running: 2, waiting: 1, kvCachePercent: 7.5, decodeTokensPerSecond: 80 }));
    expect(p).not.toBeNull();
    expect(p!.atMs).toBe(Date.parse("2024-01-15T13:45:00.000Z"));
    expect(p!.values).toEqual({
      running: 2,
      waiting: 1,
      kvCachePercent: 7.5,
      decodeTokensPerSecond: 80,
    });
  });

  it("returns null for an ok model with no read time", () => {
    expect(pointFromModel(ok({ readAt: null }))).toBeNull();
  });

  it("places a gap at now when not ok", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
    const p = pointFromModel(ok({ status: "unreachable", readAt: "2024-01-15T13:45:00.000Z" }));
    expect(p).not.toBeNull();
    expect(p!.atMs).toBe(Date.parse("2024-02-01T00:00:00.000Z"));
    expect(p!.values).toEqual({
      running: null,
      waiting: null,
      kvCachePercent: null,
      decodeTokensPerSecond: null,
    });
  });
});

describe("pointFromNode", () => {
  afterEach(() => vi.useRealTimers());

  const ok = (overrides: Partial<NodeFigures> = {}): NodeFigures => ({
    name: "node-1",
    status: "ok",
    cpuPercent: null,
    cpuWindowSeconds: null,
    cpuTempC: null,
    gpuPercent: null,
    gpuTempC: null,
    readAt: "2024-01-15T13:45:00.000Z",
    ...overrides,
  });

  it("records the four figures at the read time when ok", () => {
    const p = pointFromNode(ok({ cpuPercent: 61.5, gpuPercent: 7, cpuTempC: 51.5, gpuTempC: 57 }));
    expect(p).not.toBeNull();
    expect(p!.atMs).toBe(Date.parse("2024-01-15T13:45:00.000Z"));
    expect(p!.values).toEqual({ cpuPercent: 61.5, gpuPercent: 7, cpuTempC: 51.5, gpuTempC: 57 });
  });

  it("returns null for an ok node with no read time", () => {
    expect(pointFromNode(ok({ readAt: null }))).toBeNull();
  });

  it("places a gap at now when not ok", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
    const p = pointFromNode(ok({ status: "unreachable", readAt: "2024-01-15T13:45:00.000Z" }));
    expect(p).not.toBeNull();
    expect(p!.atMs).toBe(Date.parse("2024-02-01T00:00:00.000Z"));
    expect(p!.values).toEqual({ cpuPercent: null, gpuPercent: null, cpuTempC: null, gpuTempC: null });
  });
});

describe("toUplotData", () => {
  it("converts ms to seconds and keeps nulls", () => {
    const s: Series = {
      at: [1000, 2000, 3000],
      values: { running: [1, null, 3] },
    };
    expect(toUplotData(s, "running")).toEqual([[1, 2, 3], [1, null, 3]]);
  });

  it("returns an empty y array for an unknown key", () => {
    const s: Series = { at: [1000], values: { running: [1] } };
    expect(toUplotData(s, "missing")).toEqual([[1], []]);
  });
});
