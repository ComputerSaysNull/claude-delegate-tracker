// The History tab's "busy" figures, computed from the run records and the model server's hour
// buckets: pure, no React.
import type { RunRecord } from "../server/runs.ts";
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

// The busy figures over the range [local midnight of the first day, now].
export interface Load {
  busyPercent: number | null;  // busy / range, rounded; null only for a zero-length range
  busyHours: number;           // hours of busy time, one decimal
  idleHours: number;           // hours the range is not busy, one decimal
  peak: number;                // the most runs at once
  averageWhileBusy: number | null; // summed run-seconds / busy seconds, one decimal; null with no busy time
}

// Local midnight of the day `d` falls on.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// A run's interval clipped to the range, or null when it does not reach it.
function clippedRun(r: RunRecord, rangeStart: number, rangeEnd: number): { start: number; end: number } | null {
  if (r.startedAt === null || r.elapsedSeconds === null) return null;
  const start = Math.max(r.startedAt, rangeStart);
  const end = Math.min(r.startedAt + r.elapsedSeconds * 1000, rangeEnd);
  return end > start ? { start, end } : null;
}

export function load(runs: RunRecord[], days: Range, now: Date): Load {
  const rangeStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))).getTime();
  const rangeEnd = now.getTime();
  const rangeSeconds = (rangeEnd - rangeStart) / 1000;
  // Sweep the runs' start/end events: the union's seconds where at least one ran, and the
  // most runs at once. An end sorts before a start at the same instant, so a hand-off is not a peak.
  const events: { t: number; delta: number }[] = [];
  let sumRunSeconds = 0;
  for (const r of runs) {
    const c = clippedRun(r, rangeStart, rangeEnd);
    if (c === null) continue;
    events.push({ t: c.start, delta: 1 });
    events.push({ t: c.end, delta: -1 });
    sumRunSeconds += (c.end - c.start) / 1000;
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let count = 0;
  let peak = 0;
  let busyMs = 0;
  let lastT: number | null = null;
  for (const ev of events) {
    if (lastT !== null && count > 0) busyMs += ev.t - lastT;
    count += ev.delta;
    if (count > peak) peak = count;
    lastT = ev.t;
  }
  const busySeconds = busyMs / 1000;
  return {
    busyPercent: rangeSeconds === 0 ? null : Math.round((busySeconds / rangeSeconds) * 100),
    busyHours: Math.round((busySeconds / 3600) * 10) / 10,
    idleHours: Math.round(((rangeSeconds - busySeconds) / 3600) * 10) / 10,
    peak,
    averageWhileBusy: busySeconds === 0 ? null : Math.round((sumRunSeconds / busySeconds) * 10) / 10,
  };
}

// 7 rows Mon..Sun × 24 local hours: the average number of runs at once in that hour of the week.
export function weekLoad(runs: RunRecord[], days: Range, now: Date): (number | null)[][] {
  const rangeStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))).getTime();
  const rangeEnd = now.getTime();
  // The run-seconds falling in each weekday-hour cell of the range.
  const seconds = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of runs) {
    const c = clippedRun(r, rangeStart, rangeEnd);
    if (c === null) continue;
    let cur = c.start;
    while (cur < c.end) {
      const d = new Date(cur);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const segEnd = Math.min(c.end, nextHour);
      seconds[(d.getDay() + 6) % 7][d.getHours()] += (segEnd - cur) / 1000;
      cur = segEnd;
    }
  }
  // How many such weekday-hour slots the range holds, up to now (only those already begun).
  const slots = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const first = new Date(rangeStart);
  for (let day = 0; day < days; day++) {
    const dayStart = new Date(first.getFullYear(), first.getMonth(), first.getDate() + day);
    const weekday = (dayStart.getDay() + 6) % 7;
    for (let h = 0; h < 24; h++) {
      const slotStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h).getTime();
      if (slotStart < rangeEnd) slots[weekday][h]++;
    }
  }
  const grid: (number | null)[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: (number | null)[] = [];
    for (let h = 0; h < 24; h++) {
      row.push(slots[d][h] === 0 ? null : Math.round((seconds[d][h] / (slots[d][h] * 3600)) * 10) / 10);
    }
    grid.push(row);
  }
  return grid;
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
