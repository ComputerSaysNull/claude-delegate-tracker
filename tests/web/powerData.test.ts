// The GPU power figures on the History tab, computed from the per-UTC-hour power buckets and
// the run records. Pure: like busyData.test.ts, each bucket's `hour` is built from a local Date
// at a whole hour, so `new Date(hour)` maps it back to the same local day and hour and the
// assertions hold in any timezone.
import { describe, expect, it } from "vitest";
import { powerPerDay } from "../../src/web/powerData.ts";
import type { PowerBucket } from "../../src/server/power.ts";
import type { RunRecord } from "../../src/server/runs.ts";
import type { Range } from "../../src/web/historyData.ts";

// A bucket at a local wall-clock time; the local day/hour round-trip through `new Date(hour)`.
function bucketAt(local: Date, overrides: Partial<PowerBucket> = {}): PowerBucket {
  return {
    hour: local.getTime(),
    node: "alpha",
    wh: 0,
    seconds: 0,
    maxW: null,
    ...overrides,
  };
}

// A well-formed run record, as runs.ts builds one.
function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    name: "x.jsonl",
    size: 1,
    repoFromPaths: false,
    startedAt: null,
    outcome: "ok",
    reason: null,
    repo: "web-shop",
    model: "claude-code",
    elapsedSeconds: null,
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    ...over,
  };
}

describe("powerPerDay", () => {
  // 4 Oct 2026 is a Sunday, so the last 7 local days run 28 Sep .. 4 Oct.
  const now = new Date(2026, 9, 4, 12);
  const days: Range = 7;

  it("returns exactly `days` entries, oldest first, labelled day + short month", () => {
    const result = powerPerDay([], [], days, now);
    expect(result).toHaveLength(7);
    expect(result[0].label).toBe("28 Sep");
    expect(result[6].label).toBe("4 Oct");
    expect(result[0].wh).toBeNull();
    expect(result[0].whPerKiloToken).toBeNull();
    expect(result[0].byNode).toEqual([]);
  });

  it("sums each node's hour buckets into the day's Wh, whole-watt average, and peak", () => {
    const buckets = [
      bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 120.5, seconds: 3600, maxW: 200 }),
      bucketAt(new Date(2026, 8, 28, 11), { node: "alpha", wh: 80.5, seconds: 1800, maxW: 250 }),
      bucketAt(new Date(2026, 8, 28, 10), { node: "beta", wh: 50, seconds: 1000, maxW: 100 }),
      bucketAt(new Date(2026, 8, 30, 10), { node: "gamma", wh: 30, seconds: 1000, maxW: 90 }),
    ];
    const result = powerPerDay(buckets, [], days, now);
    const first = result[0]; // 28 Sep
    expect(first.wh).toBe(251);
    expect(first.byNode).toEqual([
      { node: "alpha", wh: 201, averageW: 134, maxW: 250 },
      { node: "beta", wh: 50, averageW: 180, maxW: 100 },
      { node: "gamma", wh: null, averageW: null, maxW: null },
    ]);
    // A day with no bucket still lists every node, with null figures — never 0.
    expect(result[1].wh).toBeNull(); // 29 Sep
    expect(result[1].byNode).toEqual([
      { node: "alpha", wh: null, averageW: null, maxW: null },
      { node: "beta", wh: null, averageW: null, maxW: null },
      { node: "gamma", wh: null, averageW: null, maxW: null },
    ]);
    expect(result[2].wh).toBe(30); // 30 Sep
    expect(result[2].byNode).toEqual([
      { node: "alpha", wh: null, averageW: null, maxW: null },
      { node: "beta", wh: null, averageW: null, maxW: null },
      { node: "gamma", wh: 30, averageW: 108, maxW: 90 },
    ]);
  });

  it("lists the nodes sorted by name", () => {
    const buckets = [
      bucketAt(new Date(2026, 8, 28, 10), { node: "zeta", wh: 10, seconds: 100, maxW: 10 }),
      bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 10, seconds: 100, maxW: 10 }),
      bucketAt(new Date(2026, 8, 28, 10), { node: "mu", wh: 10, seconds: 100, maxW: 10 }),
    ];
    const result = powerPerDay(buckets, [], days, now);
    expect(result[0].byNode.map((n) => n.node)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("rounds a node's Wh to one decimal", () => {
    const buckets = [bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 10.26, seconds: 100, maxW: null })];
    const result = powerPerDay(buckets, [], days, now);
    expect(result[0].byNode[0].wh).toBe(10.3);
    expect(result[0].byNode[0].maxW).toBeNull();
  });

  it("computes Wh per 1k output tokens, two decimals", () => {
    const buckets = [bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 251, seconds: 3600, maxW: 200 })];
    const runs = [rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), outputTokens: 3000 })];
    const result = powerPerDay(buckets, runs, days, now);
    expect(result[0].wh).toBe(251);
    expect(result[0].whPerKiloToken).toBe(83.67); // 251 ÷ (3000 ÷ 1000) = 83.67
  });

  it("leaves whPerKiloToken null when the day has no output tokens", () => {
    const buckets = [bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 251, seconds: 3600, maxW: 200 })];
    const runs = [
      rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), outputTokens: null }),
      rec({ startedAt: new Date(2026, 8, 28, 11).getTime(), outputTokens: null }),
    ];
    const result = powerPerDay(buckets, runs, days, now);
    expect(result[0].whPerKiloToken).toBeNull();
  });

  it("leaves whPerKiloToken null when the day has no power figure", () => {
    const runs = [rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), outputTokens: 4000 })];
    const result = powerPerDay([], runs, days, now);
    expect(result[0].wh).toBeNull();
    expect(result[0].whPerKiloToken).toBeNull();
  });

  it("ignores buckets outside the range", () => {
    const buckets = [
      bucketAt(new Date(2026, 8, 27, 10), { node: "alpha", wh: 100, seconds: 3600, maxW: 50 }), // 27 Sep, before
      bucketAt(new Date(2026, 9, 5, 10), { node: "alpha", wh: 100, seconds: 3600, maxW: 50 }), // 5 Oct, after
    ];
    const result = powerPerDay(buckets, [], days, now);
    expect(result).toHaveLength(7);
    expect(result[0].wh).toBeNull(); // 28 Sep has no bucket
    expect(result[0].byNode).toEqual([]);
    expect(result[6].wh).toBeNull(); // 4 Oct has no bucket
  });

  it("ignores runs started outside the range", () => {
    const buckets = [bucketAt(new Date(2026, 8, 28, 10), { node: "alpha", wh: 251, seconds: 3600, maxW: 200 })];
    const runs = [
      rec({ startedAt: new Date(2026, 8, 27, 10).getTime(), outputTokens: 4000 }), // 27 Sep, before
      rec({ startedAt: new Date(2026, 9, 5, 10).getTime(), outputTokens: 4000 }), // 5 Oct, after
    ];
    const result = powerPerDay(buckets, runs, days, now);
    expect(result[0].wh).toBe(251);
    expect(result[0].whPerKiloToken).toBeNull();
  });
});
