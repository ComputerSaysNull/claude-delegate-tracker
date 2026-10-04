// A figure says whether it is fine by its colour: load and heat against their thresholds.
import { describe, expect, it } from "vitest";
import { level, sinceMs } from "../../src/web/load.ts";

describe("level", () => {
  it("is ok under the warning threshold, warn from it, hot from the hot one", () => {
    expect([49, 50, 79, 80].map((v) => level(v, 50, 80))).toEqual(["ok", "warn", "warn", "hot"]);
    expect([69, 70, 84, 85].map((v) => level(v, 70, 85))).toEqual(["ok", "warn", "warn", "hot"]);
  });

  it("has no level for a missing figure", () => {
    expect(level(null, 50, 80)).toBeNull();
  });
});

describe("the chart range", () => {
  it("keeps only the points of the last N seconds", () => {
    const series = { at: [1_000, 400_000, 900_000, 1_000_000], values: { cpuPercent: [1, 2, 3, 4] } };
    expect(sinceMs(series, 1_000_000 - 600_000)).toEqual({ at: [400_000, 900_000, 1_000_000], values: { cpuPercent: [2, 3, 4] } });
  });
});
