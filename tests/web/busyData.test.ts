// The busy figures on the History tab, computed from the run records and the model server's hour
// buckets. Pure: the tests build each bucket's `hour` from a local Date at a whole hour, so
// `new Date(hour)` maps it back to the same local day and hour and the assertions hold in any
// timezone.
import { describe, expect, it } from "vitest";
import { busyIn, busiest, kvPerDay, load, weekLoad } from "../../src/web/busyData.ts";
import type { HourBucket } from "../../src/server/busy.ts";
import type { RunRecord } from "../../src/server/runs.ts";
import type { Range } from "../../src/web/historyData.ts";

// A bucket at a local wall-clock time: `hour` is the ms of that local instant (a UTC-hour start
// in a whole-hour zone), and the local day/hour round-trip through `new Date(hour)` exactly.
function bucketAt(local: Date, overrides: Partial<HourBucket> = {}): HourBucket {
  return {
    hour: local.getTime(),
    kvSum: 0,
    kvSeconds: 0,
    kvMax: null,
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

describe("busyIn", () => {
  // 4 Oct 2026 is a Sunday, so the last 7 local days run 28 Sep .. 4 Oct and a 30-day range runs
  // 5 Sep .. 4 Oct.
  const now = new Date(2026, 9, 4, 12);

  it("keeps only the buckets on the last `days` local days, today included", () => {
    const before = bucketAt(new Date(2026, 8, 27, 12)); // 27 Sep, the day before the range
    const first = bucketAt(new Date(2026, 8, 28, 0)); // 28 Sep, the first day of a 7-day range
    const today = bucketAt(new Date(2026, 9, 4, 9)); // 4 Oct
    const after = bucketAt(new Date(2026, 9, 5, 0)); // 5 Oct, tomorrow
    expect(busyIn([before, first, today, after], 7, now).map((b) => b.hour)).toEqual([first.hour, today.hour]);
  });

  it("moves the oldest kept day with a 30-day range", () => {
    const before = bucketAt(new Date(2026, 8, 4, 12)); // 4 Sep, the day before a 30-day range
    const first = bucketAt(new Date(2026, 8, 5, 0)); // 5 Sep, the first day
    const today = bucketAt(new Date(2026, 9, 4, 0)); // 4 Oct
    expect(busyIn([before, first, today], 30, now).map((b) => b.hour)).toEqual([first.hour, today.hour]);
  });
});

describe("load", () => {
  // 4 Oct 2026 is a Sunday; a 7-day range runs 28 Sep (Mon) .. 4 Oct (Sun), which is 6 full days
  // plus the 12 h up to now = 156 h.
  const now = new Date(2026, 9, 4, 12);
  const days: Range = 7;

  it("reports the union busy share, the peak, and the average while busy", () => {
    const runs = [
      rec({ startedAt: new Date(2026, 9, 4, 10).getTime(), elapsedSeconds: 1800 }), // 10:00-10:30
      rec({ startedAt: new Date(2026, 9, 4, 10, 15).getTime(), elapsedSeconds: 2700 }), // 10:15-11:00
    ];
    expect(load(runs, days, now)).toEqual({
      busyPercent: 1, // 1 h of 156 h
      busyHours: 1,
      idleHours: 155,
      peak: 2,
      averageWhileBusy: 1.3, // (30 + 45 min) / 60 min
    });
  });

  it("clips a run that crosses the range start", () => {
    // A run that starts 30 min before the range start and runs 1.5 h is clipped to the 1 h in range.
    const runs = [rec({ startedAt: new Date(2026, 8, 27, 23, 30).getTime(), elapsedSeconds: 5400 })];
    expect(load(runs, days, now)).toEqual({
      busyPercent: 1,
      busyHours: 1,
      idleHours: 155,
      peak: 1,
      averageWhileBusy: 1,
    });
  });

  it("leaves out runs without startedAt or elapsedSeconds", () => {
    const runs = [
      rec({ startedAt: null, elapsedSeconds: 3600 }),
      rec({ startedAt: new Date(2026, 9, 4, 10).getTime(), elapsedSeconds: null }),
    ];
    expect(load(runs, days, now)).toEqual({
      busyPercent: 0,
      busyHours: 0,
      idleHours: 156,
      peak: 0,
      averageWhileBusy: null,
    });
  });

  it("reports 0% busy with no runs but a range that has time", () => {
    expect(load([], days, now)).toEqual({
      busyPercent: 0,
      busyHours: 0,
      idleHours: 156,
      peak: 0,
      averageWhileBusy: null,
    });
  });
});

describe("weekLoad", () => {
  // 4 Oct 2026 is a Sunday; a 7-day range runs 28 Sep (Mon) .. 4 Oct (Sun), one of each weekday.
  const now = new Date(2026, 9, 4, 12);
  const days: Range = 7;

  it("counts a run on Monday 10:00 as one run on average", () => {
    const runs = [rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), elapsedSeconds: 3600 })];
    const grid = weekLoad(runs, days, now);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid[0][10]).toBeCloseTo(1); // one Monday 10:00-11:00 in the range
  });

  it("averages two runs overlapping in the same hour", () => {
    const runs = [
      rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), elapsedSeconds: 3600 }),
      rec({ startedAt: new Date(2026, 8, 28, 10).getTime(), elapsedSeconds: 3600 }),
    ];
    const grid = weekLoad(runs, days, now);
    expect(grid[0][10]).toBeCloseTo(2);
  });

  it("does not count an hour not reached yet today in the denominator", () => {
    const runs = [
      rec({ startedAt: new Date(2026, 9, 4, 10).getTime(), elapsedSeconds: 3600 }), // Sunday 10:00, reached
      rec({ startedAt: new Date(2026, 9, 4, 13).getTime(), elapsedSeconds: 3600 }), // Sunday 13:00, not reached
    ];
    const grid = weekLoad(runs, days, now);
    expect(grid[6][10]).toBeCloseTo(1); // today's Sunday 10:00 is counted
    expect(grid[6][13]).toBeNull(); // Sunday 13:00 is after now, so the range holds none
  });

  it("leaves a cell null where the range holds no such hour", () => {
    const grid = weekLoad([], days, now);
    expect(grid[6][23]).toBeNull(); // Sunday 23:00 is after now, not reached
    expect(grid[0][10]).toBe(0); // Monday 10:00 exists but has no runs
  });
});

describe("busiest", () => {
  it("picks the highest share, not the first one above zero", () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null as number | null));
    grid[0][3] = 0.2;
    grid[4][15] = 0.9;
    grid[6][1] = 0.5;
    expect(busiest(grid)).toEqual({ day: 4, hour: 15 });
  });

  it("returns the day and hour of the highest share", () => {
    const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
    grid[1][10] = 0.5; // Tue 10:00
    grid[0][9] = 0.8; // Mon 9:00
    expect(busiest(grid)).toEqual({ day: 0, hour: 9 });
  });

  it("is null when no cell is above zero", () => {
    const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
    grid[2][3] = 0;
    expect(busiest(grid)).toBeNull();
  });

  it("is null for an all-null grid", () => {
    const grid: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
    expect(busiest(grid)).toBeNull();
  });
});

describe("kvPerDay", () => {
  it("takes the day's highest peak, whichever hour came first", () => {
    const now = new Date(2026, 9, 4, 20);
    const day = kvPerDay([
      bucketAt(new Date(2026, 9, 4, 9), { kvMax: 70, kvSum: 3600, kvSeconds: 3600 }),
      bucketAt(new Date(2026, 9, 4, 10), { kvMax: 30, kvSum: 3600, kvSeconds: 3600 }),
    ], 7, now).at(-1)!;
    expect(day.peak).toBe(70);
  });

  const now = new Date(2026, 9, 4, 12);

  it("returns exactly `days` entries, oldest first, labelled day + short month", () => {
    const result = kvPerDay([], 7, now);
    expect(result).toHaveLength(7);
    expect(result[0].label).toBe("28 Sep");
    expect(result[6].label).toBe("4 Oct");
    expect(result[0].peak).toBeNull();
    expect(result[0].average).toBeNull();
  });

  it("uses the day's peak and time-weighted average for the figure", () => {
    const result = kvPerDay(
      [
        bucketAt(new Date(2026, 8, 28, 9), { kvSum: 2000, kvSeconds: 1000, kvMax: 50 }),
        bucketAt(new Date(2026, 8, 28, 10), { kvSum: 1000, kvSeconds: 1000, kvMax: 80 }),
      ],
      7,
      now,
    );
    expect(result[0].peak).toBe(80);
    expect(result[0].average).toBe(1.5);
  });

  it("rounds the average to one decimal", () => {
    const result = kvPerDay(
      [
        bucketAt(new Date(2026, 8, 28, 9), { kvSum: 1000, kvSeconds: 1000, kvMax: 10 }),
        bucketAt(new Date(2026, 8, 28, 10), { kvSum: 500, kvSeconds: 1000, kvMax: 20 }),
      ],
      7,
      now,
    );
    expect(result[0].peak).toBe(20);
    expect(result[0].average).toBe(0.8); // 1500 / 2000 = 0.75 -> 0.8
  });

  it("leaves a day null when no bucket there has a KV figure", () => {
    const result = kvPerDay([bucketAt(new Date(2026, 8, 28, 9), { kvSum: 0, kvSeconds: 0, kvMax: null })], 7, now);
    expect(result[0].peak).toBeNull();
    expect(result[0].average).toBeNull();
  });
});
