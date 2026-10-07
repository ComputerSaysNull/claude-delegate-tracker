// The History tab's "busy" figures, computed from the model server's hour buckets: pure, no React.
import type { HourBucket } from "../server/busy.ts";
import type { Range } from "./historyData.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The buckets whose hour starts on one of the last `days` local days, today included.
export function busyIn(buckets: HourBucket[], days: Range, now: Date): HourBucket[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return buckets.filter((b) => {
    const d = new Date(b.hour);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return day >= start && day <= end;
  });
}

export function busyTotals(buckets: HourBucket[]): { busyPercent: number | null; busyHours: number; idleHours: number } {
  let seconds = 0;
  let busy = 0;
  for (const b of buckets) {
    seconds += b.seconds;
    busy += b.busySeconds;
  }
  const one = (s: number) => Math.round((s / 3600) * 10) / 10;
  return {
    busyPercent: seconds === 0 ? null : Math.round((busy / seconds) * 100),
    busyHours: one(busy),
    idleHours: one(seconds - busy),
  };
}

// 7 rows Mon..Sun x 24 local hours: the busy share in each cell, or null where no seconds.
export function weekHours(buckets: HourBucket[]): (number | null)[][] {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ seconds: 0, busy: 0 })));
  for (const b of buckets) {
    const d = new Date(b.hour);
    const cell = cells[(d.getDay() + 6) % 7][d.getHours()];
    cell.seconds += b.seconds;
    cell.busy += b.busySeconds;
  }
  return cells.map((row) => row.map((c) => (c.seconds === 0 ? null : c.busy / c.seconds)));
}

export function busiest(grid: (number | null)[][]): { day: number; hour: number } | null {
  let best: { day: number; hour: number } | null = null;
  let bestShare = 0;
  for (let d = 0; d < grid.length; d++) {
    for (let h = 0; h < grid[d].length; h++) {
      const v = grid[d][h];
      if (v !== null && v > bestShare) {
        bestShare = v;
        best = { day: d, hour: h };
      }
    }
  }
  return best;
}

// Exactly `days` entries, oldest first: each day's peak (max kvMax) and time-weighted average.
export function kvPerDay(buckets: HourBucket[], days: Range, now: Date): { label: string; peak: number | null; average: number | null }[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const byDay = new Map<number, number>();
  const result: { label: string; peak: number | null; average: number | null }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    byDay.set(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), i);
    result.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, peak: null, average: null });
  }
  const acc = new Map<number, { kvSum: number; kvSeconds: number; kvMax: number | null }>();
  for (const b of buckets) {
    const d = new Date(b.hour);
    const index = byDay.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    if (index === undefined) continue;
    let a = acc.get(index);
    if (!a) {
      a = { kvSum: 0, kvSeconds: 0, kvMax: null };
      acc.set(index, a);
    }
    a.kvSum += b.kvSum;
    a.kvSeconds += b.kvSeconds;
    if (b.kvMax !== null && (a.kvMax === null || b.kvMax > a.kvMax)) a.kvMax = b.kvMax;
  }
  for (const [index, a] of acc) {
    result[index].peak = a.kvMax;
    result[index].average = a.kvSeconds === 0 ? null : Math.round((a.kvSum / a.kvSeconds) * 10) / 10;
  }
  return result;
}
