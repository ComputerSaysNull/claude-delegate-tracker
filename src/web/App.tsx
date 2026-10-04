// The page frame: the tracker's backend health in the header, the cluster figures across
// the top, the live delegation list on the left and the open delegation on the right on a
// wide screen, one of the two on a phone. Opening a delegation never reloads the page.
import { useState } from "react";
import { Check, CircleDot, TriangleAlert, X } from "lucide-react";
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

  // The header's health pill: ok, or what is wrong with the transcript folder.
  const healthPill =
    status === "readable" && (health?.banners.length ?? 0) === 0
      ? { text: "Health ok", tone: "border-state-ok/40 text-state-ok", Icon: Check }
      : status === "not readable"
        ? { text: "Folder not readable", tone: "border-hot/50 text-hot", Icon: X }
        : status === "not set"
          ? { text: "Folder not set", tone: "border-warn/50 text-warn", Icon: TriangleAlert }
          : status === "readable"
            ? { text: "Check the banners", tone: "border-warn/50 text-warn", Icon: TriangleAlert }
            : null;

  const [selected, setSelected] = useState<string | null>(() => {
    const pathname = window.location.pathname;
    return pathname.startsWith("/s/") ? decodeURIComponent(pathname.slice(3)) : null;
  });

  return (
    <div className="flex min-h-screen flex-col text-base lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 lg:px-6">
        <CircleDot size={20} className="text-accent" aria-hidden="true" />
        <h1 className="text-[17px] font-semibold">Delegation tracker</h1>
        <div className="flex-1" />
        <span
          role="status"
          aria-label="Live updates"
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${connected ? "border-line text-muted" : "border-warn/50 text-warn"}`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-state-ok" : "bg-warn"}`} aria-hidden="true" />
          {connected ? "Live" : "Reconnecting…"}
          <span className="font-mono tabular-nums text-text">{localTime(health?.checkedAt ?? null)}</span>
        </span>
        {healthPill !== null && (
          <span role="status" aria-label="Health" className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${healthPill.tone}`}>
            <healthPill.Icon size={14} aria-hidden="true" />
            {healthPill.text}
          </span>
        )}
      </header>
      <div className="px-4 lg:px-6">
        <HealthBanners banners={health?.banners ?? []} />
      </div>
      <section aria-label="Cluster" className="flex flex-wrap gap-3 border-b border-line px-4 py-3.5 lg:px-6">
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
          className={`${selected === null ? "flex" : "hidden lg:flex"} min-w-0 flex-col gap-3 px-4 py-4 lg:max-w-[460px] lg:flex-[1_1_340px] lg:overflow-y-auto lg:border-r lg:border-line lg:pl-6`}
        >
          <DelegationList list={list} selected={selected} onOpen={setSelected} />
        </nav>
        <main
          className={`${selected === null ? "hidden lg:flex" : "flex"} min-w-0 flex-col px-4 py-4 lg:flex-[999_1_560px] lg:overflow-y-auto lg:px-6`}
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
