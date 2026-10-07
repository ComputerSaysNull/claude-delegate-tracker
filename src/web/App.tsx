// The page frame: the tracker's backend health in the header, the cluster figures across
// the top, the live delegation list on the left and the open delegation on the right on a
// wide screen, one of the two on a phone. Opening a delegation never reloads the page; the
// address follows the open delegation and the filters, so Back, reload and bookmarks work.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Check, CircleDot, Gauge, History, List, Search, TriangleAlert, X } from "lucide-react";
import { addressFor, readAddress, type Address } from "./address.ts";
import { DelegationList } from "./DelegationList.tsx";
import { HealthBanners } from "./HealthBanners.tsx";
import { HistoryPage } from "./HistoryPage.tsx";
import type { Series } from "../server/history.ts";
import type { Health } from "../server/health.ts";
import { LEVEL_TEXT, level, sinceMs } from "./load.ts";
import { ModelPanel } from "./ModelPanel.tsx";
import { NodePanel } from "./NodePanel.tsx";
import { StreamPage } from "./StreamPage.tsx";
import { useClusterHistory } from "./useClusterHistory.ts";
import { useLiveList } from "./useLiveList.ts";
import { useTabStatus } from "./tabStatus.ts";
import { KeyboardHelp, useKeyboard } from "./keyboard.tsx";
import { NotifyButton, useNotifications } from "./notify.tsx";
import { localTime } from "./time.ts";

type Pill = { text: string; tone: string; Icon: typeof Check };

// The header's health pill, shared by the desktop header and the phone list header.
function pillFor(health: Health | null): Pill | null {
  if (health === null) return null;
  const status = health.transcriptFolder.configured
    ? health.transcriptFolder.readable
      ? "readable"
      : "not readable"
    : "not set";
  if (status === "readable" && health.banners.length === 0)
    return { text: "Health ok", tone: "border-state-ok/40 text-state-ok", Icon: Check };
  if (status === "not readable")
    return { text: "Folder not readable", tone: "border-hot/50 text-hot", Icon: X };
  if (status === "not set")
    return { text: "Folder not set", tone: "border-warn/50 text-warn", Icon: TriangleAlert };
  return { text: "Check the banners", tone: "border-warn/50 text-warn", Icon: TriangleAlert };
}

// `compact` draws the icon alone, its words kept for a screen reader and a hover: the phone's
// header is too narrow for the words, and the banners below already spell the trouble out.
function HealthPill({
  health,
  showWhenOk = true,
  compact = false,
}: {
  health: Health | null;
  showWhenOk?: boolean;
  compact?: boolean;
}) {
  const pill = pillFor(health);
  if (pill === null) return null;
  if (!showWhenOk && pill.text === "Health ok") return null;
  return (
    <span
      role="status"
      aria-label="Health"
      title={compact ? pill.text : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border text-sm ${compact ? "h-11 w-11 justify-center" : "px-3 py-1"} ${pill.tone}`}
    >
      <pill.Icon size={compact ? 18 : 14} aria-hidden="true" />
      <span className={compact ? "sr-only" : undefined}>{pill.text}</span>
    </span>
  );
}

export default function App() {
  const { list, cluster, health, connected } = useLiveList();
  const history = useClusterHistory(cluster);
  useTabStatus(list?.rows ?? null);

  // The cluster band charts either the last hour or the last 15 minutes, counted back from
  // each series' newest point (not the clock, so a render stays pure), so the labels and the
  // points agree.
  const [rangeSeconds, setRangeSeconds] = useState(3600);
  const inRange = (series: Series) => sinceMs(series, (series.at.at(-1) ?? 0) - rangeSeconds * 1000);
  const modelSeries = history === null ? undefined : inRange(history.model);
  const panelWindowSeconds = history === null ? undefined : Math.min(rangeSeconds, history.windowSeconds);

  // The model card's chart-range switch; the nodes have no charts, so it lives with the model.
  const chartRange = (
    <div role="group" aria-label="Chart range" className="flex gap-0.5 rounded-md bg-line/40 p-0.5 text-xs">
      <button
        type="button"
        aria-pressed={rangeSeconds === 900}
        onClick={() => setRangeSeconds(900)}
        className={rangeSeconds === 900 ? "rounded px-2 py-0.5 bg-card font-semibold" : "rounded px-2 py-0.5 text-muted"}
      >
        15 min
      </button>
      <button
        type="button"
        aria-pressed={rangeSeconds === 3600}
        onClick={() => setRangeSeconds(3600)}
        className={rangeSeconds === 3600 ? "rounded px-2 py-0.5 bg-card font-semibold" : "rounded px-2 py-0.5 text-muted"}
      >
        1 hour
      </button>
    </div>
  );

  const [address, setAddress] = useState<Address>(() => readAddress(window.location.pathname, window.location.search));
  const selected = address.selected;

  // Back and Forward move between addresses this page wrote; follow them without a reload.
  useEffect(() => {
    const follow = () => setAddress(readAddress(window.location.pathname, window.location.search));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  // Opening or closing a delegation is a step Back can undo; a filter change only rewrites
  // the current entry, so typing a search does not fill the history.
  const go = (next: Address, step: boolean) => {
    setAddress(next);
    const url = addressFor(next);
    if (url === window.location.pathname + window.location.search) return;
    if (step) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  // A notification when a delegation ends; clicking it opens that delegation here.
  useNotifications(list?.rows ?? [], (name) => go({ ...address, selected: name, section: "list" }, true));

  const { helpOpen, closeHelp } = useKeyboard(() => {
    if (address.selected !== null) go({ ...address, selected: null }, true);
  });

  // The phone list header's Search button reveals the search box and the filters.
  const [searchOpen, setSearchOpen] = useState(false);

  // The phone line: one piece per figure, skipping any whose value is missing.
  const phonePieces: ReactNode[] = [];
  if (cluster !== null) {
    const model = cluster.model;
    if (model.decodeTokensPerSecond !== null) {
      phonePieces.push(`${model.decodeTokensPerSecond.toLocaleString()} tok/s`);
    }
    if (model.running !== null) {
      phonePieces.push(`${model.running.toLocaleString()} running`);
    }
    if (model.kvCachePercent !== null) {
      phonePieces.push(`KV ${model.kvCachePercent.toLocaleString()}%`);
    }
    const temps = cluster.nodes
      .flatMap((node) => [node.cpuTempC, node.gpuTempC])
      .filter((t): t is number => t !== null);
    if (temps.length > 0) {
      const hottest = Math.max(...temps);
      const lvl = level(hottest, cluster.limits.tempWarn, cluster.limits.tempHot);
      phonePieces.push(
        <span
          aria-label="Hottest temperature"
          className={`font-mono tabular-nums ${lvl === "warn" || lvl === "hot" ? LEVEL_TEXT[lvl] : ""}`}
        >
          {`${hottest.toLocaleString()}°C`}
        </span>,
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col text-base lg:h-screen lg:overflow-hidden">
      {helpOpen && <KeyboardHelp onClose={closeHelp} />}
      <header className="hidden lg:flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 lg:px-6">
        <CircleDot size={20} className="text-accent" aria-hidden="true" />
        <h1 className="text-[17px] font-semibold">Delegation tracker</h1>
        <div className="flex-1" />
        <NotifyButton />
        <span
          role="status"
          aria-label="Live updates"
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${connected ? "border-line text-muted" : "border-warn/50 text-warn"}`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-state-ok" : "bg-warn"}`} aria-hidden="true" />
          {connected ? "Live" : "Reconnecting…"}
          <span className="font-mono tabular-nums text-text">{localTime(health?.checkedAt ?? null)}</span>
        </span>
        <HealthPill health={health} />
      </header>
      {selected === null && address.section === "list" && (
        <div className="flex items-center gap-2 px-4 pt-4 lg:hidden">
          <h1 className="shrink-0 text-2xl font-bold">Delegations</h1>
          <span
            aria-label="Live updates"
            title={`Live ${localTime(health?.checkedAt ?? null)}`}
            className={`h-2 w-2 rounded-full ${connected ? "bg-state-ok" : "bg-warn"}`}
          />
          <div className="flex-1" />
          <NotifyButton iconOnly />
          <HealthPill health={health} showWhenOk={false} compact />
          <button
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-card text-muted"
          >
            <Search size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={`${selected === null ? "" : "hidden lg:block"} px-4 lg:px-6`}>
        <HealthBanners banners={health?.banners ?? []} />
      </div>
      {cluster !== null && selected === null && address.section === "list" && phonePieces.length > 0 && (
        <a
          href="/cluster"
          onClick={(e) => {
            e.preventDefault();
            go({ ...address, section: "cluster", selected: null }, true);
          }}
          className="mx-4 my-2 flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2 text-sm lg:hidden"
        >
          {phonePieces.map((piece, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="text-muted">·</span>}
              {piece}
            </Fragment>
          ))}
        </a>
      )}
      <section
        aria-label="Cluster"
        className={`${address.section === "cluster" && selected === null ? "flex" : "hidden"} lg:flex flex-wrap gap-3 border-b border-line px-4 py-3.5 lg:px-6`}
      >
        <h1 className="w-full text-2xl font-bold lg:hidden">Cluster</h1>
        <div className="min-w-0 flex-[3_1_560px]">
          <ModelPanel model={cluster?.model ?? null} history={modelSeries} windowSeconds={panelWindowSeconds} headerExtra={chartRange} />
        </div>
        <div className="min-w-0 flex-[2_1_420px]">
          <NodePanel nodes={cluster?.nodes ?? null} limits={cluster?.limits} />
        </div>
      </section>
      <div className="flex min-h-0 flex-1 flex-col pb-[84px] lg:flex-row lg:pb-0">
        <nav
          aria-label="Delegations"
          className={`${selected !== null || address.section === "cluster" || address.section === "history" ? "hidden lg:flex" : "flex"} min-w-0 flex-col gap-3 px-4 py-4 lg:w-[420px] lg:max-w-[460px] lg:flex-none lg:overflow-y-auto lg:border-r lg:border-line lg:pl-6`}
        >
          <DelegationList
            list={list}
            selected={selected}
            onOpen={(name) => go({ ...address, selected: name, section: "list" }, true)}
            filter={address.filter}
            onFilterChange={(filter) => go({ ...address, filter }, false)}
            searchOpen={searchOpen}
          />
        </nav>
        <main
          className={`${selected !== null || address.section === "history" ? "flex" : "hidden lg:flex"} min-w-0 flex-col px-4 pb-4 lg:flex-[999_1_560px] lg:overflow-y-auto lg:px-6`}
        >
          {/* The Delegation / History tab switch, on a wide screen; a phone uses the bottom bar. */}
          <div className="hidden lg:flex flex-wrap items-center gap-3 pb-4">
            <div className="flex gap-1">
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  go({ ...address, section: "list" }, true);
                }}
                aria-current={address.section === "list" ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${address.section === "list" ? "bg-line font-semibold text-text" : "text-muted hover:bg-line/50"}`}
              >
                Delegation
              </a>
              <a
                href="/history"
                onClick={(e) => {
                  e.preventDefault();
                  go({ ...address, section: "history", selected: null }, true);
                }}
                aria-current={address.section === "history" ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${address.section === "history" ? "bg-line font-semibold text-text" : "text-muted hover:bg-line/50"}`}
              >
                History
              </a>
            </div>
          </div>
          {address.section === "history" ? (
            <HistoryPage />
          ) : selected === null ? (
            <p className="text-muted">Choose a delegation on the left to follow it.</p>
          ) : (
            <StreamPage key={selected} name={selected} onClose={() => go({ ...address, selected: null }, true)} />
          )}
        </main>
      </div>
      {selected === null && (
        <nav
          aria-label="Sections"
          className="fixed inset-x-0 bottom-0 z-20 grid h-[68px] grid-cols-3 border-t border-line bg-card lg:hidden"
        >
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              go({ ...address, section: "list", selected: null }, true);
            }}
            aria-current={address.section === "list" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 text-sm ${address.section === "list" ? "text-accent font-semibold" : "text-muted"}`}
          >
            <List size={20} aria-hidden="true" />
            Delegations
          </a>
          <a
            href="/cluster"
            onClick={(e) => {
              e.preventDefault();
              go({ ...address, section: "cluster", selected: null }, true);
            }}
            aria-current={address.section === "cluster" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 text-sm ${address.section === "cluster" ? "text-accent font-semibold" : "text-muted"}`}
          >
            <Gauge size={20} aria-hidden="true" />
            Cluster
          </a>
          <a
            href="/history"
            onClick={(e) => {
              e.preventDefault();
              go({ ...address, section: "history", selected: null }, true);
            }}
            aria-current={address.section === "history" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 text-sm ${address.section === "history" ? "text-accent font-semibold" : "text-muted"}`}
          >
            <History size={20} aria-hidden="true" />
            History
          </a>
        </nav>
      )}
    </div>
  );
}
