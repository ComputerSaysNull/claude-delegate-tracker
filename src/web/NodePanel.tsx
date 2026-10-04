// The nodes' figures, as the backend sends them on the cluster event.
import type { NodeFigures } from "../server/nodes.ts";
import type { Series } from "../server/history.ts";
import { localTime } from "./time.ts";
import { Sparkline, windowLabel } from "./Sparkline.tsx";
import { toUplotData } from "./sparkData.ts";

const SLATE = "text-muted";
const AMBER = "text-warn";
const RED = "text-hot";

function percent(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString()}%`;
}

function celsius(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString()} °C`;
}

interface Row {
  label: string;
  value: string;
  note?: string;
  spark?: string; // history key for a sparkline under this row
}

function nodeRows(node: NodeFigures): Row[] {
  return [
    {
      label: "CPU use",
      value: percent(node.cpuPercent),
      note: node.cpuWindowSeconds === null ? undefined : `over ${node.cpuWindowSeconds.toLocaleString()}s`,
      spark: "cpuPercent",
    },
    { label: "CPU temperature", value: celsius(node.cpuTempC), spark: "cpuTempC" },
    { label: "GPU use", value: percent(node.gpuPercent), spark: "gpuPercent" },
    { label: "GPU temperature", value: celsius(node.gpuTempC), spark: "gpuTempC" },
  ];
}

interface StatusLine {
  text: string;
  color: string;
}

function statusLine(node: NodeFigures): StatusLine {
  switch (node.status) {
    case "ok":
      return node.readAt === null
        ? { text: "as of —", color: SLATE }
        : { text: `as of ${localTime(node.readAt)}`, color: SLATE };
    case "unreachable":
      return node.readAt === null
        ? { text: "Unreachable; no figures yet", color: AMBER }
        : { text: `Unreachable; no figures since ${localTime(node.readAt)}`, color: AMBER };
    case "host key refused":
      return { text: "Host key does not match the pinned key; figures refused", color: RED };
  }
}

function NodeBlock({
  node,
  history,
  windowSeconds,
}: {
  node: NodeFigures;
  history?: Series;
  windowSeconds?: number;
}) {
  const status = statusLine(node);
  const span = windowSeconds ?? 3600;
  return (
    <li className="rounded-lg border border-line p-4">
      <h3 className="font-medium">{node.name}</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {nodeRows(node).map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <p className={SLATE}>
              <span>{row.label}: </span>
              <span className="font-mono tabular-nums">{row.value}</span>
              {row.note !== undefined && <span className="font-mono tabular-nums text-xs"> {row.note}</span>}
            </p>
            {row.spark !== undefined && history !== undefined && (
              <Sparkline data={toUplotData(history, row.spark)} label={`${row.label} over the ${windowLabel(span)}`} />
            )}
          </div>
        ))}
      </div>
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </li>
  );
}

export function NodePanel({
  nodes,
  histories,
  windowSeconds,
}: {
  nodes: NodeFigures[] | null;
  histories?: Record<string, Series>;
  windowSeconds?: number;
}) {
  return (
    <section className="rounded-lg border border-line p-4">
      <h2 className="text-lg font-semibold">Nodes</h2>
      {nodes === null ? (
        <p className="mt-2 text-muted">Waiting for figures…</p>
      ) : nodes.length === 0 ? (
        <p className="mt-2 text-muted">No nodes configured (NODES is not set)</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {nodes.map((node) => (
            <NodeBlock
              key={node.name}
              node={node}
              history={histories?.[node.name]}
              windowSeconds={windowSeconds}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
