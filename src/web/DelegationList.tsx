import { useState } from "react";
import type { ListResponse, HistoryPage } from "../server/poller.ts";
import type { ListRow } from "../server/streams.ts";
import { choices, filterRows, isFiltering, NO_FILTER, type RowFilter } from "./filter.ts";
import { localDateTime } from "./time.ts";

export const STATE_COLOR: Record<ListRow["state"], string> = {
  live: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  quiet: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  ok: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  "cut off": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const WHY_COLOR: Record<ListRow["state"], string> = {
  live: "text-blue-600 dark:text-blue-400",
  queued: "text-amber-600 dark:text-amber-400",
  quiet: "text-slate-500 dark:text-slate-400",
  ok: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  "cut off": "text-orange-600 dark:text-orange-400",
};

const STATES: ListRow["state"][] = ["live", "queued", "quiet", "ok", "failed", "cut off"];

const CONTROL_CLASS =
  "rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

const CLEAR_CLASS =
  "rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800";

function metaLine(row: ListRow): string {
  const pieces = [
    row.kind,
    row.model,
    row.effort,
    row.turns === null ? null : `turns ${row.turns}`,
    row.elapsed,
  ].filter((p): p is string => p !== null && p !== "");
  return pieces.join(" · ");
}

function startLine(row: ListRow): string {
  const time = localDateTime(row.startedAt);
  let text = time;
  if (row.age !== null && row.age !== "") {
    if (row.state === "quiet") text += ` · quiet for ${row.age}`;
    else if (row.state === "queued") text += ` · queued ${row.age}`;
  }
  return text;
}

function RowCard({ row }: { row: ListRow }) {
  const meta = metaLine(row);
  return (
    <li className="rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATE_COLOR[row.state]}`}>
          {row.state}
        </span>
        <a
          href={"/s/" + encodeURIComponent(row.name)}
          className="min-w-0 truncate font-medium hover:underline"
          title={row.title}
        >
          {row.title}
        </a>
      </div>
      {meta !== "" && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{meta}</p>
      )}
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{startLine(row)}</p>
      {row.why !== null && row.why !== "" && (
        <p className={`mt-1 text-sm ${WHY_COLOR[row.state]}`}>{row.why}</p>
      )}
      {row.unknownFormat !== null && row.unknownFormat !== "" && (
        <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
          format {row.unknownFormat}: shown as best it can be
        </p>
      )}
    </li>
  );
}

function toggleState(prev: RowFilter, state: ListRow["state"]): RowFilter {
  const has = prev.states.includes(state);
  return { ...prev, states: has ? prev.states.filter((s) => s !== state) : [...prev.states, state] };
}

export function DelegationList({ list }: { list: ListResponse | null }) {
  const [older, setOlder] = useState<ListRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null); // the next page's `before`
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);

  if (list === null) {
    return <p className="text-slate-500 dark:text-slate-400">Waiting for the first list…</p>;
  }

  const live = list.rows;
  const loaded = [...live, ...older];
  const filtering = isFiltering(filter);
  const filteredLive = filterRows(live, filter);
  const filteredOlder = filterRows(older, filter);
  const shownCount = filteredLive.length + filteredOlder.length;
  const kindChoices = choices(loaded, "kind");
  const modelChoices = choices(loaded, "model");

  async function loadOlder(): Promise<void> {
    if (loading) return;
    const before = started ? cursor : live[live.length - 1]?.name ?? null;
    if (before === null) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/streams?before=" + encodeURIComponent(before));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const page = (await res.json()) as HistoryPage;
      setOlder((prev) => {
        const shown = new Set<string>();
        for (const r of live) shown.add(r.name);
        for (const r of prev) shown.add(r.name);
        return [...prev, ...page.rows.filter((r) => !shown.has(r.name))];
      });
      setCursor(page.nextBefore);
      setStarted(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Delegations</h2>
      {list.capped && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Showing the newest {list.rows.length} of {list.total.toLocaleString()}
        </p>
      )}
      {list.rows.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">No delegations yet.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Search titles"
              aria-label="Search titles"
              value={filter.text}
              onChange={(e) => setFilter((prev) => ({ ...prev, text: e.target.value }))}
              className={`${CONTROL_CLASS} placeholder-slate-400 dark:placeholder-slate-500`}
            />
            {STATES.map((state) => {
              const pressed = filter.states.includes(state);
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilter((prev) => toggleState(prev, state))}
                  className={
                    pressed
                      ? `rounded border px-2 py-0.5 text-xs font-medium ${STATE_COLOR[state]}`
                      : "rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  }
                >
                  {state}
                </button>
              );
            })}
            <select
              aria-label="Kind"
              value={filter.kind ?? ""}
              onChange={(e) => setFilter((prev) => ({ ...prev, kind: e.target.value === "" ? null : e.target.value }))}
              className={CONTROL_CLASS}
            >
              <option value="">All kinds</option>
              {kindChoices.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <select
              aria-label="Model"
              value={filter.model ?? ""}
              onChange={(e) => setFilter((prev) => ({ ...prev, model: e.target.value === "" ? null : e.target.value }))}
              className={CONTROL_CLASS}
            >
              <option value="">All models</option>
              {modelChoices.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
          {filtering && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {shownCount === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No loaded delegation matches.</p>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Showing {shownCount} of {loaded.length} loaded
                </p>
              )}
              <button type="button" onClick={() => setFilter(NO_FILTER)} className={CLEAR_CLASS}>
                Clear
              </button>
            </div>
          )}
          {(!filtering || shownCount > 0) && (
            <ul className="mt-2 flex flex-col gap-3">
              {filteredLive.map((row) => (
                <RowCard key={row.name} row={row} />
              ))}
              {list.capped &&
                filteredOlder.map((row) => (
                  <RowCard key={row.name} row={row} />
                ))}
            </ul>
          )}
        </>
      )}
      {list.capped && (
        <div className="mt-3">
          {error && (
            <p className="text-sm text-amber-700 dark:text-amber-300">Could not load older delegations.</p>
          )}
          {started && cursor === null && !loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">That is the oldest.</p>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void loadOlder();
              }}
              className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {loading ? "Loading…" : "Show older"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
