// The nodes' figures, as the backend sends them on the cluster event.
import type { NodeFigures } from "../server/nodes.ts";
import type { Limits } from "../server/settings.ts";
import { LEVEL_TEXT, level } from "./load.ts";
import { localTime } from "./time.ts";

const SLATE = "text-muted";
const AMBER = "text-warn";
const RED = "text-hot";

const RING_RADIUS = 22;
const RING_C = 2 * Math.PI * RING_RADIUS;

function percent(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString()}%`;
}

function celsius(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString()} °C`;
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

// A donut for one use figure: the ring coloured by load, the number in the middle.
function Donut({
  caption,
  value,
  warn,
  hot,
  limits,
}: {
  caption: "CPU" | "GPU";
  value: number | null;
  warn: number;
  hot: number;
  limits?: Limits;
}) {
  const lvl = limits === undefined ? null : level(value, warn, hot);
  const ringClass = lvl === null ? "text-muted" : LEVEL_TEXT[lvl];
  const filled = value === null ? 0 : (Math.min(100, Math.max(0, value)) / 100) * RING_C;
  const label = value === null ? `${caption} use unknown` : `${caption} use ${value.toLocaleString()} percent`;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="64" height="64" viewBox="0 0 54 54" role="img" aria-label={label}>
        <circle cx="27" cy="27" r="22" fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
        {value !== null && (
          <circle
            data-ring
            cx="27"
            cy="27"
            r="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${RING_C}`}
            transform="rotate(-90 27 27)"
            className={ringClass}
          />
        )}
        <text x="27" y="31.5" textAnchor="middle" className="fill-current font-mono text-[13px]">
          {percent(value)}
        </text>
      </svg>
      <p className="text-xs text-muted">{caption}</p>
    </div>
  );
}

function NodeBlock({
  node,
  limits,
}: {
  node: NodeFigures;
  limits?: Limits;
}) {
  const status = statusLine(node);
  const temp = (caption: "CPU" | "GPU", value: number | null) => {
    const warn = limits?.tempWarn ?? 0;
    const hot = limits?.tempHot ?? 0;
    const lvl = limits === undefined ? null : level(value, warn, hot);
    const color = lvl === "warn" || lvl === "hot" ? ` ${LEVEL_TEXT[lvl]}` : "";
    return (
      <span aria-label={`${node.name} ${caption} temperature`} className={`font-mono tabular-nums text-xl${color}`}>
        {celsius(value)}
      </span>
    );
  };
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{node.name}</h3>
        {node.cpuWindowSeconds !== null && (
          <span className="text-xs text-muted">
            CPU <span className="font-mono tabular-nums">over {node.cpuWindowSeconds.toLocaleString()}s</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Donut caption="CPU" value={node.cpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        <Donut caption="GPU" value={node.gpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted">CPU</span> {temp("CPU", node.cpuTempC)}
          </p>
          <p>
            <span className="text-muted">GPU</span> {temp("GPU", node.gpuTempC)}
          </p>
        </div>
      </div>
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </li>
  );
}

export function NodePanel({
  nodes,
  limits,
}: {
  nodes: NodeFigures[] | null;
  limits?: Limits;
}) {
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Nodes</h2>
      {nodes === null ? (
        <p className="mt-2 text-muted">Waiting for figures…</p>
      ) : nodes.length === 0 ? (
        <p className="mt-2 text-muted">No nodes configured (NODES is not set)</p>
      ) : (
        <ul aria-label="Nodes" className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {nodes.map((node) => (
            <NodeBlock key={node.name} node={node} limits={limits} />
          ))}
        </ul>
      )}
    </section>
  );
}
