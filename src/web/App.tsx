// The page frame: the tracker's backend health in the header, the cluster figures across
// the top, the live delegation list on the left and the open delegation on the right on a
// wide screen, one of the two on a phone. Opening a delegation never reloads the page.
import { useState } from "react";
import { DelegationList } from "./DelegationList.tsx";
import { HealthBanners } from "./HealthBanners.tsx";
import { ModelPanel } from "./ModelPanel.tsx";
import { NodePanel } from "./NodePanel.tsx";
import { StreamPage } from "./StreamPage.tsx";
import { useClusterHistory } from "./useClusterHistory.ts";
import { useLiveList } from "./useLiveList.ts";
import { localTime } from "./time.ts";

type Status = "readable" | "not readable" | "not set";

export default function App() {
  const { list, cluster, health, connected } = useLiveList();
  const history = useClusterHistory(cluster);
  const histories =
    history === null
      ? undefined
      : Object.fromEntries(history.nodes.map((node) => [node.name, node.series] as const));

  const status: Status | null = health
    ? health.transcriptFolder.configured
      ? health.transcriptFolder.readable
        ? "readable"
        : "not readable"
      : "not set"
    : null;

  const statusClass =
    status === "readable"
      ? "text-state-ok"
      : status === "not readable"
        ? "text-hot"
        : status === "not set"
          ? "text-warn"
          : "";

  const [selected, setSelected] = useState<string | null>(() => {
    const pathname = window.location.pathname;
    return pathname.startsWith("/s/") ? decodeURIComponent(pathname.slice(3)) : null;
  });

  return (
    <div className="flex min-h-screen flex-col text-base">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-4 py-3 lg:px-6">
        <h1 className="text-2xl font-bold">Delegation tracker</h1>
        <div className="flex-1" />
        <p className="text-sm">
          Transcript folder: <span className={statusClass}>{status ?? "—"}</span>
        </p>
        <p className="text-sm">
          Checked at{" "}
          <span className="font-mono tabular-nums">{localTime(health?.checkedAt ?? null)}</span>
        </p>
      </header>
      <div className="px-4 lg:px-6">
        <HealthBanners banners={health?.banners ?? []} />
      </div>
      <section aria-label="Cluster" className="flex flex-wrap gap-3 border-b border-line px-4 py-3 lg:px-6">
        <div className="min-w-0 flex-[3_1_560px]">
          <ModelPanel model={cluster?.model ?? null} history={history?.model} windowSeconds={history?.windowSeconds} />
        </div>
        <div className="min-w-0 flex-[2_1_420px]">
          <NodePanel nodes={cluster?.nodes ?? null} histories={histories} windowSeconds={history?.windowSeconds} />
        </div>
      </section>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Delegations"
          className={`${selected === null ? "flex" : "hidden lg:flex"} min-w-0 flex-col gap-3 px-4 py-4 lg:max-w-[460px] lg:flex-[1_1_340px] lg:border-r lg:border-line lg:pl-6`}
        >
          {!connected && list !== null && (
            <p className="rounded border border-warn bg-warn/10 px-3 py-2 text-sm text-warn">
              Live updates paused; reconnecting…
            </p>
          )}
          <DelegationList list={list} selected={selected} onOpen={setSelected} />
        </nav>
        <main
          className={`${selected === null ? "hidden lg:flex" : "flex"} min-w-0 flex-col px-4 py-4 lg:flex-[999_1_560px] lg:px-6`}
        >
          {selected === null ? (
            <p className="text-muted">Choose a delegation on the left to follow it.</p>
          ) : (
            <StreamPage key={selected} name={selected} onClose={() => setSelected(null)} />
          )}
        </main>
      </div>
    </div>
  );
}
