// One stream's page, read as a conversation: the task as the caller's message, each turn
// as the delegation's own message, a sticky header that stays on screen, an end note when
// the run is done, and the reply followed unless the reader has scrolled up. StreamViewBody
// is split out so the presentational part can be rendered in tests without the hook.
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import type { StreamView, TurnView, CallView, SummaryView } from "../server/view.ts";
import type { ListRow } from "../server/streams.ts";
import { useStreamView } from "./useStreamView.ts";
import { StateBadge, STATE_TEXT } from "./states.tsx";
import { localDateTime } from "./time.ts";

function metaLine(row: ListRow): string {
  const pieces = [
    row.kind,
    row.model,
    row.effort,
    row.turns === null ? null : `turns ${row.turns}`,
    row.elapsed,
  ].filter((p): p is string => p !== null && p !== "");
  return pieces.join(" · ");
}

export function StreamPage({ name, onClose }: { name: string; onClose: () => void }) {
  const { view, connected, missing } = useStreamView(name);
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onClose} className="hover:underline text-accent lg:hidden">
        ← All delegations
      </button>
      {missing ? (
        <p className="text-muted">No such delegation.</p>
      ) : view === null ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {!connected && (
            <p className="rounded border border-warn bg-warn/10 px-3 py-2 text-sm text-warn">
              Live updates paused; reconnecting…
            </p>
          )}
          <StreamViewBody view={view} />
        </>
      )}
    </div>
  );
}

export function StreamViewBody({ view }: { view: StreamView }) {
  const row = view.row;
  const meta = metaLine(row);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const onScroll = () => {
      setFollowing(
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80,
      );
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (following) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [view, following]);

  const turnsMatch = row.turns !== null ? row.turns.match(/^(\d+) of (\d+)$/) : null;
  // Only while the run is going: one stopped mid-turn never closes that turn, which keeps the
  // clock and heartbeat it had. The open turn, the only one with a clock, is always the last.
  const going = row.state === "live" || row.state === "queued" || row.state === "quiet";
  const lastTurn = going ? view.turns.at(-1) : undefined;
  const lastClock = lastTurn?.clock ?? null;
  const heartbeat = lastTurn !== undefined && !lastTurn.closed ? lastTurn.heartbeat : null;

  return (
    <section className="flex flex-col gap-4">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-page py-3">
        <div className="flex items-center gap-2">
          <StateBadge state={row.state} />
          <h2 className="min-w-0 truncate font-medium" title={row.title}>
            {row.title}
          </h2>
        </div>
        {meta !== "" && <p className="text-sm font-mono tabular-nums text-muted">{meta}</p>}
        <p className="text-sm font-mono tabular-nums text-muted">
          started {localDateTime(row.startedAt)}
        </p>
        {turnsMatch !== null && (
          <>
            <div className="flex justify-between text-xs text-muted">
              <span>Turn</span>
              <span className="font-mono tabular-nums">{row.turns}</span>
            </div>
            <div
              role="progressbar"
              aria-label="Turns"
              aria-valuenow={Number(turnsMatch[1])}
              aria-valuemin={0}
              aria-valuemax={Number(turnsMatch[2])}
              className="h-1.5 overflow-hidden rounded bg-line"
            >
              <div
                className="h-full bg-state-live"
                style={{ width: `${(Number(turnsMatch[1]) / Number(turnsMatch[2])) * 100}%` }}
              />
            </div>
          </>
        )}
        {lastClock !== null && (
          <>
            <div
              role="progressbar"
              aria-label="Time"
              aria-valuenow={lastClock.elapsed}
              aria-valuemin={0}
              aria-valuemax={lastClock.of}
              className="h-1.5 overflow-hidden rounded bg-line"
            >
              <div
                className="h-full bg-state-live"
                style={{ width: `${(lastClock.elapsed / lastClock.of) * 100}%` }}
              />
            </div>
            {row.left !== null && (
              <p className="text-xs font-mono tabular-nums text-muted">{row.left} left</p>
            )}
          </>
        )}
        {heartbeat !== null && (
          <p className="text-xs font-mono tabular-nums text-muted">{heartbeat}</p>
        )}
        {row.why !== null && row.why !== "" && (
          <p className={`text-sm ${STATE_TEXT[row.state]}`}>{row.why}</p>
        )}
        {row.unknownFormat !== null && row.unknownFormat !== "" && (
          <p className="text-sm text-warn">
            format {row.unknownFormat}: shown as best it can be
          </p>
        )}
      </header>

      <ol aria-label="Conversation" className="flex flex-col gap-4">
        {(view.task !== null || view.files.length > 0) && (
          <li
            data-from="caller"
            className="ml-auto flex max-w-[88%] flex-col gap-2 rounded-2xl rounded-br-sm border border-line bg-card px-3 py-2"
          >
            <p className="text-xs text-muted">Task</p>
            {view.task !== null && <p className="whitespace-pre-wrap">{view.task}</p>}
            {view.files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {view.files.map((file) => (
                  <li key={file.path} className="flex flex-wrap gap-2">
                    <Clipped text={file.path} className="font-medium" />
                    {file.size !== null && (
                      <span className="font-mono tabular-nums text-muted">{file.size}</span>
                    )}
                    {file.skipped !== null && <span className="text-warn">{file.skipped}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {view.waiting !== null && (
          <li data-from="note" className="text-sm font-mono tabular-nums text-warn">
            {view.waiting}
          </li>
        )}
        {view.turns.map((turn) => (
          <DelegationMessage key={turn.n} turn={turn} />
        ))}
        {view.summary !== null && <SummaryItem summary={view.summary} />}
      </ol>

      {!following && (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: document.documentElement.scrollHeight });
            setFollowing(true);
          }}
          className="fixed bottom-4 right-4 z-20 rounded-full border border-line bg-card px-4 py-2 text-sm text-accent shadow"
        >
          Jump to latest
        </button>
      )}
    </section>
  );
}

function DelegationMessage({ turn }: { turn: TurnView }) {
  const writing = turn.reply === null && turn.partial !== null && turn.partial.answer !== "";
  const answer =
    turn.reply !== null
      ? turn.reply
      : turn.partial !== null && turn.partial.answer !== ""
        ? turn.partial.answer
        : null;
  const figures = [
    turn.tokensIn !== null ? `${turn.tokensIn.toLocaleString()} in` : null,
    turn.tokensOut !== null ? `${turn.tokensOut.toLocaleString()} out` : null,
    turn.tokS !== null ? `${turn.tokS.toLocaleString()} tok/s` : null,
    turn.toolTime !== null ? `tool ${turn.toolTime}` : null,
  ].filter((p): p is string => p !== null);
  return (
    <li data-from="delegation" className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        {turn.heading}
        {turn.budget !== null && ` · ${turn.budget}`}
      </p>
      {turn.partial !== null && turn.partial.reasoning !== "" && (
        <details>
          <summary className="cursor-pointer text-sm text-muted">Thinking</summary>
          <pre className="whitespace-pre-wrap text-sm text-muted">{turn.partial.reasoning}</pre>
        </details>
      )}
      {turn.calls.length > 0 && (
        <ul aria-label="Tool calls" className="flex flex-col overflow-hidden rounded-xl border border-line">
          {turn.calls.map((call, i) => (
            <CallViewItem key={i} call={call} />
          ))}
        </ul>
      )}
      {writing && <p className="text-xs text-muted">writing…</p>}
      {answer !== null && <div className="whitespace-pre-wrap">{answer}</div>}
      {figures.length > 0 && (
        <p className="text-xs font-mono tabular-nums text-muted">{figures.join(" · ")}</p>
      )}
      {turn.attempts !== null && (
        <p className="text-sm font-mono tabular-nums text-muted">attempts {turn.attempts}</p>
      )}
      {turn.repeated !== null && (
        <p className="text-sm font-mono tabular-nums text-muted">repeated output {turn.repeated}</p>
      )}
      {turn.evicted !== null && (
        <p className="text-sm font-mono tabular-nums text-muted">tool results evicted {turn.evicted}</p>
      )}
    </li>
  );
}

// A value that may not fit on one line: cut with "…", and all of it one tap away, since a
// phone has no hover to show a tooltip.
function Clipped({ text, className }: { text: string; className: string }) {
  return (
    <details className={`group w-full min-w-0 ${className}`}>
      <summary className="cursor-pointer list-none truncate group-open:whitespace-pre-wrap">{text}</summary>
    </details>
  );
}

function CallViewItem({ call }: { call: CallView }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-line px-3 py-2 first:border-t-0 bg-card">
      <div className="flex items-center gap-2">
        {call.ok === true && <Check aria-label="succeeded" role="img" size={14} className="text-state-ok" />}
        {call.ok === false && <X aria-label="failed" role="img" size={14} className="text-hot" />}
        <span className="font-mono tabular-nums">{call.name}</span>
        <span className="ml-auto flex items-center gap-2 text-sm font-mono tabular-nums text-muted">
          {call.status !== null && <span>{call.status}</span>}
          {call.result !== null && <span>{call.result}</span>}
          {call.exitCode !== null && <span>exit {call.exitCode}</span>}
          {call.time !== null && <span>{call.time}</span>}
        </span>
      </div>
      {call.args.map(([key, value], i) => (
        <Clipped key={i} text={`${key}: ${value}`} className="text-sm font-mono tabular-nums text-muted" />
      ))}
      {call.message !== null && (
        <p className="whitespace-pre-wrap text-sm text-hot">{call.message}</p>
      )}
    </li>
  );
}

function SummaryItem({ summary }: { summary: SummaryView }) {
  if (summary.finished) {
    return (
      <li data-from="end" className="rounded-lg border border-line p-3">
        <p className={summary.ok === false ? "text-hot" : undefined}>
          {summary.ok === false ? "Failed" : "Finished"}
          {summary.elapsed !== null && ` in ${summary.elapsed}`}
        </p>
        <SummaryFigures summary={summary} />
      </li>
    );
  }
  return (
    <li className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">Summary</h3>
      <SummaryFigures summary={summary} />
    </li>
  );
}

function SummaryFigures({ summary }: { summary: SummaryView }) {
  return (
    <div className="mt-2 flex flex-col gap-1 text-sm font-mono tabular-nums">
      {summary.elapsed !== null && <p>elapsed {summary.elapsed}</p>}
      {summary.turns !== null && <p>turns {summary.turns}</p>}
      {summary.cached !== null && <p>cached {summary.cached.toLocaleString()}</p>}
      {summary.reuse !== null && <p>reuse {summary.reuse}</p>}
      {summary.returned !== null && <p>returned {summary.returned.toLocaleString()}</p>}
      {summary.load !== null && <p>load {summary.load.toLocaleString()}</p>}
      {summary.failures !== null && (
        <p className={summary.failures > 0 ? "text-hot" : "text-muted"}>
          failures {summary.failures.toLocaleString()}
        </p>
      )}
      {summary.toolTime !== null && <p>tool time {summary.toolTime}</p>}
      {summary.shellCalls !== null && <p>shell calls {summary.shellCalls.toLocaleString()}</p>}
      {summary.finishReason !== null && <p>finish reason {summary.finishReason}</p>}
      {summary.error !== null && (
        <p className="whitespace-pre-wrap font-mono tabular-nums text-hot">{summary.error}</p>
      )}
    </div>
  );
}
