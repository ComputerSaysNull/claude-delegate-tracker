// The model server's figures, as the backend sends them on the cluster event.
import type { ModelFigures } from "../server/metrics.ts";
import { localTime } from "./time.ts";

const SLATE = "text-slate-500 dark:text-slate-400";
const AMBER = "text-amber-600 dark:text-amber-400";

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
}

function figuresRows(model: ModelFigures): Row[] {
  const rows: Row[] = [
    { label: "Requests running", value: num(model.running) },
    { label: "Requests waiting", value: num(model.waiting) },
    { label: "KV-cache use", value: percent(model.kvCachePercent) },
    { label: "Decode speed", value: decodeLine(model) },
    { label: "Prefix-cache hits", value: percent(model.prefixHitPercent), note: "since the engine started" },
  ];
  if (model.preemptions !== null) rows.push({ label: "Preemptions", value: num(model.preemptions) });
  return rows;
}

export function ModelPanel({ model }: { model: ModelFigures | null }) {
  return (
    <section className="mt-6 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <h2 className="text-lg font-semibold">Model server</h2>
      {model === null ? (
        <p className="mt-2 text-slate-500 dark:text-slate-400">Waiting for figures…</p>
      ) : (
        <ModelFiguresBody model={model} />
      )}
    </section>
  );
}

function ModelFiguresBody({ model }: { model: ModelFigures }) {
  const status = statusLine(model);
  return (
    <>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {figuresRows(model).map((row) => (
          <p key={row.label} className={SLATE}>
            <span>{row.label}: </span>
            <span>{row.value}</span>
            {row.note !== undefined && <span className="text-xs"> {row.note}</span>}
          </p>
        ))}
      </div>
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </>
  );
}
