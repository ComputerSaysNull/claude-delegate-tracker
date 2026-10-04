// The model server's figures, as the backend sends them on the cluster event.
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

function decodeLine(model: ModelFigures): string {
  if (model.decodeTokensPerSecond === null) return "—";
  const span = model.decodeWindowSeconds === null ? "—" : model.decodeWindowSeconds.toLocaleString();
  return `${model.decodeTokensPerSecond.toLocaleString()} tokens/s over ${span}s`;
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

interface Row {
  label: string;
  value: string;
  note?: string;
  spark?: string; // history key for a sparkline under this row
}

function figuresRows(model: ModelFigures): Row[] {
  const rows: Row[] = [
    { label: "Requests running", value: num(model.running), spark: "running" },
    { label: "Requests waiting", value: num(model.waiting) },
    { label: "KV-cache use", value: percent(model.kvCachePercent), spark: "kvCachePercent" },
    { label: "Decode speed", value: decodeLine(model), spark: "decodeTokensPerSecond" },
    { label: "Prefix-cache hits", value: percent(model.prefixHitPercent), note: "since the engine started" },
  ];
  if (model.preemptions !== null) rows.push({ label: "Preemptions", value: num(model.preemptions) });
  return rows;
}

export function ModelPanel({
  model,
  history,
  windowSeconds,
}: {
  model: ModelFigures | null;
  history?: Series;
  windowSeconds?: number;
}) {
  return (
    <section className="mt-6 rounded-lg border border-line p-4">
      <h2 className="text-lg font-semibold">Model server</h2>
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
  const status = statusLine(model);
  const span = windowSeconds ?? 3600;
  return (
    <>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {figuresRows(model).map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <p className={SLATE}>
              <span>{row.label}: </span>
              <span className="font-mono tabular-nums">{row.value}</span>
              {row.note !== undefined && <span className="text-xs"> {row.note}</span>}
            </p>
            {row.spark !== undefined && history !== undefined && (
              <Sparkline data={toUplotData(history, row.spark)} label={`${row.label} over the ${windowLabel(span)}`} />
            )}
          </div>
        ))}
      </div>
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </>
  );
}
