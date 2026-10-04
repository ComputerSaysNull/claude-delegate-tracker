// One stream's page, read as a conversation: the task as the caller's message, each turn
// as the delegation's own message, a sticky header that stays on screen, an end note when
// the run is done, and the reply followed unless the reader has scrolled up. StreamViewBody
// is split out so the presentational part can be rendered in tests without the hook.
import { Fragment, useEffect, useState } from "react";
import { Asterisk, Check, ChevronRight, CircleHelp, File, X } from "lucide-react";
import type { StreamView, TurnView, CallView, SummaryView } from "../server/view.ts";
import type { ListRow } from "../server/streams.ts";
import { useStreamView } from "./useStreamView.ts";
import { StateBadge, StateIcon, STATE_TEXT } from "./states.tsx";
import { localTime } from "./time.ts";
import { compactCount } from "./format.ts";
import { Markdown } from "./Markdown.tsx";

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
  const going = row.state === "live" || row.state === "asking" || row.state === "queued" || row.state === "quiet";
  const lastTurn = going ? view.turns.at(-1) : undefined;
  const lastClock = lastTurn?.clock ?? null;
  const heartbeat = lastTurn !== undefined && !lastTurn.closed ? lastTurn.heartbeat : null;

  return (
    <section className="flex flex-col gap-4">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-page py-3">
        <div className="flex items-center gap-2">
          <StateBadge state={row.state} />
          <h2 className="min-w-0 truncate text-xl font-semibold" title={row.title}>
            {row.title}
          </h2>
        </div>
        <p className="text-sm text-muted">
          {row.kind}
          {row.model !== null && row.model !== "" && <> · {row.model}</>}
          {row.effort !== null && row.effort !== "" && <> · {row.effort} effort</>}
          <> · started <span className="font-mono tabular-nums">{localTime(row.startedAt)}</span></>
          {row.elapsed !== null && row.elapsed !== "" && (
            <> · elapsed <span className="font-mono tabular-nums">{row.elapsed}</span></>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          {turnsMatch !== null && (
            <div className="w-56 flex flex-col gap-1.5">
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
          )}
          {lastClock !== null && (
            <div className="w-64 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span>Time left</span>
                {row.left !== null && <span className="font-mono tabular-nums">{row.left} left</span>}
              </div>
              <div
                role="progressbar"
                aria-label="Time"
                aria-valuenow={lastClock.elapsed}
                aria-valuemin={0}
                aria-valuemax={lastClock.of}
                className="h-[5px] rounded-[3px] bg-line"
              >
                <div
                  className="h-full bg-muted"
                  style={{ width: `${(lastClock.elapsed / lastClock.of) * 100}%` }}
                />
              </div>
            </div>
          )}
          {heartbeat !== null && (
            <p className="text-[13px] font-mono tabular-nums text-muted">{heartbeat}</p>
          )}
        </div>
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
            className="ml-auto max-w-[88%] rounded-2xl border border-line bg-card px-4 py-3"
          >
            <p className="text-xs text-muted">
              Task
              {row.startedAt !== null && (
                <> · <span className="font-mono tabular-nums">{localTime(row.startedAt)}</span></>
              )}
            </p>
            {view.task !== null && <Markdown text={view.task} />}
            {view.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {view.files.map((file) => (
                  <span
                    key={file.path}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 font-mono text-xs ${
                      file.skipped !== null ? "border-warn/60 text-warn" : ""
                    }`}
                  >
                    <File size={12} aria-hidden="true" />
                    <span className="min-w-0 max-w-[22rem]">
                      <Clipped text={file.path} className="min-w-0" />
                    </span>
                    {file.size !== null && <span className="whitespace-nowrap"> · {file.size}</span>}
                    {file.skipped !== null && <span className="whitespace-nowrap"> · refused</span>}
                  </span>
                ))}
              </div>
            )}
            {/* Why a file was refused, in full, under the chips. */}
            {view.files
              .filter((file) => file.skipped !== null)
              .map((file) => (
                <p key={file.path} className="text-xs text-warn">
                  <span className="font-mono">{file.path}</span>: {file.skipped}
                </p>
              ))}
          </li>
        )}
        {view.waiting !== null && (
          <li data-from="note" className="text-sm font-mono tabular-nums text-warn">
            {view.waiting}
          </li>
        )}
        {view.turns.map((turn) => (
          <Fragment key={turn.n}>
            <DelegationMessage
              turn={turn}
              model={row.model}
              waitingFor={row.state === "asking" && turn.answer === null ? row.age : undefined}
            />
            {turn.answer !== null && <CallerAnswer answer={turn.answer} />}
          </Fragment>
        ))}
        {view.summary !== null && <SummaryItem summary={view.summary} state={row.state} />}
      </ol>

      {going && !following && (
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

// The caller's reply to a question, on the caller's side like the task.
function CallerAnswer({ answer }: { answer: NonNullable<TurnView["answer"]> }) {
  return (
    <li
      data-from="caller"
      className="ml-auto flex max-w-[88%] flex-col gap-2 rounded-2xl rounded-br-sm border border-line bg-card px-3 py-2"
    >
      <p className="text-xs text-muted">
        Answer, after <span className="font-mono tabular-nums">{answer.waited}</span>
      </p>
      {answer.bestReading && <p className="text-sm text-muted">The caller left the choice to the delegation:</p>}
      <Markdown text={answer.text} />
    </li>
  );
}

// `waitingFor` is how long the run has waited for its caller, while it still waits.
function DelegationMessage({
  turn,
  model,
  waitingFor,
}: {
  turn: TurnView;
  model: string | null;
  waitingFor?: string | null;
}) {
  const writing = turn.reply === null && turn.partial !== null && turn.partial.answer !== "";
  const answer =
    turn.reply !== null
      ? turn.reply
      : turn.partial !== null && turn.partial.answer !== ""
        ? turn.partial.answer
        : null;
  const head = [model, `turn ${turn.n}`, turn.at !== null ? localTime(turn.at) : null].filter(
    (p): p is string => p !== null,
  );
  const figures = [
    turn.tokensIn !== null ? `${compactCount(turn.tokensIn)} in` : null,
    turn.tokensOut !== null ? `${compactCount(turn.tokensOut)} out` : null,
    turn.tokS !== null ? `${turn.tokS.toLocaleString()} tok/s` : null,
    turn.toolTime !== null ? `tool ${turn.toolTime}` : null,
  ].filter((p): p is string => p !== null);
  return (
    <li data-from="delegation" className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted">
        <Asterisk size={15} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-muted">{head.join(" · ")}</p>
        {turn.budget !== null && <p className="text-[11px] text-muted">{turn.budget}</p>}
        {turn.partial !== null && turn.partial.reasoning !== "" && (
          <details>
            <summary className="cursor-pointer text-sm text-muted">
              <ChevronRight size={14} />
              Thinking
            </summary>
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
        {turn.question !== null && (
          <div
            role="note"
            aria-label="Question for the caller"
            className="flex flex-col gap-2 rounded-xl border border-state-asking/50 bg-state-asking/10 px-3 py-2"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-state-asking">
              <CircleHelp size={15} aria-hidden="true" />
              Question for the caller
            </p>
            {turn.question.questions.map((q, i) => (
              <Markdown key={i} text={q} />
            ))}
            {waitingFor !== undefined && (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-state-asking" aria-hidden="true" />
                Waiting for an answer
                {waitingFor !== null && <span className="font-mono tabular-nums text-text"> · {waitingFor}</span>}
              </p>
            )}
            {turn.answer !== null && (
              <p className="text-[13px] text-muted">
                Answered after <span className="font-mono tabular-nums">{turn.answer.waited}</span>
              </p>
            )}
          </div>
        )}
        {writing && <p className="text-xs text-muted">writing…</p>}
        {answer !== null && <Markdown text={answer} />}
        {figures.length > 0 && (
          <p className="text-xs font-mono tabular-nums text-muted">{figures.join(" · ")}</p>
        )}
        {turn.attempts !== null && (
          <p className="text-xs font-mono tabular-nums text-muted">attempts {turn.attempts}</p>
        )}
        {turn.repeated !== null && (
          <p className="text-xs font-mono tabular-nums text-muted">repeated output {turn.repeated}</p>
        )}
        {turn.evicted !== null && (
          <p className="text-xs font-mono tabular-nums text-muted">tool results evicted {turn.evicted}</p>
        )}
      </div>
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
  const [first, ...rest] = call.args;
  return (
    <li className={`border-t border-line px-3 py-2 bg-card first:border-t-0 ${call.ok === false ? "bg-hot/5" : ""}`}>
      <div className="flex items-center gap-2">
        {call.ok === true && <Check aria-label="succeeded" role="img" size={14} className="text-state-ok" />}
        {call.ok === false && <X aria-label="failed" role="img" size={14} className="text-hot" />}
        <span className="font-mono text-sm font-semibold">{call.name}</span>
        {first !== undefined && (
          <Clipped text={`${first[0]}: ${first[1]}`} className="min-w-0 flex-1 font-mono text-sm text-muted" />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
          {call.status !== null && <span>{call.status}</span>}
          {call.result !== null && <span>{call.result}</span>}
          {call.exitCode !== null && (
            <span className={call.ok === false ? "text-hot" : undefined}>exit {call.exitCode}</span>
          )}
          {call.time !== null && <span>{call.time}</span>}
        </span>
      </div>
      {rest.map(([key, value], i) => (
        <Clipped key={i} text={`${key}: ${value}`} className="text-sm font-mono tabular-nums text-muted" />
      ))}
      {call.message !== null && (
        <p className="whitespace-pre-wrap text-sm text-hot">{call.message}</p>
      )}
    </li>
  );
}

function SummaryItem({ summary, state }: { summary: SummaryView; state: ListRow["state"] }) {
  if (summary.finished) {
    return (
      <li data-from="end" className="rounded-xl border border-line px-4 py-3">
        <p>
          <span className={`inline-flex items-center gap-1 ${STATE_TEXT[state]}`}>
            <StateIcon state={state} size={16} />
            {summary.ok === false ? "Failed" : "Finished"}
          </span>
          {summary.elapsed !== null && ` in ${summary.elapsed}`}
          {summary.turns !== null && ` · ${summary.turns} turns`}
          {summary.reuse !== null && ` · ${summary.reuse} cached`}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {summary.cached !== null && <span>cached {summary.cached.toLocaleString()}</span>}
          {summary.returned !== null && <span>returned {summary.returned.toLocaleString()}</span>}
          {summary.load !== null && <span>load {summary.load.toLocaleString()}</span>}
          {summary.failures !== null && (
            <span className={summary.failures > 0 ? "text-hot" : "text-muted"}>
              failures {summary.failures.toLocaleString()}
            </span>
          )}
          {summary.toolTime !== null && <span>tool time {summary.toolTime}</span>}
          {summary.shellCalls !== null && <span>shell calls {summary.shellCalls.toLocaleString()}</span>}
          {summary.finishReason !== null && <span>finish reason {summary.finishReason}</span>}
        </div>
        {summary.error !== null && (
          <p className="whitespace-pre-wrap font-mono tabular-nums text-hot">{summary.error}</p>
        )}
      </li>
    );
  }
  return (
    <li className="rounded-xl border border-line px-4 py-3">
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
