// The busy figures on the History tab, computed from the model server's hour buckets. Pure: the
// tests build each bucket's `hour` from a local Date at a whole hour, so `new Date(hour)` maps it
// back to the same local day and hour and the assertions hold in any timezone.
import { describe, expect, it } from "vitest";
import { busyIn, busyTotals, weekHours, busiest, kvPerDay } from "../../src/web/busyData.ts";
import type { HourBucket } from "../../src/server/busy.ts";

// A bucket at a local wall-clock time: `hour` is the ms of that local instant (a UTC-hour start
// in a whole-hour zone), and the local day/hour round-trip through `new Date(hour)` exactly.
function bucketAt(local: Date, overrides: Partial<HourBucket> = {}): HourBucket {
  return {
    hour: local.getTime(),
    seconds: 3600,
    busySeconds: 1800,
    kvSum: 0,
    kvSeconds: 0,
    kvMax: null,
    ...overrides,
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

describe("busyTotals", () => {
  it("is neutral with no buckets", () => {
    expect(busyTotals([])).toEqual({ busyPercent: null, busyHours: 0, idleHours: 0 });
  });

  it("reports the busy share rounded, and the hours to one decimal", () => {
    const result = busyTotals([
      bucketAt(new Date(2026, 9, 4, 9), { seconds: 3600, busySeconds: 1800 }),
      bucketAt(new Date(2026, 9, 4, 10), { seconds: 3600, busySeconds: 3600 }),
    ]);
    expect(result.busyPercent).toBe(75);
    expect(result.busyHours).toBe(1.5);
    expect(result.idleHours).toBe(0.5);
  });

  it("rounds the busy percent", () => {
    const result = busyTotals([bucketAt(new Date(2026, 9, 4, 9), { seconds: 300, busySeconds: 100 })]);
    expect(result.busyPercent).toBe(33);
    expect(result.busyHours).toBe(0);
    expect(result.idleHours).toBe(0.1);
  });

  it("gives a null percent when there are no seconds", () => {
    const result = busyTotals([bucketAt(new Date(2026, 9, 4, 9), { seconds: 0, busySeconds: 0 })]);
    expect(result.busyPercent).toBeNull();
    expect(result.busyHours).toBe(0);
    expect(result.idleHours).toBe(0);
  });
});

describe("weekHours", () => {
  it("returns 7 rows Mon..Sun of 24 local hours", () => {
    const grid = weekHours([]);
    expect(grid).toHaveLength(7);
    for (const row of grid) expect(row).toHaveLength(24);
  });

  it("maps a bucket to its local weekday (Mon = row 0) and hour", () => {
    // 5 Oct 2026 is a Monday.
    const grid = weekHours([bucketAt(new Date(2026, 9, 5, 10), { seconds: 3600, busySeconds: 2700 })]);
    expect(grid[0][10]).toBeCloseTo(0.75);
    expect(grid[1][10]).toBeNull(); // Tuesday 10:00 has no bucket
    expect(grid[0][11]).toBeNull();
  });

  it("averages the buckets that fall in the same cell", () => {
    const grid = weekHours([
      bucketAt(new Date(2026, 9, 5, 9), { seconds: 3600, busySeconds: 1800 }),
      bucketAt(new Date(2026, 9, 5, 9), { seconds: 3600, busySeconds: 3600 }),
    ]);
    expect(grid[0][9]).toBeCloseTo(0.75);
  });

  it("leaves a cell null when no bucket falls there", () => {
    const grid = weekHours([bucketAt(new Date(2026, 9, 5, 10))]);
    expect(grid[6][23]).toBeNull(); // Sunday 23:00
  });

  it("puts Sunday in the last row", () => {
    // 11 Oct 2026 is a Sunday.
    const grid = weekHours([bucketAt(new Date(2026, 9, 11, 15), { seconds: 100, busySeconds: 25 })]);
    expect(grid[6][15]).toBeCloseTo(0.25);
    expect(grid[0][15]).toBeNull();
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
