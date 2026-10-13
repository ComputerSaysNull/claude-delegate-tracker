// The model server's figures, as the backend sends them on the cluster event.
import type { ReactNode } from "react";
import type { ModelFigures, DecodeNow } from "../server/metrics.ts";
import type { Series } from "../server/history.ts";
import { localTime } from "./time.ts";
import { Sparkline, windowLabel } from "./Sparkline.tsx";
import { toUplotData } from "./sparkData.ts";

const SLATE = "text-muted";
const AMBER = "text-warn";

function num(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

function percent(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString()}%`;
}

interface StatusLine {
  text: string;
  color: string;
}

function statusLine(model: ModelFigures): StatusLine {
  switch (model.status) {
    case "ok":
      return {
        text: model.readAt === null ? "as of —" : `as of ${localTime(model.readAt)}`,
        color: SLATE,
      };
    case "unreachable":
      return {
        text:
          model.readAt === null
            ? "Unreachable; no figures yet"
            : `Unreachable; no figures since ${localTime(model.readAt)}`,
        color: AMBER,
      };
    case "not available":
      return { text: "/metrics is not available (404)", color: AMBER };
    case "not configured":
      return { text: "METRICS_URL is not set", color: SLATE };
  }
}

export function ModelPanel({
  model,
  history,
  windowSeconds,
  headerExtra,
  decode,
}: {
  model: ModelFigures | null;
  history?: Series;
  windowSeconds?: number;
  headerExtra?: ReactNode;
  decode?: DecodeNow | null;
}) {
  const status = model === null ? null : statusLine(model);
  return (
    <section className="@container h-full rounded-xl border border-line bg-card p-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Model server</h2>
        {status !== null && <span className={`text-xs ${status.color}`}>{status.text}</span>}
        {headerExtra !== undefined && <div className="ml-auto">{headerExtra}</div>}
      </div>
      {model === null ? (
        <p className="mt-2 text-muted">Waiting for figures…</p>
      ) : (
        <ModelFiguresBody model={model} history={history} windowSeconds={windowSeconds} decode={decode} />
      )}
    </section>
  );
}

// One figure: its label, then on one line the number with its unit or caption, and its chart
// beside it when it has a history, so the card stays short.
function Figure({ label, value, unit, chart }: { label: string; value: string; unit: ReactNode; chart?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-mono tabular-nums text-2xl font-medium">{value}</span>
          {unit}
        </div>
        {chart !== undefined && <div className="min-w-0 flex-1">{chart}</div>}
      </div>
    </li>
  );
}

function ModelFiguresBody({
  model,
  history,
  windowSeconds,
  decode,
}: {
  model: ModelFigures;
  history?: Series;
  windowSeconds?: number;
  decode?: DecodeNow | null;
}) {
  const span = windowSeconds ?? 3600;
  const unitClass = "text-[13px] text-muted";
  const captionClass = "text-xs text-muted";
  // The live decode event, when one has arrived and the model is ok, replaces the figure
  // from the last full reading; the sparkline stays on the full cadence.
  const live = decode !== null && decode !== undefined && model.status === "ok";
  const decodeValue = live ? decode.tokensPerSecond : model.decodeTokensPerSecond;
  const chart = (key: string, label: string, fixed?: [number, number]) =>
    history === undefined ? undefined : (
      <Sparkline data={toUplotData(history, key)} label={`${label} over the ${windowLabel(span)}`} fixed={fixed} />
    );
  return (
    <>
      <ul aria-label="Model server figures" className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-2 @2xl:grid-cols-3">
        <Figure
          label="Decode speed"
          value={num(decodeValue)}
          unit={<span className={unitClass}>tok/s</span>}
          chart={chart("decodeTokensPerSecond", "Decode speed")}
        />
        <Figure
          label="Prefill speed"
          value={num(model.prefillTokensPerSecond)}
          unit={<span className={unitClass}>tok/s</span>}
          chart={chart("prefillTokensPerSecond", "Prefill speed")}
        />
        <Figure
          label="Requests"
          value={num(model.running)}
          unit={
            <>
              <span className={unitClass}>running</span>
              <span className={unitClass}>
                <span className="font-mono tabular-nums">{num(model.waiting)}</span> waiting
              </span>
            </>
          }
          chart={chart("running", "Requests")}
        />
        <Figure
          label="KV-cache use"
          value={percent(model.kvCachePercent)}
          unit={null}
          chart={chart("kvCachePercent", "KV-cache use", [0, 100])}
        />
        <Figure
          label="Prefix-cache hits"
          value={percent(model.prefixHitPercent)}
          unit={<span className={captionClass}>since the engine started</span>}
        />
        <Figure
          label="MTP acceptance"
          value={percent(model.mtpAcceptancePercent)}
          unit={<span className={captionClass}>drafted tokens accepted</span>}
        />
      </ul>
      {model.preemptions !== null && (
        <p className="mt-2 text-xs text-muted">
          Preemptions <span className="font-mono tabular-nums">{model.preemptions.toLocaleString()}</span>
        </p>
      )}
    </>
  );
}
