// One stream's page, read as a conversation: the task as the caller's message, each turn
// as the delegation's own message, a sticky header that stays on screen, an end note when
// the run is done, and the reply followed unless the reader has scrolled up. The run's
// details sit in a bar beside the conversation, folded by the header's Details button.
// StreamViewBody is split out so the presentational part can be rendered in tests without
// the hook.
import { Fragment, useEffect, useState } from "react";
import { Asterisk, Check, ChevronRight, CircleHelp, File, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { StreamView, TurnView, CallView, SummaryView } from "../server/view.ts";
import type { ListRow } from "../server/streams.ts";
import { useStreamView } from "./useStreamView.ts";
import { StateBadge, StateIcon, STATE_TEXT } from "./states.tsx";
import { localTime } from "./time.ts";
import { compactCount } from "./format.ts";
import { Markdown } from "./Markdown.tsx";
import { DetailsFigures, useDetailsFolded } from "./DetailsBar.tsx";

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
  const [folded, toggleDetails] = useDetailsFolded();
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

  // Only while the run is going: one stopped mid-turn never closes that turn, which keeps the
  // clock and heartbeat it had. The open turn, the only one with a clock, is always the last.
  const going = row.state === "live" || row.state === "asking" || row.state === "queued" || row.state === "quiet";

  return (
    <section className="flex flex-col gap-4">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-page pt-4 pb-3">
        <div className="flex items-center gap-2">
          <StateBadge state={row.state} />
          <h2 className="min-w-0 truncate text-xl font-semibold" title={row.title}>
            {row.title}
          </h2>
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls="details-bar"
            aria-label="Details"
            title={folded ? "Show the details" : "Fold the details away"}
            onClick={toggleDetails}
            className="ml-auto hidden shrink-0 items-center lg:inline-flex gap-1.5 rounded-md border border-line px-2 py-1 text-sm text-muted"
          >
            {folded ? (
              <PanelRightOpen size={16} aria-hidden="true" />
            ) : (
              <PanelRightClose size={16} aria-hidden="true" />
            )}
            <span className="lg:hidden">Details</span>
          </button>
        </div>
      </header>

      <details className="lg:hidden rounded-xl border border-line bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Details</summary>
        <DetailsFigures view={view} />
      </details>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        <ol aria-label="Conversation" className="flex min-w-0 flex-1 flex-col gap-4">
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
          {view.summary !== null && view.summary.finished && (
            <SummaryItem summary={view.summary} state={row.state} />
          )}
        </ol>
        {/* A card that sticks where it already sits: below the 57px header and the 16px gap, so the first scroll does not move it before it sticks. */}
        {!folded && (
          <aside
            id="details-bar"
            aria-label="Details"
            className="hidden w-[300px] shrink-0 self-start lg:sticky lg:top-[73px] lg:block max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-xl border border-line bg-card p-4"
          >
            <DetailsFigures view={view} />
          </aside>
        )}
      </div>

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

// The end note names how the run ended: stopped and timed out are not failures.
const ENDING: Partial<Record<ListRow["state"], string>> = { failed: "Failed", stopped: "Stopped", "timed out": "Timed out" };

function SummaryItem({ summary, state }: { summary: SummaryView; state: ListRow["state"] }) {
  return (
    <li data-from="end" className="rounded-xl border border-line px-4 py-3">
      <p>
        <span className={`inline-flex items-center gap-1 ${STATE_TEXT[state]}`}>
          <StateIcon state={state} size={16} />
          {ENDING[state] ?? (summary.ok === false ? "Failed" : "Finished")}
        </span>
        {summary.elapsed !== null && ` in ${summary.elapsed}`}
        {summary.turns !== null && ` · ${summary.turns} turns`}
        {summary.reuse !== null && ` · ${summary.reuse} cached`}
      </p>
    </li>
  );
}
