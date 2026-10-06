// The delegation's details, in a bar beside the conversation: the kind, model, effort, start
// and time used, the turns as a bar, the time left and heartbeat while a run is going, and the
// run's figures so far. The header's Details button folds it away and remembers the choice; on
// a phone the same details fold open under the title.
import { useCallback, useState } from "react";
import type { StreamView } from "../server/view.ts";
import type { ListRow } from "../server/streams.ts";
import { localTime } from "./time.ts";
import { STATE_TEXT } from "./states.tsx";

// Whether the details bar is folded away, remembered in the browser: "1" folded, "0" shown.
// With nothing stored it starts folded on a narrow desktop, shown on a wide one.
export function useDetailsFolded(): [boolean, () => void] {
  const [folded, setFolded] = useState<boolean>(() => {
    let stored: string | null;
    try {
      stored = window.localStorage.getItem("tracker.detailsFolded");
    } catch {
      stored = null;
    }
    if (stored === "1") return true;
    if (stored === "0") return false;
    if (typeof window.matchMedia !== "function") return false;
    try {
      return !window.matchMedia("(min-width: 1280px)").matches;
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setFolded((f) => {
      const next = !f;
      try {
        window.localStorage.setItem("tracker.detailsFolded", next ? "1" : "0");
      } catch {
        // A blocked localStorage must not stop the fold from toggling.
      }
      return next;
    });
  }, []);
  return [folded, toggle];
}

// The bar's content, shared by the lg aside and the phone's fold-open details.
export function DetailsFigures({ view }: { view: StreamView }) {
  const row = view.row;
  // Only while the run is going: one stopped mid-turn never closes that turn, which keeps the
  // clock and heartbeat it had. The open turn, the only one with a clock, is always the last.
  const going = row.state === "live" || row.state === "asking" || row.state === "queued" || row.state === "quiet";
  const lastTurn = going ? view.turns.at(-1) : undefined;
  const lastClock = lastTurn?.clock ?? null;
  const heartbeat = lastTurn !== undefined && !lastTurn.closed ? lastTurn.heartbeat : null;
  const toolCalls = view.turns.reduce((n, t) => n + t.calls.length, 0);
  const failedCalls = view.turns.reduce((n, t) => n + t.calls.filter((c) => c.ok === false).length, 0);
  const closedTurns = view.turns.filter((t) => t.closed);
  const retries = closedTurns.reduce((n, t) => n + (t.attempts !== null ? t.attempts - 1 : 0), 0);
  const summary = view.summary;
  // The highest repeat share over all turns, reply or thinking; names its part and its turn.
  let repeat: { value: string; part: string; n: number } | null = null;
  for (const t of view.turns) {
    const parts: [string, string | null][] = [["reply", t.repeated], ["thinking", t.thinkingRepeated]];
    for (const [part, value] of parts) {
      if (value === null) continue;
      const share = parseInt(value, 10);
      if (repeat === null || share > parseInt(repeat.value, 10)) repeat = { value, part, n: t.n };
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Row label="Kind" value={row.kind} />
        <Row label="Model" value={row.model} />
        <Row label="Effort" value={row.effort} />
        <Row label="Started" value={row.startedAt !== null ? localTime(row.startedAt) : null} />
        <Row label="Elapsed" value={row.elapsed} />
      </dl>

      <TurnBar row={row} />

      {lastClock !== null && <TimeBar clock={lastClock} left={row.left} />}
      {heartbeat !== null && <Heartbeat text={heartbeat} />}

      {row.why !== null && row.why !== "" && (
        <p className={`text-sm ${STATE_TEXT[row.state]}`}>{row.why}</p>
      )}
      {row.unknownFormat !== null && row.unknownFormat !== "" && (
        <p className="text-sm text-warn">format {row.unknownFormat}: shown as best it can be</p>
      )}
      {view.waiting !== null && (
        <p className="text-sm font-mono tabular-nums text-warn">{view.waiting}</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Row label="Tool calls" value={String(toolCalls)} />
        {failedCalls > 0 && <Row label="Failed" value={String(failedCalls)} />}
        {closedTurns.length > 0 && <Row label="Retries" value={String(retries)} />}
        {repeat !== null && <Row label="Repeats" value={`${repeat.value} ${repeat.part}, turn ${repeat.n}`} valueClass="text-warn" />}
        {summary !== null && (
          <>
            <Row label="Cached" value={summary.cached !== null ? summary.cached.toLocaleString() : null} />
            <Row label="Cache hits" value={summary.reuse} />
            <Row label="Returned" value={summary.returned !== null ? summary.returned.toLocaleString() : null} />
            <Row label="Load" value={summary.load !== null ? summary.load.toLocaleString() : null} />
            {summary.failures !== null && (
              <>
                <dt className={summary.failures > 0 ? "text-hot" : "text-muted"}>Failures</dt>
                <dd className={`font-mono tabular-nums ${summary.failures > 0 ? "text-hot" : ""}`}>{summary.failures.toLocaleString()}</dd>
              </>
            )}
            <Row label="Tool time" value={summary.toolTime} />
            <Row label="Shell calls" value={summary.shellCalls !== null ? summary.shellCalls.toLocaleString() : null} />
            <Row label="Finish reason" value={summary.finishReason} />
            <Row label="Error" value={summary.error} valueClass={summary.error !== null ? "whitespace-pre-wrap text-hot" : ""} />
          </>
        )}
      </dl>
    </div>
  );
}

// A label/value row; a null value is left out, never shown as 0.
function Row({ label, value, valueClass = "" }: { label: string; value: string | null; valueClass?: string }) {
  if (value === null) return null;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono tabular-nums ${valueClass}`}>{value}</dd>
    </>
  );
}

// The turns as a bar: filled up to the turn before the open one, half for the open turn.
function TurnBar({ row }: { row: ListRow }) {
  const turnsMatch = row.turns !== null ? row.turns.match(/^(\d+) of (\d+)$/) : null;
  if (turnsMatch === null) return null;
  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted">Turns</span>
        <span className="font-mono tabular-nums">{row.turns}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Turns"
        aria-valuenow={Number(turnsMatch[1])}
        aria-valuemin={0}
        aria-valuemax={Number(turnsMatch[2])}
        className="flex gap-[3px]"
      >
        {Array.from({ length: Number(turnsMatch[2]) }).map((_, i) => (
          <span
            key={i}
            className={`h-[5px] flex-1 rounded-[3px] ${
              i < Number(turnsMatch[1]) - 1
                ? "bg-state-live"
                : i === Number(turnsMatch[1]) - 1
                  ? "bg-state-live/45"
                  : "bg-line"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// The time used as a bar, from the newest heartbeat, with the time left beside it.
function TimeBar({ clock, left }: { clock: { elapsed: number; of: number }; left: string | null }) {
  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted">Time left</span>
        {left !== null && <span className="font-mono tabular-nums">{left} left</span>}
      </div>
      <div
        role="progressbar"
        aria-label="Time"
        aria-valuenow={clock.elapsed}
        aria-valuemin={0}
        aria-valuemax={clock.of}
        className="h-[5px] rounded-[3px] bg-line"
      >
        <div className="h-full bg-muted" style={{ width: `${(clock.elapsed / clock.of) * 100}%` }} />
      </div>
    </div>
  );
}

function Heartbeat({ text }: { text: string }) {
  return <p className="text-[13px] font-mono tabular-nums text-muted">{text}</p>;
}
