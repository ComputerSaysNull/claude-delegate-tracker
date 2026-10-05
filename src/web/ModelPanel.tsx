// The model server's figures, as the backend sends them on the cluster event.
import type { ReactNode } from "react";
import type { ModelFigures } from "../server/metrics.ts";
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
}: {
  model: ModelFigures | null;
  history?: Series;
  windowSeconds?: number;
  headerExtra?: ReactNode;
}) {
  const status = model === null ? null : statusLine(model);
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Model server</h2>
        {status !== null && <span className={`text-xs ${status.color}`}>{status.text}</span>}
        {headerExtra !== undefined && <div className="ml-auto">{headerExtra}</div>}
      </div>
      {model === null ? (
        <p className="mt-2 text-muted">Waiting for figures…</p>
      ) : (
        <ModelFiguresBody model={model} history={history} windowSeconds={windowSeconds} />
      )}
    </section>
  );
}

function ModelFiguresBody({
  model,
  history,
  windowSeconds,
}: {
  model: ModelFigures;
  history?: Series;
  windowSeconds?: number;
}) {
  const span = windowSeconds ?? 3600;
  const valueClass = "font-mono tabular-nums text-2xl font-medium";
  return (
    <>
      <ul aria-label="Model server figures" className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        <li className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted">Decode speed</span>
          <div className="flex items-baseline gap-1.5">
            <span className={valueClass}>{num(model.decodeTokensPerSecond)}</span>
            <span className="text-[13px] text-muted">tok/s</span>
          </div>
          {model.decodeWindowSeconds !== null && (
            <span className="text-xs text-muted">
              <span className="font-mono tabular-nums">over {model.decodeWindowSeconds.toLocaleString()}s</span>
            </span>
          )}
          {history !== undefined && (
            <Sparkline data={toUplotData(history, "decodeTokensPerSecond")} label={`Decode speed over the ${windowLabel(span)}`} />
          )}
        </li>
        <li className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted">Requests</span>
          <div className="flex items-baseline gap-1.5">
            <span className={valueClass}>{num(model.running)}</span>
            <span className="text-[13px] text-muted">running</span>
            <span className="text-[13px] text-muted">
              <span className="font-mono tabular-nums">{num(model.waiting)}</span> waiting
            </span>
          </div>
          {history !== undefined && (
            <Sparkline data={toUplotData(history, "running")} label={`Requests over the ${windowLabel(span)}`} />
          )}
        </li>
        <li className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted">KV-cache use</span>
          <div className="flex items-baseline gap-1.5">
            <span className={valueClass}>{percent(model.kvCachePercent)}</span>
          </div>
          {history !== undefined && (
            <Sparkline data={toUplotData(history, "kvCachePercent")} label={`KV-cache use over the ${windowLabel(span)}`} />
          )}
        </li>
        <li className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted">Prefix-cache hits</span>
          <div className="flex items-baseline gap-1.5">
            <span className={valueClass}>{percent(model.prefixHitPercent)}</span>
          </div>
          <span className="text-xs text-muted">since the engine started</span>
        </li>
      </ul>
      {model.preemptions !== null && (
        <p className="mt-2 text-xs text-muted">
          Preemptions <span className="font-mono tabular-nums">{model.preemptions.toLocaleString()}</span>
        </p>
      )}
    </>
  );
}
