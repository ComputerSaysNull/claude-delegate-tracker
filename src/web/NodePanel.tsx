// The nodes' figures, as the backend sends them on the cluster event.
import type { NodeFigures } from "../server/nodes.ts";
import type { Series } from "../server/history.ts";
import type { Limits } from "../server/settings.ts";
import { LEVEL_TEXT, level } from "./load.ts";
import { localTime } from "./time.ts";
import { Sparkline, windowLabel } from "./Sparkline.tsx";
import { toUplotData } from "./sparkData.ts";

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

// The figures over time, one small chart each, under the at-a-glance grid.
const CHARTS = [
  { key: "cpuPercent", label: "CPU use" },
  { key: "cpuTempC", label: "CPU temperature" },
  { key: "gpuPercent", label: "GPU use" },
  { key: "gpuTempC", label: "GPU temperature" },
] as const;

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

// A temperature as a number, coloured by heat.
function Temperature({
  nodeName,
  caption,
  value,
  warn,
  hot,
  limits,
}: {
  nodeName: string;
  caption: "CPU" | "GPU";
  value: number | null;
  warn: number;
  hot: number;
  limits?: Limits;
}) {
  const lvl = limits === undefined ? null : level(value, warn, hot);
  const color = lvl === "warn" || lvl === "hot" ? ` ${LEVEL_TEXT[lvl]}` : "";
  return (
    <div className="flex flex-col items-center gap-1">
      <span aria-label={`${nodeName} ${caption} temperature`} className={`font-mono tabular-nums text-xl${color}`}>
        {celsius(value)}
      </span>
      <p className="text-xs text-muted">{caption} temp</p>
    </div>
  );
}

function NodeBlock({
  node,
  history,
  windowSeconds,
  limits,
}: {
  node: NodeFigures;
  history?: Series;
  windowSeconds?: number;
  limits?: Limits;
}) {
  const status = statusLine(node);
  const span = windowSeconds ?? 3600;
  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{node.name}</h3>
        {node.cpuWindowSeconds !== null && (
          <span className="text-xs text-muted">
            CPU <span className="font-mono tabular-nums">over {node.cpuWindowSeconds.toLocaleString()}s</span>
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 items-center gap-2 text-center">
        <Donut caption="CPU" value={node.cpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        <Donut caption="GPU" value={node.gpuPercent} warn={limits?.loadWarn ?? 0} hot={limits?.loadHot ?? 0} limits={limits} />
        <Temperature nodeName={node.name} caption="CPU" value={node.cpuTempC} warn={limits?.tempWarn ?? 0} hot={limits?.tempHot ?? 0} limits={limits} />
        <Temperature nodeName={node.name} caption="GPU" value={node.gpuTempC} warn={limits?.tempWarn ?? 0} hot={limits?.tempHot ?? 0} limits={limits} />
      </div>
      {history !== undefined && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {CHARTS.map((chart) => (
            <div key={chart.key} className="flex flex-col gap-0.5">
              <p className={SLATE}>{chart.label}</p>
              <Sparkline data={toUplotData(history, chart.key)} label={`${chart.label} over the ${windowLabel(span)}`} />
            </div>
          ))}
        </div>
      )}
      <p className={`mt-2 text-sm ${status.color}`}>{status.text}</p>
    </li>
  );
}

export function NodePanel({
  nodes,
  histories,
  windowSeconds,
  limits,
}: {
  nodes: NodeFigures[] | null;
  histories?: Record<string, Series>;
  windowSeconds?: number;
  limits?: Limits;
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
              limits={limits}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
