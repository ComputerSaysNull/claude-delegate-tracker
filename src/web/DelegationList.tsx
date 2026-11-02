import { useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import type { ListResponse, HistoryPage } from "../server/poller.ts";
import type { ListRow } from "../server/streams.ts";
import { filterToParams } from "../server/catalog.ts";
import { filterRows, isFiltering, NO_FILTER, unionChoices, type RowFilter } from "./filter.ts";
import { groupRows, todayCounts } from "./groups.ts";
import { localTime } from "./time.ts";
import { StateIcon, STATE_TEXT, STATE_LABEL, cardClass } from "./states.tsx";

const STATES: ListRow["state"][] = ["live", "asking", "queued", "quiet", "ok", "failed", "stopped", "timed out", "cut off"];

const SELECT_CLASS =
  "h-9 rounded-lg border border-line bg-card px-2 text-sm";

const CLEAR_CLASS =
  "rounded border border-line px-2 py-1 text-sm text-text hover:bg-line/50";

// A span chip's label, in the list's own short-month style ("3 Nov").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayShort = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

// A live run's turns as "N of M"; null when the row is not that shape.
function turnsRange(row: ListRow): { n: number; m: number } | null {
  if (row.turns === null) return null;
  const m = row.turns.match(/^(\d+) of (\d+)$/);
  return m === null ? null : { n: Number(m[1]), m: Number(m[2]) };
}

// The turns as they read on a card: "turn N of M" for a run in progress, else "N turns".
function turnsText(row: ListRow): string | null {
  if (row.turns === null) return null;
  if (row.state === "live") {
    const range = turnsRange(row);
    if (range !== null) return `turn ${range.n} of ${range.m}`;
  }
  const first = row.turns.match(/^\d+/);
  if (first === null) return null;
  return `${first[0]} turn${first[0] === "1" ? "" : "s"}`;
}

// The pieces of a card's second line, in order, with their own markup; " · " is added between.
function metaNodes(row: ListRow): ReactNode[] {
  const pieces: ReactNode[] = [];
  // A stream that ran under a workspace leads with that repo, in place of the tool kind.
  const lead = row.workspace ?? row.kind;
  if (lead !== "") pieces.push(lead);
  const turns = turnsText(row);
  if (turns !== null) pieces.push(turns);
  if (row.elapsed !== null && row.elapsed !== "") {
    pieces.push(<span className="font-mono tabular-nums">{row.elapsed}</span>);
  }
  return pieces;
}

// A live run that reports its turns as "N of M" gets a bar of segments under its meta line.
function turnsBar(row: ListRow): ReactNode {
  if (row.state !== "live") return null;
  const range = turnsRange(row);
  if (range === null) return null;
  const { n, m } = range;
  return (
    <div
      role="progressbar"
      aria-label="Turns"
      aria-valuenow={n}
      aria-valuemin={0}
      aria-valuemax={m}
      className="ml-[26px] mt-2.5 flex gap-[3px]"
    >
      {Array.from({ length: m }, (_, i) => (
        <span
          key={i}
          className={`h-[5px] flex-1 rounded-[3px] ${
            i < n - 1 ? "bg-state-live" : i === n - 1 ? "bg-state-live/45" : "bg-line"
          }`}
        />
      ))}
    </div>
  );
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
  let meta: ReactNode;
  if (row.state === "queued") {
    meta = (
      <>
        queued {row.age ?? ""}
        {row.queueOf !== null && row.queueOf !== "" ? ` of ${row.queueOf}` : ""}
      </>
    );
  } else if (row.state === "quiet") {
    meta = <>quiet for {row.age ?? ""}</>;
  } else if (row.state === "asking") {
    meta = (
      <span className="text-state-asking">
        waiting for an answer <span className="font-mono tabular-nums">{row.age ?? ""}</span>
      </span>
    );
  } else {
    const nodes = metaNodes(row);
    meta = nodes.map((node, i) => (
      <Fragment key={i}>
        {i > 0 && " · "}
        {node}
      </Fragment>
    ));
  }
  return (
    // The whole card opens the delegation. The title stays the link, for the keyboard and for
    // opening in a new tab; a click on the link itself is left to the link's own handler.
    <li
      className={`cursor-pointer rounded-xl border px-3.5 py-3 ${cardClass(row.state)} ${selected === row.name ? "ring-2 ring-accent" : ""}`}
      aria-current={selected === row.name ? "true" : undefined}
      onClick={(e) => {
        if (!onOpen || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if ((e.target as HTMLElement).closest("a") !== null) return;
        onOpen(row.name);
      }}
    >
      <div className="flex items-center gap-2.5">
        <StateIcon state={row.state} />
        <a
          href={"/s/" + encodeURIComponent(row.name)}
          className="min-w-0 flex-1 truncate text-[15px] font-semibold hover:underline text-text"
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
        <span className="font-mono tabular-nums text-[13px] text-muted">{localTime(row.startedAt)}</span>
      </div>
      <p className={`ml-[26px] text-[13.5px] ${row.state === "queued" ? "text-warn" : "text-muted"}`}>{meta}</p>
      {turnsBar(row)}
      {row.why !== null && row.why !== "" && (
        <p className={`ml-[26px] text-[13.5px] ${STATE_TEXT[row.state]}`}>{row.why}</p>
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
  searchOpen = false,
}: {
  list: ListResponse | null;
  selected?: string | null;
  onOpen?: (name: string) => void;
  // Given both, the filter lives outside (in the address); otherwise the list keeps its own.
  filter?: RowFilter;
  onFilterChange?: (next: RowFilter) => void;
  // On a phone the search box and the filters sit behind the list header's Search button.
  searchOpen?: boolean;
}) {
  const [older, setOlder] = useState<ListRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null); // the next page's `before`
  const [started, setStarted] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null); // the filter key of the page being fetched
  const [error, setError] = useState(false);
  const [ownFilter, setOwnFilter] = useState<RowFilter>(NO_FILTER);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // groups folded by key; all start open
  const filter = shownFilter ?? ownFilter;
  const setFilter = (next: RowFilter | ((prev: RowFilter) => RowFilter)) => {
    const value = typeof next === "function" ? next(filter) : next;
    if (onFilterChange !== undefined) onFilterChange(value);
    else setOwnFilter(value);
  };

  const live = list?.rows ?? [];
  // A string naming the exact filter a request is made for; the effect below reloads the
  // first older page when it changes, and a response for an older key is dropped.
  const filterKey = useMemo(() => {
    const q = new URLSearchParams();
    filterToParams(filter, q);
    return q.toString();
  }, [filter]);
  const filterKeyRef = useRef(filterKey); // the newest filter key, read when a response arrives
  useEffect(() => {
    filterKeyRef.current = filterKey;
  }, [filterKey]);
  const loading = loadingKey === filterKey;
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  const endRef = useRef<HTMLDivElement>(null);
  const canLoadMore = list !== null && list.capped && !(started && cursor === null) && !error;

  // A change of filter drops the previous filter's older rows (reset while rendering, as
  // React advises for state that follows a prop) and loads the first page for the new one.
  const [rowsKey, setRowsKey] = useState(filterKey);
  if (rowsKey !== filterKey) {
    setRowsKey(filterKey);
    setOlder([]);
    setCursor(null);
    setStarted(false);
    setError(false);
  }
  const firstBefore = live[live.length - 1]?.name ?? null;
  const autoLoad = isFiltering(filter) && list !== null && list.capped && firstBefore !== null;
  useEffect(() => {
    // With no filter nothing is fetched on its own; the scroll marker pages.
    if (autoLoad) void loadOlder(firstBefore);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- once per filter, not per live update

  // The Filters button counts the state, kind, model, repo and messaged filters that are on; the search text is not counted.
  const activeCount =
    filter.states.length + (filter.kind !== null ? 1 : 0) + (filter.model !== null ? 1 : 0) + (filter.repo !== null ? 1 : 0) + (filter.messaged ? 1 : 0);

  // One chip per active state, kind, model or repo filter; pressing it removes just that filter.
  const chips: { label: string; remove: () => void }[] = [];
  for (const state of filter.states) {
    chips.push({
      label: STATE_LABEL[state],
      remove: () => setFilter((prev) => ({ ...prev, states: prev.states.filter((s) => s !== state) })),
    });
  }
  if (filter.kind !== null) {
    chips.push({ label: `kind ${filter.kind}`, remove: () => setFilter((prev) => ({ ...prev, kind: null })) });
  }
  if (filter.model !== null) {
    chips.push({ label: `model ${filter.model}`, remove: () => setFilter((prev) => ({ ...prev, model: null })) });
  }
  if (filter.repo !== null) {
    chips.push({ label: `repo ${filter.repo}`, remove: () => setFilter((prev) => ({ ...prev, repo: null })) });
  }
  if (filter.messaged) {
    chips.push({ label: "messaged by the caller", remove: () => setFilter((prev) => ({ ...prev, messaged: false })) });
  }
  if (filter.from !== null || filter.to !== null) {
    let label: string;
    if (filter.from !== null && filter.to !== null) {
      const from = new Date(filter.from);
      const to = new Date(filter.to);
      // One local day when the day after `from` at local midnight is `to`; else the last
      // shown day is the local day before `to`.
      const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
      if (next.getTime() === filter.to) label = dayShort(filter.from);
      else {
        const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1).getTime();
        label = `${dayShort(filter.from)} – ${dayShort(last)}`;
      }
    } else {
      label = dayShort(filter.from ?? filter.to!);
    }
    chips.push({ label, remove: () => setFilter((prev) => ({ ...prev, from: null, to: null })) });
  }
  if (filter.caller !== null) {
    const label = filter.caller === "asked" ? "asked" : filter.caller === "messaged" ? "messaged" : "asked and messaged";
    chips.push({ label, remove: () => setFilter((prev) => ({ ...prev, caller: null })) });
  }

  // The observer and the event listener call this ref so neither ever uses a stale closure.
  useEffect(() => {
    loadOlderRef.current = loadOlder;
  });

  // Recreated after each page, so a marker still in view loads the next one.
  useEffect(() => {
    if (!(canLoadMore && !loading)) return;
    if (typeof IntersectionObserver === "undefined") return;
    const end = endRef.current;
    if (end === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadOlderRef.current();
    }, { rootMargin: "0px 0px 200px 0px" });
    observer.observe(end);
    return () => observer.disconnect();
  }, [canLoadMore, loading, cursor, filterKey]);

  // The keyboard asks for the next page when j runs past the last card.
  useEffect(() => {
    const onMore = () => void loadOlderRef.current();
    window.addEventListener("delegations:more", onMore);
    return () => window.removeEventListener("delegations:more", onMore);
  }, []);

  if (list === null) {
    return <p className="text-muted">Waiting for the first list…</p>;
  }

  const now = new Date();
  const loaded = [...live, ...older];
  const filtering = isFiltering(filter);
  const filteredLive = filterRows(live, filter);
  const filteredOlder = filterRows(older, filter);
  const shownCount = filteredLive.length + filteredOlder.length;
  const kindChoices = unionChoices(loaded, "kind", list.choices.kinds);
  const modelChoices = unionChoices(loaded, "model", list.choices.models);
  const repoChoices = unionChoices(loaded, "workspace", list.choices.repos);
  const groups = groupRows([...filteredLive, ...filteredOlder], now);
  const counts = todayCounts(loaded, now);

  const toggleGroup = (key: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function loadOlder(beforeArg?: string | null): Promise<void> {
    if (list === null || !list.capped) return; // an uncapped list is already complete
    const requestKey = filterKey; // the filter this request is made for
    if (loadingKey === requestKey) return; // a page for this filter is already on its way
    const before = beforeArg !== undefined ? beforeArg : started ? cursor : live[live.length - 1]?.name ?? null;
    if (before === null) return;
    setLoadingKey(requestKey);
    setError(false);
    try {
      const q = new URLSearchParams();
      filterToParams(filter, q);
      const params = q.toString();
      const res = await fetch("/api/streams?before=" + encodeURIComponent(before) + (params === "" ? "" : "&" + params));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const page = (await res.json()) as HistoryPage;
      // A page for a filter that has since changed is dropped, so it cannot replace the new filter's rows.
      if (requestKey !== filterKeyRef.current) return;
      setOlder((prev) => {
        const shown = new Set<string>();
        for (const r of live) shown.add(r.name);
        for (const r of prev) shown.add(r.name);
        return [...prev, ...page.rows.filter((r) => !shown.has(r.name))];
      });
      setCursor(page.nextBefore);
      setStarted(true);
    } catch {
      if (requestKey !== filterKeyRef.current) return;
      setError(true);
    } finally {
      setLoadingKey((k) => (k === requestKey ? null : k));
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="hidden lg:block whitespace-nowrap text-[17px] font-semibold">Delegations</h2>
        <p className="text-sm text-muted">
          <span className="font-medium text-state-live">{counts.running} running</span>
          {" · "}
          <span className="font-medium text-state-queued">{counts.queued} queued</span>
          {" · "}
          <span className="font-medium text-state-failed">{counts.failed} failed</span>
            {counts.timedOut > 0 && (
              <>
                {" · "}
                <span className="font-medium text-state-timed-out">{counts.timedOut} timed out</span>
              </>
            )}
            {counts.stopped > 0 && (
              <>
                {" · "}
                <span className="font-medium text-state-stopped">{counts.stopped} stopped</span>
              </>
            )}
          {" today"}
        </p>
      </div>
      {list.capped && (
        <p className="text-sm text-muted">
          Showing the newest {list.rows.length} of {list.total.toLocaleString()}
        </p>
      )}
      {list.rows.length === 0 ? (
        <p className="text-muted">No delegations yet.</p>
      ) : (
        <>
          <div className={`${searchOpen ? "flex" : "hidden"} mt-2 flex-col gap-2 lg:flex`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-[1_1_180px]">
              <Search size={15} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                placeholder="Search titles"
                aria-label="Search titles"
                value={filter.text}
                onChange={(e) => setFilter((prev) => ({ ...prev, text: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-card pl-8 pr-3 text-sm"
              />
            </div>
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="filter-panel"
              onClick={() => setFiltersOpen((open) => !open)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
            </button>
          </div>
          {filtersOpen && (
            <div
              id="filter-panel"
              role="group"
              aria-label="Filters"
              className="rounded-xl border border-line bg-card p-3 flex flex-col gap-3"
            >
              <fieldset className="flex flex-wrap gap-2">
                <legend className="text-sm font-medium">State</legend>
                {STATES.map((state) => (
                  <label key={state} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filter.states.includes(state)}
                      onChange={() => setFilter((prev) => toggleState(prev, state))}
                    />
                    {STATE_LABEL[state]}
                  </label>
                ))}
              </fieldset>
              <select
                aria-label="Kind"
                value={filter.kind ?? ""}
                onChange={(e) => setFilter((prev) => ({ ...prev, kind: e.target.value === "" ? null : e.target.value }))}
                className={SELECT_CLASS}
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
                className={SELECT_CLASS}
              >
                <option value="">All models</option>
                {modelChoices.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <select
                aria-label="Repo"
                value={filter.repo ?? ""}
                onChange={(e) => setFilter((prev) => ({ ...prev, repo: e.target.value === "" ? null : e.target.value }))}
                className={SELECT_CLASS}
              >
                <option value="">All repos</option>
                {repoChoices.map((repo) => (
                  <option key={repo} value={repo}>
                    {repo}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filter.messaged}
                  onChange={() => setFilter((prev) => ({ ...prev, messaged: !prev.messaged }))}
                />
                Messaged by the caller
              </label>
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-label={`Remove filter: ${chip.label}`}
                  onClick={chip.remove}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-xs"
                >
                  {chip.label} ×
                </button>
              ))}
            </div>
          )}
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
            <div className="mt-2 flex flex-col gap-3">
              {groups.map((group) => {
                const open = !folded.has(group.key);
                const idx = group.label.indexOf(" · ");
                const name = idx === -1 ? group.label : group.label.slice(0, idx);
                const date = idx === -1 ? null : group.label.slice(idx + 3);
                return (
                  <section key={group.key}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group.key)}
                      className="flex w-full min-h-9 items-center gap-2 px-0.5 text-left text-[15px]"
                    >
                      {open ? (
                        <ChevronDown size={16} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={16} aria-hidden="true" />
                      )}
                      <span className="font-semibold">{name}</span>
                      {date !== null && (
                        <>
                          {/* A space between the two, so the header reads "Today · 4 Oct" aloud. */}
                          {" "}
                          <span className="font-normal text-muted">· {date}</span>
                        </>
                      )}
                      <span className="ml-auto font-mono tabular-nums text-muted">
                        {group.rows.length}
                      </span>
                    </button>
                    {open && (
                      <ul className="mt-2 flex flex-col gap-3">
                        {group.rows.map((row) => (
                          <RowCard key={row.name} row={row} selected={selected} onOpen={onOpen} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      {list.capped && (
        <div className="mt-3">
          {error && (
            <p className="text-sm text-warn">Could not load older delegations.</p>
          )}
          {error && (
            <button
              type="button"
              onClick={() => {
                void loadOlder();
              }}
              className="rounded border border-line px-3 py-1 text-sm text-text hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Try again
            </button>
          )}
          <p role="status" className="text-sm text-muted">
            {loading ? "Loading…" : started && cursor === null && !loading ? "No older delegations" : ""}
          </p>
          <div ref={endRef} data-testid="list-end" aria-hidden="true" className="h-px" />
        </div>
      )}
    </section>
  );
}
