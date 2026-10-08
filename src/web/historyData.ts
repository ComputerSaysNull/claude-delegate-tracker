// The History tab's figures, computed from the run records the backend keeps on disk. Pure: no React, no fetch.
import type { Outcome, RunRecord } from "../server/runs.ts";

export type Range = 7 | 30 | 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Local midnight of the day `d` falls on.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function inRange(runs: RunRecord[], days: Range, now: Date): RunRecord[] {
  const today = startOfDay(now).getTime();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  return runs.filter((r) => {
    if (r.startedAt === null) return false;
    const day = startOfDay(new Date(r.startedAt)).getTime();
    return day >= start && day <= today;
  });
}

export interface Totals {
  delegations: number;
  donePercent: number | null;
  stopped: number;
  limits: number;
  failed: number;
  tokens: number | null;
  cacheReusePercent: number | null;
}

export function totals(runs: RunRecord[]): Totals {
  let ok = 0;
  let stopped = 0;
  let limits = 0;
  let failed = 0;
  let tokenSum = 0;
  let anyTokens = false;
  let cachedSum = 0;
  let inputSum = 0;
  let anyCache = false;
  for (const r of runs) {
    switch (r.outcome) {
      case "ok": ok++; break;
      case "stopped": stopped++; break;
      case "timed out":
      case "cut off": limits++; break;
      case "failed": failed++; break;
    }
    if (r.inputTokens !== null || r.outputTokens !== null) {
      anyTokens = true;
      tokenSum += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
    }
    if (r.inputTokens !== null && r.cachedTokens !== null) {
      anyCache = true;
      inputSum += r.inputTokens;
      cachedSum += r.cachedTokens;
    }
  }
  return {
    delegations: runs.length,
    donePercent: runs.length === 0 ? null : Math.round((ok / runs.length) * 100),
    stopped,
    limits,
    failed,
    tokens: anyTokens ? tokenSum : null,
    cacheReusePercent: anyCache && inputSum > 0 ? Math.round((cachedSum / inputSum) * 100) : null,
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
}

export function perDay(runs: RunRecord[], days: Range, now: Date): Day[] {
  const result: Day[] = [];
  const byDay = new Map<number, number>();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    byDay.set(d.getTime(), i);
    result.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, ok: 0, stopped: 0, limits: 0, failed: 0, cached: 0, fresh: 0, output: 0 });
  }
  for (const r of runs) {
    if (r.startedAt === null) continue;
    const index = byDay.get(startOfDay(new Date(r.startedAt)).getTime());
    if (index === undefined) continue;
    const day = result[index];
    switch (r.outcome) {
      case "ok": day.ok++; break;
      case "stopped": day.stopped++; break;
      case "timed out":
      case "cut off": day.limits++; break;
      case "failed": day.failed++; break;
    }
    day.cached += r.cachedTokens ?? 0;
    day.fresh += Math.max(0, (r.inputTokens ?? 0) - (r.cachedTokens ?? 0));
    day.output += r.outputTokens ?? 0;
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

export function groupBy(runs: RunRecord[], field: "repo" | "model"): Group[] {
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
    if (r.inputTokens !== null || r.outputTokens !== null) {
      g.anyTokens = true;
      g.tokenSum += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
    }
    if (r.inputTokens !== null && r.cachedTokens !== null) {
      g.anyCache = true;
      g.inputSum += r.inputTokens;
      g.cachedSum += r.cachedTokens;
    }
    if (r.elapsedSeconds !== null) g.elapsed.push(r.elapsedSeconds);
    if (r.startedAt !== null && (g.last === null || r.startedAt > g.last)) g.last = r.startedAt;
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
