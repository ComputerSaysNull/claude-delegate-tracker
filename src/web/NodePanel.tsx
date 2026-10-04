// The nodes' figures, as the backend sends them on the cluster event.
import type { NodeFigures } from "../server/nodes.ts";

const SLATE = "text-slate-500 dark:text-slate-400";
const AMBER = "text-amber-600 dark:text-amber-400";
const RED = "text-red-600 dark:text-red-400";

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
}

function nodeRows(node: NodeFigures): Row[] {
  return [
    {
      label: "CPU use",
      value: percent(node.cpuPercent),
      note: node.cpuWindowSeconds === null ? undefined : `over ${node.cpuWindowSeconds.toLocaleString()}s`,
    },
    { label: "CPU temperature", value: celsius(node.cpuTempC) },
    { label: "GPU use", value: percent(node.gpuPercent) },
    { label: "GPU temperature", value: celsius(node.gpuTempC) },
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
        : { text: `as of ${new Date(node.readAt).toLocaleTimeString()}`, color: SLATE };
    case "unreachable":
      return node.readAt === null
        ? { text: "Unreachable; no figures yet", color: AMBER }
        : { text: `Unreachable; no figures since ${new Date(node.readAt).toLocaleTimeString()}`, color: AMBER };
    case "host key refused":
      return { text: "Host key does not match the pinned key; figures refused", color: RED };
  }
}

function NodeBlock({ node }: { node: NodeFigures }) {
  const status = statusLine(node);
  return (
    <li className="rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <h3 className="font-medium">{node.name}</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {nodeRows(node).map((row) => (
          <p key={row.label} className={SLATE}>
            <span>{row.label}: </span>
            <span>{row.value}</span>
            {row.note !== undefined && <span className="text-xs"> {row.note}</span>}
          </p>
        ))}
      </div>
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </li>
  );
}

export function NodePanel({ nodes }: { nodes: NodeFigures[] | null }) {
  return (
    <section className="mt-6 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <h2 className="text-lg font-semibold">Nodes</h2>
      {nodes === null ? (
        <p className="mt-2 text-slate-500 dark:text-slate-400">Waiting for figures…</p>
      ) : nodes.length === 0 ? (
        <p className="mt-2 text-slate-500 dark:text-slate-400">No nodes configured (NODES is not set)</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {nodes.map((node) => (
            <NodeBlock key={node.name} node={node} />
          ))}
        </ul>
      )}
    </section>
  );
}
