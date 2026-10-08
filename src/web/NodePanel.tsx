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
  return n === null ? "—" : `${Math.round(n)}°C`;
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
  const pct = value === null ? null : Math.round(value);
  const lvl = limits === undefined ? null : level(pct, warn, hot);
  const ringClass = lvl === null ? "text-muted" : LEVEL_TEXT[lvl];
  const filled = pct === null ? 0 : (Math.min(100, Math.max(0, pct)) / 100) * RING_C;
  const label = pct === null ? `${caption} use unknown` : `${caption} use ${pct.toLocaleString()} percent`;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="64" height="64" viewBox="0 0 54 54" role="img" aria-label={label}>
        <circle cx="27" cy="27" r="22" fill="none" stroke="currentColor" strokeWidth="6"
          className={pct === null ? "text-line" : `${ringClass} opacity-25`} />
        {pct !== null && (
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
          {percent(pct)}
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
  // A temperature in a full ring the size of a donut, coloured by heat, so the four sit as equals.
  const temp = (caption: "CPU" | "GPU", value: number | null) => {
    const degrees = value === null ? null : Math.round(value);
    const warn = limits?.tempWarn ?? 0;
    const hot = limits?.tempHot ?? 0;
    const lvl = limits === undefined ? null : level(degrees, warn, hot);
    const color = lvl === null ? "text-muted" : LEVEL_TEXT[lvl];
    return (
      <div className="flex flex-col items-center gap-1">
        <span aria-label={`${node.name} ${caption} temperature`} className={color}>
          <svg width="64" height="64" viewBox="0 0 54 54" aria-hidden="true">
            {degrees === null ? (
              <circle cx="27" cy="27" r="22" fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
            ) : (
              <circle data-ring cx="27" cy="27" r="22" fill="none" stroke="currentColor" strokeWidth="6" className="opacity-60" />
            )}
            <text x="27" y="31.5" textAnchor="middle" className="fill-current font-mono text-[13px] text-text">
              {celsius(degrees)}
            </text>
          </svg>
        </span>
        <span className="text-xs text-muted">{caption} temp</span>
      </div>
    );
  };
  return (
    <li>
      <h3 className="font-semibold">{node.name}</h3>
      <div className="mt-2 flex items-center gap-3">
        {/* The GPU does the model's work, so its use and heat lead, then the CPU's. A
            temperature sits like a donut: the figure on top, its caption below. */}
        <Donut caption="GPU" value={node.gpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        {temp("GPU", node.gpuTempC)}
        <Donut caption="CPU" value={node.cpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        {temp("CPU", node.cpuTempC)}
      </div>
      {node.status !== "ok" && (
        <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
      )}
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
  // One "as of" for the whole panel: the newest healthy read. A healthy node shows no line of
  // its own; an unreachable or host-key-failing node keeps its own.
  const newestReadAt =
    nodes === null
      ? null
      : nodes.reduce((newest: string | null, node) => {
          if (node.status !== "ok" || node.readAt === null) return newest;
          if (newest === null || Date.parse(node.readAt) > Date.parse(newest)) return node.readAt;
          return newest;
        }, null);
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Nodes</h2>
        {newestReadAt !== null && (
          <span className="text-xs text-muted">as of {localTime(newestReadAt)}</span>
        )}
      </div>
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
