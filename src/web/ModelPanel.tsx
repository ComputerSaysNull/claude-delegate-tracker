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
// A short stroke before a word in a label keys it to its line in the chart beside it.
const STROKE_A = "mr-1 inline-block h-0.5 w-2.5 rounded-full bg-chart-pair-a align-middle";
const STROKE_B = "mr-1 inline-block h-0.5 w-2.5 rounded-full bg-chart-pair-b align-middle";
// A label is plain text, not flex items: a word could break in the middle as a flex item.
// Each stroke-and-word unit stays on one line, so a narrow column wraps only between units.
const UNIT = "whitespace-nowrap";

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

// One charted figure: its label (with any legend strokes or help mark), the number with its
// unit, and under them its chart across the column. `minChars` keeps a number that changes
// every second at a fixed width, so its chart does not move as the digits change. `help` is a
// mark beside the label opening a card.
function Figure({ label, value, valueClass, unit, chart, minChars, help }: { label: ReactNode; value: string; valueClass?: string; unit?: ReactNode; chart?: ReactNode; minChars?: number; help?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="block text-[13px] text-muted">{label}{help === undefined ? null : <span className="ml-1 align-middle">{help}</span>}</span>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={`font-mono tabular-nums text-2xl font-medium ${valueClass ?? ""}`}
          style={minChars === undefined ? undefined : { minWidth: `${minChars}ch` }}
        >
          {value}
        </span>
        {unit}
      </div>
      <div className="min-w-0 h-8">{chart}</div>
    </li>
  );
}

// A figure without a chart: its label above its value, in a row of its own, so the card does
// not grow. `title` explains a pair of numbers too short to say so themselves.
// The label is not truncated: a help card opens inside it, and hidden overflow would clip it.
function CompactFigure({ label, value, help }: { label: string; value: ReactNode; help?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="block text-[13px] text-muted">{label}{help === undefined ? null : <span className="ml-1 align-middle">{help}</span>}</span>
      <span className="whitespace-nowrap font-mono tabular-nums text-lg font-medium">{value}</span>
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
  // The live decode event, when one has arrived and the model is ok, replaces the figure
  // from the last full reading; the sparkline stays on the full cadence. The same event also
  // carries the speed of the last finished prompt, which the panel keeps until the next one.
  const live = decode !== null && decode !== undefined && model.status === "ok";
  const decodeValue = live ? decode.tokensPerSecond : model.decodeTokensPerSecond;
  const prefillValue = live ? decode.prefillTokensPerSecond : model.prefillTokensPerSecond;
  const chart = (keys: string[], label: string, colors?: string[], fixed?: [number, number]) =>
    history === undefined ? undefined : (
      <Sparkline data={toUplotData(history, keys)} colors={colors} label={`${label} over the ${windowLabel(span)}`} fixed={fixed} span={span} />
    );
  // The KV-cache figures: the free room and today's rebuilt prompts fill the help card, which
  // appears only when there is a kept share.
  const free = model.kvKeptPercent !== null && model.kvCachePercent !== null
    ? Math.max(0, Math.round((100 - model.kvCachePercent - model.kvKeptPercent) * 10) / 10)
    : null;
  const freePercent = free === null
    ? "—"
    : `${free.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
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
  // The pool warns as it fills: amber from 90% booked and kept together, red from 97%.
  const kvTogether = model.kvCachePercent !== null && model.kvKeptPercent !== null
    ? model.kvCachePercent + model.kvKeptPercent
    : null;
  const kvValueClass = kvTogether === null
    ? undefined
    : kvTogether >= 97 ? "text-state-failed" : kvTogether >= 90 ? "text-state-queued" : undefined;
  return (
    <>
      <ul aria-label="Model server figures" className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-3">
        <Figure
          label="Decode speed"
          value={rate(decodeValue)}
          minChars={4}
          unit={<span className={unitClass}>tok/s</span>}
          chart={chart(["decodeTokensPerSecond"], "Decode speed", ["--chart-pair-a"])}
        />
        <Figure
          label={
            <>
              {"Requests · "}
              <span className={UNIT}><span aria-hidden="true" className={STROKE_A} />running /</span>{" "}
              <span className={UNIT}><span aria-hidden="true" className={STROKE_B} />waiting</span>
            </>
          }
          value={`${num(model.running)} / ${num(model.waiting)}`}
          chart={chart(["running", "waiting"], "Requests", ["--chart-pair-a", "--chart-pair-b"])}
        />
        {model.kvKeptPercent === null ? (
          <Figure
            label="KV-cache use"
            value={percent(model.kvCachePercent)}
            chart={chart(["kvCachePercent"], "KV-cache use", ["--chart-pair-a"], [0, 100])}
          />
        ) : (
          <Figure
            label={
              <>
                {"KV-cache · "}
                <span className={UNIT}><span aria-hidden="true" className={STROKE_A} />reserved /</span>{" "}
                {/* " prompts" does not fit the column of a mid-width card; the help card says it. */}
                <span className={UNIT}><span aria-hidden="true" className={STROKE_B} />kept<span className="@md:hidden @3xl:inline"> prompts</span></span>
              </>
            }
            value={`${percent(model.kvCachePercent)} / ${percent(model.kvKeptPercent)}`}
            valueClass={kvValueClass}
            help={kvHelp}
            chart={chart(["kvCachePercent", "kvKeptPercent"], "KV-cache reserved / kept prompts", ["--chart-pair-a", "--chart-pair-b"], [0, 100])}
          />
        )}
      </ul>
      <ul aria-label="Model server figures without a chart" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-2.5 @2xl:grid-cols-4">
        <CompactFigure
          label="Prefill · last prompt"
          value={
            <>
              {rate(prefillValue)} <span className="font-sans text-xs font-normal text-muted">tok/s</span>
            </>
          }
        />
        <CompactFigure label="Prefix hits · since start" value={percent(model.prefixHitPercent)} />
        <CompactFigure
          label="MTP · last / all"
          value={`${percent(model.mtpAcceptancePercent)} / ${percent(model.mtpAcceptanceSinceStartPercent)}`}
          help={
            <HelpMark
              label="About MTP acceptance"
              title="MTP acceptance"
              rows={[
                { label: "Last requests to finish", value: percent(model.mtpAcceptancePercent) },
                { label: "Since the engine started", value: percent(model.mtpAcceptanceSinceStartPercent) },
              ]}
              text="The share of the draft tokens the model's multi-token prediction proposed that the model kept. Last is the latest window in which requests finished; TensorFold counts drafts only when a request finishes, so it holds until the next. All is since the engine started."
            />
          }
        />
        <CompactFigure
          label="Prompts rebuilt · today"
          value={typeof rebuiltToday === "number" ? rebuiltToday.toLocaleString() : "—"}
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
