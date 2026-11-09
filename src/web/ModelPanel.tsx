// The model server's figures, as the backend sends them on the cluster event.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModelFigures, DecodeNow } from "../server/metrics.ts";
import type { Series } from "../server/history.ts";
import { localTime } from "./time.ts";
import { Sparkline, windowLabel } from "./Sparkline.tsx";
import { toUplotData } from "./sparkData.ts";
import { PlacedCard } from "./ChartTooltip.tsx";

const SLATE = "text-muted";
const AMBER = "text-warn";

function num(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

// A speed always carries one decimal, so a whole number ("41.0") is as wide as any other.
function rate(n: number | null): string {
  return n === null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
    case "no known figures":
      return { text: "/metrics has no figures this tracker reads", color: AMBER };
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
  rebuiltToday,
}: {
  model: ModelFigures | null;
  history?: Series;
  windowSeconds?: number;
  headerExtra?: ReactNode;
  decode?: DecodeNow | null;
  rebuiltToday?: number | null;
}) {
  const status = model === null ? null : statusLine(model);
  return (
    <section className="@container flex h-full flex-col rounded-xl border border-line bg-card p-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Model server</h2>
        {status !== null && <span className={`text-xs ${status.color}`}>{status.text}</span>}
        {headerExtra !== undefined && <div className="ml-auto">{headerExtra}</div>}
      </div>
      {model === null ? (
        <p className="mt-2 text-muted">Waiting for figures…</p>
      ) : (
        <ModelFiguresBody model={model} history={history} windowSeconds={windowSeconds} decode={decode} rebuiltToday={rebuiltToday} />
      )}
    </section>
  );
}

// One figure: its label, then on one line the number with its unit or caption, and its chart
// beside it when it has a history, so the card stays short. `minChars` keeps a number that
// changes every second at a fixed width, so its chart does not move as the digits change.
// `note` is a caption too long for the number's row, which cannot shrink: it gets its own
// line under the number, where it can wrap. `help` is a mark beside the label opening a card.
function Figure({ label, value, unit, chart, minChars, note, help }: { label: string; value: string; unit: ReactNode; chart?: ReactNode; minChars?: number; note?: ReactNode; help?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-[13px] text-muted">{label}{help}</span>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span
            className="font-mono tabular-nums text-2xl font-medium"
            style={minChars === undefined ? undefined : { minWidth: `${minChars}ch` }}
          >
            {value}
          </span>
          {unit}
        </div>
        {chart !== undefined && <div className="min-w-0 flex-1">{chart}</div>}
      </div>
      {note !== undefined && note !== null && <span className="text-xs text-muted">{note}</span>}
    </li>
  );
}

// A small ? beside a label: hover or focus shows its card, and a click pins it open until the
// next click, Escape, or a click elsewhere. The handlers sit on the wrapper, so moving onto the
// card does not close it.
function HelpMark({ label, title, rows, text }: { label: string; title: string; rows: { label: string; value: string }[]; text: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const open = hovered || pinned;
  const close = () => {
    setHovered(false);
    setPinned(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHovered(false);
      setPinned(false);
    };
    const onDown = (e: MouseEvent) => {
      if (pinned && wrap.current !== null && !wrap.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, pinned]);
  return (
    <span
      ref={wrap}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] leading-none text-muted hover:text-text focus-visible:outline focus-visible:outline-2"
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => {
          if (pinned) close();
          else setPinned(true);
        }}
      >
        ?
      </button>
      {open && (
        <PlacedCard at={0.5} below>
          <div role="tooltip" className="w-[17rem] whitespace-normal rounded-lg border border-line bg-card p-2 text-[12.5px] shadow">
            <div className="font-semibold">{title}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-1.5">
                  <span className="flex-1 text-muted">{r.label}</span>
                  <span className="font-mono tabular-nums font-semibold text-text">{r.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-muted">{text}</div>
          </div>
        </PlacedCard>
      )}
    </span>
  );
}

function ModelFiguresBody({
  model,
  history,
  windowSeconds,
  decode,
  rebuiltToday,
}: {
  model: ModelFigures;
  history?: Series;
  windowSeconds?: number;
  decode?: DecodeNow | null;
  rebuiltToday?: number | null;
}) {
  const span = windowSeconds ?? 3600;
  const unitClass = "text-[13px] text-muted";
  // The compact row's label and value, one line per figure without a chart.
  const compactLabelClass = "truncate text-[13px] text-muted";
  const compactValueClass = "whitespace-nowrap font-mono tabular-nums font-medium";
  // The live decode event, when one has arrived and the model is ok, replaces the figure
  // from the last full reading; the sparkline stays on the full cadence. The same event also
  // carries the speed of the last finished prompt, which the panel keeps until the next one.
  const live = decode !== null && decode !== undefined && model.status === "ok";
  const decodeValue = live ? decode.tokensPerSecond : model.decodeTokensPerSecond;
  const prefillValue = live ? decode.prefillTokensPerSecond : model.prefillTokensPerSecond;
  const chart = (key: string, label: string, fixed?: [number, number]) =>
    history === undefined ? undefined : (
      <Sparkline data={toUplotData(history, key)} label={`${label} over the ${windowLabel(span)}`} fixed={fixed} span={span} />
    );
  // The KV-cache lines: the kept share is labelled under the number, with the free room and
  // today's rebuilt prompts; only the rebuilt line for vLLM, which has no kept share. The same
  // figures fill the help card, which appears only when there is a kept share.
  const free = model.kvKeptPercent !== null && model.kvCachePercent !== null
    ? Math.max(0, Math.round((100 - model.kvCachePercent - model.kvKeptPercent) * 10) / 10)
    : null;
  const freePercent = free === null
    ? "—"
    : `${free.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const rebuiltLine = typeof rebuiltToday === "number" ? (
    <span className="block">
      <span className="font-mono tabular-nums">{rebuiltToday.toLocaleString()}</span>{" "}
      {rebuiltToday === 1 ? "prompt" : "prompts"} rebuilt today
    </span>
  ) : null;
  let kvNote: ReactNode = null;
  if (model.kvKeptPercent !== null) {
    kvNote = (
      <>
        <span className="block">reserved / kept prompts · <span className="font-mono tabular-nums">{freePercent}</span> free</span>
        {rebuiltLine}
      </>
    );
  } else if (rebuiltLine !== null) {
    kvNote = rebuiltLine;
  }
  const kvRows: { label: string; value: string }[] = [];
  if (model.kvCachePercent !== null) kvRows.push({ label: "Reserved by running requests", value: percent(model.kvCachePercent) });
  if (model.kvKeptPercent !== null) kvRows.push({ label: "Kept prompts", value: percent(model.kvKeptPercent) });
  if (free !== null) kvRows.push({ label: "Free", value: freePercent });
  if (typeof rebuiltToday === "number") kvRows.push({ label: "Rebuilt today", value: rebuiltToday.toLocaleString() });
  const kvHelp = model.kvKeptPercent !== null ? (
    <HelpMark
      label="About KV-cache use"
      title="KV-cache pool"
      rows={kvRows}
      text={
        "Reserved counts each running request's prompt plus its whole reply budget, booked when the request starts. Kept prompt states are saved so later turns can resume from them. When a new request needs more than the free room, the engine evicts kept states; a delegation whose state was evicted must rebuild its prompt from scratch on its next turn" +
        (typeof rebuiltToday === "number"
          ? ", which is what Rebuilt today counts (from delegations that finished today)."
          : ".")
      }
    />
  ) : undefined;
  return (
    <>
      <ul aria-label="Model server figures" className="mt-2 grid flex-1 grid-cols-1 content-evenly gap-x-6 gap-y-3 @md:grid-cols-2 @2xl:grid-cols-3">
        <Figure
          label="Decode speed"
          value={rate(decodeValue)}
          minChars={4}
          unit={<span className={unitClass}>tok/s</span>}
          chart={chart("decodeTokensPerSecond", "Decode speed")}
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
          value={model.kvKeptPercent === null
            ? percent(model.kvCachePercent)
            : `${percent(model.kvCachePercent)} / ${percent(model.kvKeptPercent)}`}
          unit={null}
          note={kvNote}
          help={kvHelp}
          chart={chart("kvCachePercent", "KV-cache use", [0, 100])}
        />
      </ul>
      <ul aria-label="Model server figures without a chart" className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line pt-2 @md:grid-cols-3">
        <li className="flex min-w-0 items-baseline justify-between gap-2">
          <span className={compactLabelClass}>Prefill · last prompt</span>
          <span className={compactValueClass}>
            {rate(prefillValue)} <span className="font-sans text-xs font-normal text-muted">tok/s</span>
          </span>
        </li>
        <li className="flex min-w-0 items-baseline justify-between gap-2">
          <span className={compactLabelClass}>Prefix hits · since start</span>
          <span className={compactValueClass}>{percent(model.prefixHitPercent)}</span>
        </li>
        <li
          className="flex min-w-0 items-baseline justify-between gap-2"
          title="MTP acceptance: the last requests to finish / since the engine started"
        >
          <span className={compactLabelClass}>MTP · last / all</span>
          <span className={compactValueClass}>
            {`${percent(model.mtpAcceptancePercent)} / ${percent(model.mtpAcceptanceSinceStartPercent)}`}
          </span>
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
