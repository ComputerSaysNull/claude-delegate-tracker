// Shows the tracker's backend health and the live delegation list.
import { DelegationList } from "./DelegationList.tsx";
import { HealthBanners } from "./HealthBanners.tsx";
import { ModelPanel } from "./ModelPanel.tsx";
import { NodePanel } from "./NodePanel.tsx";
import { StreamPage } from "./StreamPage.tsx";
import { useLiveList } from "./useLiveList.ts";
import { localTime } from "./time.ts";

type Status = "readable" | "not readable" | "not set";

export default function App() {
  const { list, cluster, health, connected } = useLiveList();

  const status: Status | null = health
    ? health.transcriptFolder.configured
      ? health.transcriptFolder.readable
        ? "readable"
        : "not readable"
      : "not set"
    : null;

  const statusClass =
    status === "readable"
      ? "text-green-600 dark:text-green-400"
      : status === "not readable"
        ? "text-red-600 dark:text-red-400"
        : status === "not set"
          ? "text-amber-600 dark:text-amber-400"
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
          <section className="mt-6 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
            <h2 className="text-lg font-semibold">Health</h2>
            <p className="mt-2">
              Transcript folder: <span className={statusClass}>{status ?? "—"}</span>
            </p>
            <p className="mt-1">
              Checked at{" "}
              {localTime(health?.checkedAt ?? null)}
            </p>
          </section>
          <ModelPanel model={cluster?.model ?? null} />
          <NodePanel nodes={cluster?.nodes ?? null} />
          {!connected && list !== null && (
            <p className="mt-4 rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm text-amber-700 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-300">
              Live updates paused; reconnecting…
            </p>
          )}
          <DelegationList list={list} />
        </>
      )}
    </div>
  );
}
