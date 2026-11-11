// The History tab's figures, computed from the run records the backend keeps on disk. Pure: no React, no fetch.
import type { Outcome, RunRecord, Slot } from "../server/runs.ts";

export type Range = 7 | 30 | 90 | "all";

// One column of a chart: a half-open window of one local day (or, on a long "all" span, seven).
export interface Bucket {
  label: string;
  startMs: number;
  endMs: number;
}

// The range the History tab shows: from the first local midnight to now, one Bucket per column.
// A long "all" range uses 7-day buckets, flagged by `weekly`.
export interface Span {
  startMs: number;
  endMs: number;
  buckets: Bucket[];
  weekly: boolean;
}

// A range longer than this shows one column per week rather than per day.
export const DAILY_UP_TO = 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Local midnight of the day `d` falls on.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The moment a span stops counting: the end of its last bucket, or its own end when it has none.
// The runs in range and the token window both stop here.
function windowEnd(span: Span): number {
  return span.buckets.length === 0 ? span.endMs : span.buckets[span.buckets.length - 1].endMs;
}

export function inRange(runs: RunRecord[], span: Span): RunRecord[] {
  const endMs = windowEnd(span);
  return runs.filter((r) => r.startedAt !== null && r.startedAt >= span.startMs && r.startedAt < endMs);
}

// The whole range from the first local midnight to now, as one Bucket per column. A number range
// gives the last `range` local days, today included, one bucket per day. "all" runs from the
// earliest run's local day (today when none), one bucket per day up to DAILY_UP_TO days, then
// 7-day buckets labelled "week of 3 Nov", the last one cut short at the end of today. Dates are
// stepped with `new Date(y, m, d + i)` so local midnights stay right across clock changes.
export function spanOf(range: Range, runs: RunRecord[], now: Date): Span {
  const today = startOfDay(now);
  if (range === "all") {
    let earliest: Date | null = null;
    for (const r of runs) {
      if (r.startedAt === null) continue;
      const d = startOfDay(new Date(r.startedAt));
      if (earliest === null || d.getTime() < earliest.getTime()) earliest = d;
    }
    const start = earliest ?? today;
    if (countDays(start, today) > DAILY_UP_TO) {
      return { startMs: start.getTime(), endMs: now.getTime(), buckets: weeklyBuckets(start, today), weekly: true };
    }
    return { startMs: start.getTime(), endMs: now.getTime(), buckets: dailyBuckets(start, today), weekly: false };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1));
  return { startMs: start.getTime(), endMs: now.getTime(), buckets: dailyBuckets(start, today), weekly: false };
}

function dailyBuckets(start: Date, today: Date): Bucket[] {
  const buckets: Bucket[] = [];
  let d = start;
  while (d.getTime() <= today.getTime()) {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    buckets.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, startMs: d.getTime(), endMs: next.getTime() });
    d = next;
  }
  return buckets;
}

function weeklyBuckets(start: Date, today: Date): Bucket[] {
  const buckets: Bucket[] = [];
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  let cur = start;
  while (cur.getTime() < end.getTime()) {
    const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    const bucketEnd = next.getTime() <= end.getTime() ? next : end;
    buckets.push({ label: `week of ${cur.getDate()} ${MONTHS[cur.getMonth()]}`, startMs: cur.getTime(), endMs: bucketEnd.getTime() });
    cur = new Date(bucketEnd.getFullYear(), bucketEnd.getMonth(), bucketEnd.getDate());
  }
  return buckets;
}

function countDays(start: Date, today: Date): number {
  let n = 1;
  let d = start;
  while (d.getTime() < today.getTime()) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    n++;
  }
  return n;
}

// The span bucket holding `ms`, or undefined when it lies outside every bucket. The buckets are
// contiguous and sorted by startMs, so the last one whose startMs is at most `ms` is the answer.
export function bucketIndex(span: Span, ms: number): number | undefined {
  const buckets = span.buckets;
  const n = buckets.length;
  if (n === 0 || ms < buckets[0].startMs || ms >= buckets[n - 1].endMs) return undefined;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (buckets[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Every slot of `all` whose turn finished inside the span's window, with its bucket.
function windowSlots(all: RunRecord[], span: Span): { index: number; slot: Slot }[] {
  const found: { index: number; slot: Slot }[] = [];
  for (const r of all) {
    for (const slot of r.slots) {
      const index = bucketIndex(span, slot[0]);
      if (index === undefined) continue;
      found.push({ index, slot });
    }
  }
  return found;
}

export interface Totals {
  delegations: number;
  donePercent: number | null;
  stopped: number;
  limits: number;
  failed: number;
  tokens: number | null;
  cacheReusePercent: number | null;
  questions: number | null;
  asks: number | null;
  asked: number;
  askedMoreThanOnce: number;
  messaged: number;
  messages: number | null;
  undelivered: number | null;
  inline: number;
  said: number;
}

// The tokens and cache reuse of the turns that finished in the span's window, whichever day their
// run started: a slot counts only when it reported the figures.
function tokenFigures(all: RunRecord[], span: Span): { tokens: number | null; cacheReusePercent: number | null } {
  let tokenSum = 0;
  let anyTokens = false;
  let inputSum = 0;
  let cachedSum = 0;
  let anyCache = false;
  for (const { slot } of windowSlots(all, span)) {
    const [, input, cached, output] = slot;
    if (input !== null || output !== null) {
      anyTokens = true;
      tokenSum += (input ?? 0) + (output ?? 0);
    }
    if (input !== null && cached !== null) {
      anyCache = true;
      inputSum += input;
      cachedSum += cached;
    }
  }
  return {
    tokens: anyTokens ? tokenSum : null,
    cacheReusePercent: anyCache && inputSum > 0 ? Math.round((cachedSum / inputSum) * 100) : null,
  };
}

export function totals(runs: RunRecord[], span: Span, all: RunRecord[]): Totals {
  let ok = 0;
  let stopped = 0;
  let limits = 0;
  let failed = 0;
  let questionSum = 0;
  let anyQuestions = false;
  let askSum = 0;
  let anyAsks = false;
  let asked = 0;
  let askedMoreThanOnce = 0;
  let messaged = 0;
  let messageSum = 0;
  let anyMessages = false;
  let undeliveredSum = 0;
  let anyUndelivered = false;
  let inline = 0;
  let said = 0;
  for (const r of runs) {
    switch (r.outcome) {
      case "ok": ok++; break;
      case "stopped": stopped++; break;
      case "timed out":
      case "cut off": limits++; break;
      case "failed": failed++; break;
    }
    if (r.questions !== null) {
      anyQuestions = true;
      questionSum += r.questions;
    }
    if (r.asks !== null) {
      anyAsks = true;
      askSum += r.asks;
      if (r.asks > 0) asked++;
      if (r.asks > 1) askedMoreThanOnce++;
    }
    if (r.messages !== null) {
      anyMessages = true;
      messageSum += r.messages;
      if (r.messages > 0) messaged++;
    }
    if (r.undelivered !== null) {
      anyUndelivered = true;
      undeliveredSum += r.undelivered;
    }
    if (r.mcpTask !== null) {
      said++;
      if (r.mcpTask === false) inline++;
    }
  }
  const figures = tokenFigures(all, span);
  return {
    delegations: runs.length,
    donePercent: runs.length === 0 ? null : Math.round((ok / runs.length) * 100),
    stopped,
    limits,
    failed,
    tokens: figures.tokens,
    cacheReusePercent: figures.cacheReusePercent,
    questions: anyQuestions ? questionSum : null,
    asks: anyAsks ? askSum : null,
    asked,
    askedMoreThanOnce,
    messaged,
    messages: anyMessages ? messageSum : null,
    undelivered: anyUndelivered ? undeliveredSum : null,
    inline,
    said,
  };
}

export interface Day {
  label: string;
  ok: number;
  stopped: number;
  limits: number;
  failed: number;
  cached: number;
  fresh: number;
  output: number;
  rebuilt: number | null;
  questions: number | null;
  asks: number | null;
  asked: number;
  messaged: number;
  both: number;
  messages: number | null;
  undelivered: number | null;
  waits: number[];
  inline: number;
  said: number;
}

// A day's delegations and involvement come from the runs that started on it; its tokens and
// rebuilt prompts come from the turns that finished on it, whichever day their run started.
export function perDay(runs: RunRecord[], span: Span, all: RunRecord[]): Day[] {
  const result: Day[] = span.buckets.map((b) => ({
    label: b.label,
    ok: 0, stopped: 0, limits: 0, failed: 0,
    cached: 0, fresh: 0, output: 0,
    rebuilt: null,
    questions: null, asks: null, asked: 0, messaged: 0, both: 0,
    messages: null, undelivered: null, waits: [], inline: 0, said: 0,
  }));
  for (const r of runs) {
    if (r.startedAt === null) continue;
    const index = bucketIndex(span, r.startedAt);
    if (index === undefined) continue;
    const day = result[index];
    switch (r.outcome) {
      case "ok": day.ok++; break;
      case "stopped": day.stopped++; break;
      case "timed out":
      case "cut off": day.limits++; break;
      case "failed": day.failed++; break;
    }
    if (r.questions !== null) day.questions = (day.questions ?? 0) + r.questions;
    if (r.asks !== null) day.asks = (day.asks ?? 0) + r.asks;
    // A run that never said how many messages it got is left out of the involvement counts;
    // one that did adds its messages and waits and is sorted into asked/messaged/both.
    if (r.messages !== null) {
      day.messages = (day.messages ?? 0) + r.messages;
      day.undelivered = (day.undelivered ?? 0) + (r.undelivered ?? 0);
      if (r.messageWaits !== null) day.waits.push(...r.messageWaits);
      const askedRun = r.asks !== null && r.asks > 0;
      if (askedRun && r.messages === 0) day.asked++;
      else if (!askedRun && r.messages > 0) day.messaged++;
      else if (askedRun && r.messages > 0) day.both++;
    }
    if (r.mcpTask !== null) {
      day.said++;
      if (r.mcpTask === false) day.inline++;
    }
  }
  // The tokens and rebuilt prompts of the turns that finished on each day.
  for (const { index, slot } of windowSlots(all, span)) {
    const day = result[index];
    const [, input, cached, output, rebuilt] = slot;
    day.cached += cached ?? 0;
    day.fresh += Math.max(0, (input ?? 0) - (cached ?? 0));
    day.output += output ?? 0;
    // A slot whose turn reported no rebuilt figure is left out, so a day none of them reported
    // on stays null rather than 0.
    if (rebuilt !== null) day.rebuilt = (day.rebuilt ?? 0) + rebuilt;
  }
  return result;
}

export function reasons(runs: RunRecord[]): { reason: string; outcome: Outcome; count: number }[] {
  const groups = new Map<string, { reason: string; outcome: Outcome; count: number }>();
  for (const r of runs) {
    if (r.outcome === "ok") continue;
    const reason = r.reason ?? r.outcome;
    const g = groups.get(reason);
    if (g) g.count++;
    else groups.set(reason, { reason, outcome: r.outcome, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

// The runs that asked the caller more than once, newest first by start time.
export function askedMoreThanOnce(runs: RunRecord[]): RunRecord[] {
  return runs
    .filter((r) => r.asks !== null && r.asks > 1)
    .sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1));
}

export interface Group {
  key: string;
  delegations: number;
  donePercent: number;
  tokens: number | null;
  cacheReusePercent: number | null;
  medianSeconds: number | null;
  last: number | null;
}

interface Accumulator {
  key: string;
  delegations: number;
  ok: number;
  tokenSum: number;
  anyTokens: boolean;
  cachedSum: number;
  inputSum: number;
  anyCache: boolean;
  elapsed: number[];
  last: number | null;
}

// Groups are the keys the runs in range started with; their tokens and cache reuse count the
// turns that finished in the window, whichever day their run started.
export function groupBy(runs: RunRecord[], field: "repo" | "model", span: Span, all: RunRecord[]): Group[] {
  const groups = new Map<string, Accumulator>();
  for (const r of runs) {
    const key = field === "repo" ? (r.repo ?? "—") : (r.model ?? "—");
    let g = groups.get(key);
    if (!g) {
      g = { key, delegations: 0, ok: 0, tokenSum: 0, anyTokens: false, cachedSum: 0, inputSum: 0, anyCache: false, elapsed: [], last: null };
      groups.set(key, g);
    }
    g.delegations++;
    if (r.outcome === "ok") g.ok++;
    if (r.elapsedSeconds !== null) g.elapsed.push(r.elapsedSeconds);
    if (r.startedAt !== null && (g.last === null || r.startedAt > g.last)) g.last = r.startedAt;
  }
  // A run outside the range still adds its slots' tokens to the key its group already has.
  for (const r of all) {
    const key = field === "repo" ? (r.repo ?? "—") : (r.model ?? "—");
    const g = groups.get(key);
    if (g === undefined) continue;
    for (const slot of r.slots) {
      if (bucketIndex(span, slot[0]) === undefined) continue;
      const [, input, cached, output] = slot;
      if (input !== null || output !== null) {
        g.anyTokens = true;
        g.tokenSum += (input ?? 0) + (output ?? 0);
      }
      if (input !== null && cached !== null) {
        g.anyCache = true;
        g.inputSum += input;
        g.cachedSum += cached;
      }
    }
  }
  return [...groups.values()]
    .map((g): Group => {
      const sorted = [...g.elapsed].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length === 0 ? null : sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return {
        key: g.key,
        delegations: g.delegations,
        donePercent: g.delegations === 0 ? 0 : Math.round((g.ok / g.delegations) * 100),
        tokens: g.anyTokens ? g.tokenSum : null,
        cacheReusePercent: g.anyCache && g.inputSum > 0 ? Math.round((g.cachedSum / g.inputSum) * 100) : null,
        medianSeconds: median,
        last: g.last,
      };
    })
    .sort((a, b) => b.delegations - a.delegations || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function dayMonthYear(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// The middle value of the waits a day collected; null when there is nothing to take.
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
