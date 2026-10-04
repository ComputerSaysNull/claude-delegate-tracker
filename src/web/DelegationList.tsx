import { useState } from "react";
import type { ListResponse, HistoryPage } from "../server/poller.ts";
import type { ListRow } from "../server/streams.ts";
import { choices, filterRows, isFiltering, NO_FILTER, type RowFilter } from "./filter.ts";
import { localDateTime } from "./time.ts";
import { StateBadge, STATE_TEXT, STATE_BADGE, cardClass } from "./states.tsx";

const STATES: ListRow["state"][] = ["live", "queued", "quiet", "ok", "failed", "cut off"];

const CONTROL_CLASS =
  "rounded border border-line bg-card px-2 py-1 text-sm text-text";

const CLEAR_CLASS =
  "rounded border border-line px-2 py-1 text-sm text-text hover:bg-line/50";

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

function RowCard({
  row,
  selected,
  onOpen,
}: {
  row: ListRow;
  selected?: string | null;
  onOpen?: (name: string) => void;
}) {
  const meta = metaLine(row);
  return (
    <li
      className={`rounded-lg border p-4 ${cardClass(row.state)} ${selected === row.name ? "ring-2 ring-accent" : ""}`}
      aria-current={selected === row.name ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <StateBadge state={row.state} />
        <a
          href={"/s/" + encodeURIComponent(row.name)}
          className="min-w-0 truncate font-medium hover:underline"
          title={row.title}
          onClick={(e) => {
            if (
              onOpen &&
              e.button === 0 &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.shiftKey &&
              !e.altKey
            ) {
              e.preventDefault();
              onOpen(row.name);
            }
          }}
        >
          {row.title}
        </a>
      </div>
      {meta !== "" && (
        <p className="mt-1 text-sm text-muted">{meta}</p>
      )}
      <p className="mt-1 text-sm text-muted font-mono tabular-nums">{startLine(row)}</p>
      {row.why !== null && row.why !== "" && (
        <p className={`mt-1 text-sm ${STATE_TEXT[row.state]}`}>{row.why}</p>
      )}
      {row.unknownFormat !== null && row.unknownFormat !== "" && (
        <p className="mt-1 text-sm text-warn">
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

export function DelegationList({
  list,
  selected,
  onOpen,
  filter: shownFilter,
  onFilterChange,
}: {
  list: ListResponse | null;
  selected?: string | null;
  onOpen?: (name: string) => void;
  // Given both, the filter lives outside (in the address); otherwise the list keeps its own.
  filter?: RowFilter;
  onFilterChange?: (next: RowFilter) => void;
}) {
  const [older, setOlder] = useState<ListRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null); // the next page's `before`
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [ownFilter, setOwnFilter] = useState<RowFilter>(NO_FILTER);
  const filter = shownFilter ?? ownFilter;
  const setFilter = (next: RowFilter | ((prev: RowFilter) => RowFilter)) => {
    const value = typeof next === "function" ? next(filter) : next;
    if (onFilterChange !== undefined) onFilterChange(value);
    else setOwnFilter(value);
  };

  if (list === null) {
    return <p className="text-muted">Waiting for the first list…</p>;
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
        <p className="text-sm text-muted">
          Showing the newest {list.rows.length} of {list.total.toLocaleString()}
        </p>
      )}
      {list.rows.length === 0 ? (
        <p className="text-muted">No delegations yet.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Search titles"
              aria-label="Search titles"
              value={filter.text}
              onChange={(e) => setFilter((prev) => ({ ...prev, text: e.target.value }))}
              className={`${CONTROL_CLASS} placeholder-muted`}
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
                      ? `rounded border px-2 py-0.5 text-xs font-medium ${STATE_BADGE[state]}`
                      : "rounded border border-line px-2 py-0.5 text-xs font-medium text-text hover:bg-line/50"
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
                <p className="text-sm text-muted">No loaded delegation matches.</p>
              ) : (
                <p className="text-sm text-muted">
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
                <RowCard key={row.name} row={row} selected={selected} onOpen={onOpen} />
              ))}
              {list.capped &&
                filteredOlder.map((row) => (
                  <RowCard key={row.name} row={row} selected={selected} onOpen={onOpen} />
                ))}
            </ul>
          )}
        </>
      )}
      {list.capped && (
        <div className="mt-3">
          {error && (
            <p className="text-sm text-warn">Could not load older delegations.</p>
          )}
          {started && cursor === null && !loading ? (
            <p className="text-sm text-muted">That is the oldest.</p>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void loadOlder();
              }}
              className="rounded border border-line px-3 py-1 text-sm text-text hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Loading…" : "Show older"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
