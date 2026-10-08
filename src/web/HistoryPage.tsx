// The History tab: the run records the backend keeps, over the last 7/30/90 days. The
// figures come from historyData.ts (pure); this page only fetches the records and draws them.
import { useEffect, useState } from "react";
import type { RunRecord, RunsStatus } from "../server/runs.ts";
import { ChartTooltip } from "./ChartTooltip.tsx";
import { compactCount } from "./format.ts";
import { StateIcon } from "./states.tsx";
import {
  dayMonthYear,
  groupBy,
  inRange,
  perDay,
  reasons,
  totals,
  type Day,
  type Group,
  type Range,
} from "./historyData.ts";
import { localTime } from "./time.ts";

interface RunsResponse {
  status: RunsStatus;
  runs: RunRecord[];
}

// A run's length, written short: "1m30s", "2h05m". The server's formatDuration lives in
// src/server/streams.ts (server code), so the web keeps its own copy here.
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

// Five evenly spaced day labels under a chart, oldest first.
function chartLabels(days: Day[]): string[] {
  const n = days.length;
  if (n === 0) return [];
  return [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1].map(
    (i) => days[i].label,
  );
}

const RANGES: Range[] = [7, 30, 90];

export function HistoryPage() {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<Range>(30);

  // Fetch the records on mount and refresh them every minute, like the cluster history.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/runs");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as RunsResponse;
        if (!cancelled) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void load();
    const id = setInterval(() => {
      void load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section aria-label="History" className="flex flex-col gap-4">
      <div role="group" aria-label="Range" className="flex gap-0.5 self-start rounded-md bg-line/40 p-0.5 text-xs">
        {RANGES.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={range === d}
            onClick={() => setRange(d)}
            className={range === d ? "rounded px-2 py-0.5 bg-card font-semibold" : "rounded px-2 py-0.5 text-muted"}
          >
            {d} days
          </button>
        ))}
      </div>
      {data === null ? (
        error ? (
          <p className="text-muted">Could not load the history.</p>
        ) : (
          <p className="text-muted">Loading history…</p>
        )
      ) : (
        <>
          {error && <p className="text-muted">Could not refresh the history.</p>}
          <HistoryBody data={data} range={range} />
        </>
      )}
    </section>
  );
}

// A series of a day chart: its segment height (`value`), the tooltip line's label and
// text, and the Tailwind class for the segment and swatch.
interface Bar {
  key: string;
  label: string;
  value: number;
  swatch: string;
  text: string;
}

// One per-day chart: a column per day, each a button-like hit target over the full height.
// Hovering or focusing a column shows one ChartTooltip above the chart, over that column.
function DayChart({
  days,
  pct,
  title,
  ariaLabel,
  totalFor,
  barsFor,
}: {
  days: Day[];
  pct: (v: number) => number;
  title: (d: Day) => string;
  ariaLabel: (d: Day) => string;
  totalFor: (d: Day) => { label: string; value: string };
  barsFor: (d: Day) => Bar[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const day = active === null ? null : days[active];
  // The tooltip is centred over the active column, kept inside the card.
  const centre = active === null ? 0 : ((active + 0.5) / n) * 100;
  const left = Math.max(8, Math.min(92, centre));
  return (
    <div className="relative">
      <div className="flex h-[130px] items-end gap-[3px] border-b border-line">
        {days.map((d, i) => {
          const bars = barsFor(d).filter((b) => b.value > 0);
          return (
            <div
              key={d.label}
              role="button"
              tabIndex={0}
              aria-label={ariaLabel(d)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={`flex h-full flex-1 flex-col-reverse gap-[2px] ${active !== null && active !== i ? "opacity-60" : ""}`}
            >
              {bars.map((b, j) => (
                <div
                  key={b.key}
                  className={`${b.swatch} ${j === bars.length - 1 ? "rounded-t-[3px]" : ""}`}
                  style={{ height: `${pct(b.value)}%` }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {day !== null && (
        <div
          className="absolute bottom-full left-0 mb-2"
          style={{ left: `${left}%`, transform: "translateX(-50%)" }}
        >
          <ChartTooltip
            title={title(day)}
            rows={barsFor(day).map((b) => ({ label: b.label, value: b.text, swatch: b.swatch }))}
            total={totalFor(day)}
          />
        </div>
      )}
    </div>
  );
}

function HistoryBody({ data, range }: { data: RunsResponse; range: Range }) {
  const now = new Date();
  const runs = inRange(data.runs, range, now);
  const t = totals(runs);
  const days = perDay(runs, range, now);
  const why = reasons(runs);
  const repoGroups = groupBy(runs, "repo");
  const modelGroups = groupBy(runs, "model");

  // Each column is a share of the tallest day, so the two charts always fill the same box.
  const dayMax = days.reduce((m, d) => Math.max(m, d.ok + d.stopped + d.limits + d.failed), 0);
  const tokenMax = days.reduce((m, d) => Math.max(m, d.cached + d.fresh + d.output), 0);
  const dayPct = (v: number) => (dayMax === 0 ? 0 : (v / dayMax) * 100);
  const tokenPct = (v: number) => (tokenMax === 0 ? 0 : (v / tokenMax) * 100);
  const labels = chartLabels(days);
  const peak = days.length === 0 ? null : days.reduce((best, d) => (d.cached + d.fresh + d.output > best.cached + best.fresh + best.output ? d : best), days[0]);
  const peakText = peak === null ? "—" : `peak ${compactCount(peak.cached + peak.fresh + peak.output)} on ${peak.label}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-card p-3.5">
          <span className="text-[12.5px] text-muted">Delegations</span>
          <span className="font-mono tabular-nums text-2xl font-medium">{t.delegations.toLocaleString()}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-card p-3.5">
          <span className="text-[12.5px] text-muted">Done</span>
          <span className="font-mono tabular-nums text-2xl font-medium text-state-ok">
            {t.donePercent === null ? "—" : `${t.donePercent}%`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-card p-3.5">
          <span className="text-[12.5px] text-muted">Did not finish</span>
          <span className="font-mono tabular-nums text-2xl font-medium">{t.stopped + t.limits + t.failed}</span>
          <span className="text-xs text-muted">{`${t.stopped} stopped · ${t.limits} limits · ${t.failed} failed`}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-card p-3.5">
          <span className="text-[12.5px] text-muted">Tokens processed</span>
          <span className="font-mono tabular-nums text-2xl font-medium">
            {t.tokens === null ? "—" : compactCount(t.tokens)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-card p-3.5">
          <span className="text-[12.5px] text-muted">Cache reuse</span>
          <span className="font-mono tabular-nums text-2xl font-medium">
            {t.cacheReusePercent === null ? "—" : `${t.cacheReusePercent}%`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5 rounded-xl border border-line bg-card p-4">
          <h3 className="text-sm font-semibold">Delegations per day</h3>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-done" aria-hidden="true" />done</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-stopped" aria-hidden="true" />stopped</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-limits" aria-hidden="true" />timed out or cut off</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-failed" aria-hidden="true" />failed</span>
          </div>
          <DayChart
            days={days}
            pct={dayPct}
            title={(d) => d.label}
            ariaLabel={(d) => `${d.label}: ${d.ok} done, ${d.stopped} stopped, ${d.limits} timed out or cut off, ${d.failed} failed`}
            totalFor={(d) => ({ label: "Delegations", value: String(d.ok + d.stopped + d.limits + d.failed) })}
            barsFor={(d) => [
              { key: "done", label: "done", value: d.ok, swatch: "bg-chart-done", text: String(d.ok) },
              { key: "stopped", label: "stopped", value: d.stopped, swatch: "bg-chart-stopped", text: String(d.stopped) },
              { key: "limits", label: "timed out or cut off", value: d.limits, swatch: "bg-chart-limits", text: String(d.limits) },
              { key: "failed", label: "failed", value: d.failed, swatch: "bg-chart-failed", text: String(d.failed) },
            ]}
          />
          <div className="flex justify-between font-mono tabular-nums text-[11.5px] text-muted">
            {labels.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5 rounded-xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">Tokens per day</h3>
            <span className="text-[12.5px] text-muted">{peakText}</span>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent/30" aria-hidden="true" />input, from cache</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent/65" aria-hidden="true" />input, new</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden="true" />output</span>
          </div>
          <DayChart
            days={days}
            pct={tokenPct}
            title={(d) => d.label}
            ariaLabel={(d) => `${d.label}: ${d.cached} from cache, ${d.fresh} new, ${d.output} output`}
            totalFor={(d) => ({ label: "Tokens", value: compactCount(d.cached + d.fresh + d.output) })}
            barsFor={(d) => [
              { key: "cached", label: "input, from cache", value: d.cached, swatch: "bg-accent/30", text: compactCount(d.cached) },
              { key: "fresh", label: "input, new", value: d.fresh, swatch: "bg-accent/65", text: compactCount(d.fresh) },
              { key: "output", label: "output", value: d.output, swatch: "bg-accent", text: compactCount(d.output) },
            ]}
          />
          <div className="flex justify-between font-mono tabular-nums text-[11.5px] text-muted">
            {labels.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <h3 className="text-sm font-semibold">Why runs did not finish</h3>
        {why.length === 0 ? (
          <p className="text-muted">Every run finished.</p>
        ) : (
          why.map((r) => (
            <div key={r.reason} className="flex items-center gap-2.5 text-[13px]">
              <StateIcon state={r.outcome} />
              <span className="flex-1">{r.reason}</span>
              <span className="font-mono tabular-nums">{r.count}</span>
            </div>
          ))
        )}
      </div>

      <GroupTable name="Repo" groups={repoGroups} />
      <GroupTable name="Model" groups={modelGroups} />

      <p className="text-muted">
        {`${data.status.records.toLocaleString()} runs kept`}
        {data.status.checkedAt === null
          ? " · not yet checked against the folder"
          : ` · checked against the folder at ${localTime(new Date(data.status.checkedAt).toISOString())} · ${data.status.disagreed} disagreed`}
        {data.status.missing > 0 && ` · ${data.status.missing} no longer in the folder`}
        {data.status.writeError !== null && (
          <>
            {" · "}
            <span className="text-warn">Could not save: {data.status.writeError}</span>
          </>
        )}
      </p>
    </>
  );
}

// One row per repo or model: how many, how many finished, tokens, cache reuse, time, last date.
function GroupTable({ name, groups }: { name: string; groups: Group[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">By {name.toLowerCase()}</h3>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1.5 pr-2 font-medium">{name}</th>
            <th className="px-2 py-1.5 text-right font-medium">Delegations</th>
            <th className="px-2 py-1.5 text-right font-medium">Done</th>
            <th className="px-2 py-1.5 text-right font-medium">Tokens</th>
            <th className="px-2 py-1.5 text-right font-medium">Cache reuse</th>
            <th className="px-2 py-1.5 text-right font-medium">Median time</th>
            <th className="py-1.5 pl-2 text-right font-medium">Last</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-line">
              <td className="py-1.5 pr-2 font-sans">{g.key}</td>
              <td className="px-2 py-1.5 text-right">{g.delegations.toLocaleString()}</td>
              <td className="px-2 py-1.5 text-right">{g.donePercent}%</td>
              <td className="px-2 py-1.5 text-right">{g.tokens === null ? "—" : compactCount(g.tokens)}</td>
              <td className="px-2 py-1.5 text-right">{g.cacheReusePercent === null ? "—" : `${g.cacheReusePercent}%`}</td>
              <td className="px-2 py-1.5 text-right">{g.medianSeconds === null ? "—" : formatDuration(g.medianSeconds)}</td>
              <td className="py-1.5 pl-2 text-right">{g.last === null ? "—" : dayMonthYear(g.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
