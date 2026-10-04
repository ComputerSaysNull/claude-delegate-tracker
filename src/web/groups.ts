// The list grouped by when each delegation started, in the viewer's own days: Today,
// Yesterday, the other days of this week (which starts on Monday), Last week, then months.
// Pure: no React.
import type { ListRow } from "../server/streams.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayMonth = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;

export interface DateGroup {
  key: string;
  label: string;
}

export function dateGroup(iso: string | null, now: Date): DateGroup {
  if (iso === null) return { key: "none", label: "No start time" };
  const day = midnight(new Date(iso));
  const today = midnight(now);
  const yesterday = addDays(today, -1);
  const thisMonday = addDays(today, -((today.getDay() + 6) % 7));
  const lastMonday = addDays(thisMonday, -7);
  const t = day.getTime();
  if (t >= today.getTime()) return { key: "today", label: `Today · ${dayMonth(day)}` };
  if (t === yesterday.getTime()) return { key: "yesterday", label: `Yesterday · ${dayMonth(day)}` };
  if (t >= thisMonday.getTime()) return { key: `day-${t}`, label: `${DAYS[day.getDay()]} · ${dayMonth(day)}` };
  if (t >= lastMonday.getTime()) return { key: "last-week", label: "Last week" };
  const year = day.getFullYear() === today.getFullYear() ? "" : ` ${day.getFullYear()}`;
  return { key: `month-${day.getFullYear()}-${day.getMonth()}`, label: `${MONTHS[day.getMonth()]}${year}` };
}

export interface RowGroup extends DateGroup {
  rows: ListRow[];
}

// The rows keep their order; a group appears where its first row is.
export function groupRows(rows: ListRow[], now: Date): RowGroup[] {
  const groups: RowGroup[] = [];
  const byKey = new Map<string, RowGroup>();
  for (const row of rows) {
    const g = dateGroup(row.startedAt, now);
    let group = byKey.get(g.key);
    if (group === undefined) {
      group = { ...g, rows: [] };
      byKey.set(g.key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

// What is running (asking its caller included) and queued now, whenever it started, and what
// failed, timed out or was stopped today.
export function todayCounts(
  rows: ListRow[],
  now: Date,
): { running: number; queued: number; failed: number; timedOut: number; stopped: number } {
  const startOfToday = midnight(now).getTime();
  const today = (r: ListRow) => r.startedAt !== null && Date.parse(r.startedAt) >= startOfToday;
  return {
    running: rows.filter((r) => r.state === "live" || r.state === "asking").length, // asking is still running
    queued: rows.filter((r) => r.state === "queued").length,
    failed: rows.filter((r) => r.state === "failed" && today(r)).length,
    // Counted apart from failed: a limit was hit, or the caller stopped it.
    timedOut: rows.filter((r) => r.state === "timed out" && today(r)).length,
    stopped: rows.filter((r) => r.state === "stopped" && today(r)).length,
  };
}
