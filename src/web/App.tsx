// Shows the tracker's backend health and the live delegation list.
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

  const pathname = window.location.pathname;
  const streamName = pathname.startsWith("/s/") ? decodeURIComponent(pathname.slice(3)) : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 text-base">
      <h1 className="text-2xl font-bold">Delegation tracker</h1>
      <HealthBanners banners={health?.banners ?? []} />
      {streamName !== null ? (
        <StreamPage key={streamName} name={streamName} />
      ) : (
        <>
          <section className="mt-6 rounded-lg border border-line p-4">
            <h2 className="text-lg font-semibold">Health</h2>
            <p className="mt-2">
              Transcript folder: <span className={statusClass}>{status ?? "—"}</span>
            </p>
            <p className="mt-1">
              Checked at{" "}
              <span className="font-mono tabular-nums">{localTime(health?.checkedAt ?? null)}</span>
            </p>
          </section>
          <ModelPanel model={cluster?.model ?? null} history={history?.model} windowSeconds={history?.windowSeconds} />
          <NodePanel nodes={cluster?.nodes ?? null} histories={histories} windowSeconds={history?.windowSeconds} />
          {!connected && list !== null && (
            <p className="mt-4 rounded border border-warn bg-warn/10 px-3 py-2 text-sm text-warn">
              Live updates paused; reconnecting…
            </p>
          )}
          <DelegationList list={list} />
        </>
      )}
    </div>
  );
}
