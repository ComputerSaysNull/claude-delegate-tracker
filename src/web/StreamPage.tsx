// One stream's page, read as a conversation: the task as the caller's message, each turn
// as the delegation's own message, a sticky header that stays on screen, an end note when
// the run is done, and the reply followed unless the reader has scrolled up. The run's
// details sit in a bar beside the conversation, folded by the header's Details button.
// StreamViewBody is split out so the presentational part can be rendered in tests without
// the hook.
import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Asterisk, Check, ChevronDown, ChevronRight, CircleHelp, File, PanelRightClose, PanelRightOpen, Repeat, X } from "lucide-react";
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

// What actually scrolls the conversation: the nearest ancestor that scrolls by itself (the
// detail pane on a desktop), else the window (a phone). Following must watch and move that.
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p !== null; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

function atBottom(pane: HTMLElement | null): boolean {
  return pane === null
    ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80
    : pane.clientHeight + pane.scrollTop >= pane.scrollHeight - 80;
}

function toBottom(pane: HTMLElement | null): void {
  if (pane === null) window.scrollTo({ top: document.documentElement.scrollHeight });
  else pane.scrollTo({ top: pane.scrollHeight });
}

function toTop(pane: HTMLElement | null): void {
  (pane ?? window).scrollTo({ top: 0 });
}

// The path as it reads inside the repo: the segments after the last segment that equals the
// workspace and is not the path's final segment, joined with "/"; else the path unchanged.
function insideRepo(path: string, workspace: string | null): string {
  if (workspace === null) return path;
  const parts = path.split(/[\\/]/);
  let found = -1;
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] === workspace) {
      found = i;
      break;
    }
  }
  return found === -1 ? path : parts.slice(found + 1).join("/");
}

export function StreamViewBody({ view }: { view: StreamView }) {
  const row = view.row;
  const [folded, toggleDetails] = useDetailsFolded();
  const [following, setFollowing] = useState(true);
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const pane = scrollerOf(root.current);
    const target: HTMLElement | Window = pane ?? window;
    const onScroll = () => setFollowing(atBottom(pane));
    target.addEventListener("scroll", onScroll);
    return () => target.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (following) toBottom(scrollerOf(root.current));
  }, [view, following]);

  // Only while the run is going: one stopped mid-turn never closes that turn, which keeps the
  // clock and heartbeat it had. The open turn, the only one with a clock, is always the last.
  const going = row.state === "live" || row.state === "asking" || row.state === "queued" || row.state === "quiet";

  return (
    <section ref={root} className="flex flex-col gap-4">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-page pt-4 pb-3">
        <div className="flex items-center gap-2">
          <StateBadge state={row.state} />
          <h2 className="min-w-0 text-xl font-semibold" title={row.title}>
            {/* Back to the task at the top; stop following, or the next update scrolls down again. */}
            <button
              type="button"
              onClick={() => {
                setFollowing(false);
                toTop(scrollerOf(root.current));
              }}
              className="block max-w-full cursor-pointer text-left lg:truncate"
            >
              {row.title}
            </button>
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
        <ol aria-label="Conversation" className="flex min-w-0 flex-1 flex-col gap-4 w-full">
          {(view.task !== null || view.files.length > 0) && (
            <li
              data-from="caller"
              className="ml-auto max-w-[88%] rounded-2xl border border-line bg-card px-4 py-3"
            >
              <p className="text-xs text-muted">
                Task
                {row.workspace !== null && <> from {row.workspace}</>}
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
                        <span className="line-clamp-2 break-all" title={file.path} tabIndex={0}>{insideRepo(file.path, row.workspace)}</span>
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
                name={view.name}
                model={row.model}
                waitingFor={row.state === "asking" && turn.answer === null ? row.age : undefined}
              />
              {turn.answer !== null && <CallerAnswer answer={turn.answer} workspace={row.workspace} />}
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
          // Following again scrolls to the newest text, in the pane or the window.
          onClick={() => setFollowing(true)}
          className="fixed bottom-4 right-4 z-20 rounded-full border border-line bg-card px-4 py-2 text-sm text-accent shadow"
        >
          Jump to latest
        </button>
      )}
    </section>
  );
}

// The caller's reply to a question, on the caller's side like the task.
function CallerAnswer({ answer, workspace }: { answer: NonNullable<TurnView["answer"]>; workspace: string | null }) {
  const from = workspace !== null ? ` from ${workspace}` : "";
  const header = answer.by === "person" ? "You answered, after "
    : answer.by === "caller" ? `Caller answered${from}, after ` : `Answer${from}, after `;
  return (
    <li
      data-from="caller"
      className="ml-auto flex max-w-[88%] flex-col gap-2 rounded-2xl rounded-br-sm border border-line bg-card px-3 py-2"
    >
      <p className="text-xs text-muted">
        {header}
        <span className="font-mono tabular-nums">{answer.waited}</span>
      </p>
      {answer.bestReading && <p className="text-sm text-muted">The caller left the choice to the delegation:</p>}
      <Markdown text={answer.text} />
    </li>
  );
}

// `waitingFor` is how long the run has waited for its caller, while it still waits.
function DelegationMessage({
  turn,
  name,
  model,
  waitingFor,
}: {
  turn: TurnView;
  name: string;
  model: string | null;
  waitingFor?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [retriesOpen, setRetriesOpen] = useState(false);
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
  // A turn's budget and evicted results fold behind the toggle.
  const hasDetails = turn.budget !== null || turn.evicted !== null;
  const retryGap = turn.attempts !== null ? turn.attempts - 1 - turn.retries.length : 0;
  // A repeated reply or thinking marks the heading as a possible loop.
  const repeatMarkers = [
    { part: "reply", value: turn.repeated },
    { part: "thinking", value: turn.thinkingRepeated },
  ].filter((m): m is { part: string; value: string } => m.value !== null);
  // A call to ask_caller is not drawn once its question is shown in this message.
  const calls = turn.question !== null ? turn.calls.filter((c) => c.name !== "ask_caller") : turn.calls;
  const thinkingChars = turn.thinking !== null
    ? turn.thinking.chars
    : turn.partial !== null && turn.partial.reasoning !== ""
      ? turn.partial.reasoning.length
      : null;
  const thinkingLabel = thinkingChars !== null
    ? turn.reasonedFor !== null
      ? `Thought for ${turn.reasonedFor}`
      : `Thinking · ${thinkingChars.toLocaleString("en-US")} characters`
    : null;
  // A turn that reasoned but whose thinking is not shown says how long it thought.
  const thoughtForOnly = turn.reasonedFor !== null && thinkingChars === null;
  // A turn whose only call was its question has nothing for a bubble to hold: draw none.
  const thinking = thinkingLabel !== null;
  const hasBubble = thinking || thoughtForOnly || calls.length > 0 || writing || answer !== null;
  return (
    <li data-from="delegation" className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted">
        <Asterisk size={15} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-muted">
          {head.join(" · ")}
          {turn.attempts !== null && (
            <button
              type="button"
              aria-expanded={retriesOpen}
              onClick={() => setRetriesOpen(!retriesOpen)}
              className="ml-2 inline-flex items-center text-warn"
            >
              retried {turn.attempts - 1}×
            </button>
          )}
          {repeatMarkers.map((m) => (
            <span
              key={m.part}
              role="status"
              aria-label={`Turn ${turn.n} may be looping: ${m.part} repeats ${m.value}`}
              className="ml-2 inline-flex items-center gap-1 text-warn font-semibold"
            >
              <Repeat size={12} aria-hidden="true" />
              {m.part} repeats {m.value}
            </span>
          ))}
        </p>
        {turn.attempts !== null && retriesOpen && (
          <ul role="list" aria-label="Retries" className="flex flex-col gap-1 text-xs text-muted">
            {turn.retries.map((r, i) => (
              <li key={i}>
                {r.reason}
                {r.status !== null ? ` · HTTP ${r.status}` : ""}
                {r.wait !== null ? ` · tried again after ${r.wait}` : ""}
              </li>
            ))}
            {retryGap > 0 && (
              <li>{retryGap === 1 ? "1 more attempt, no reason recorded" : `${retryGap} more attempts, no reason recorded`}</li>
            )}
          </ul>
        )}
        {hasBubble && (
        <div data-bubble className="mr-auto flex w-[88%] flex-col gap-2 rounded-2xl border border-line bg-card px-4 py-3">
          {thoughtForOnly ? (
            <p className="text-sm text-muted">Thought for {turn.reasonedFor}</p>
          ) : thinkingLabel !== null ? (
            turn.thinking !== null ? (
              <ThinkingFold name={name} turn={turn} label={thinkingLabel} />
            ) : (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={14} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-90" />
                  {thinkingLabel}
                </summary>
                <pre className="whitespace-pre-wrap text-sm text-muted">{turn.partial?.reasoning ?? ""}</pre>
              </details>
            )
          ) : null}
          {/* The model writes its text before it calls tools, so the text comes first. */}
          {writing && <p className="text-xs text-muted">writing…</p>}
          {answer !== null && <Markdown text={answer} />}
          {calls.length > 0 && (
            <ul aria-label="Tool calls" className="flex flex-col overflow-hidden rounded-xl border border-line">
              {calls.map((call, i) => (
                <CallViewItem key={i} call={call} />
              ))}
            </ul>
          )}
        </div>
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
        {(figures.length > 0 || hasDetails) && (
          <div className="flex items-center gap-1">
            {figures.length > 0 && (
              <p className="text-xs font-mono tabular-nums text-muted">{figures.join(" · ")}</p>
            )}
            {hasDetails && (
              <button
                type="button"
                aria-expanded={open}
                aria-label="Turn details"
                onClick={() => setOpen(!open)}
                className="inline-flex shrink-0 items-center text-muted"
              >
                {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-1 text-xs font-mono tabular-nums text-muted">
            {turn.budget !== null && <p>{turn.budget}</p>}
            {turn.evicted !== null && <p>tool results evicted {turn.evicted}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

// A finished turn's thinking, fetched once when the reader first opens the fold, so the view
// the page holds stays small. The open turn's reasoning is shown directly in its own fold.
type ThinkingState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; text: string }
  | { kind: "failed" };

function ThinkingFold({ name, turn, label }: { name: string; turn: TurnView; label: string }) {
  const [state, setState] = useState<ThinkingState>({ kind: "idle" });
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    // Loads on the first opening, and again on an opening after a failure.
    if (!e.currentTarget.open || state.kind === "loading" || state.kind === "loaded") return;
    setState({ kind: "loading" });
    fetch(`/api/streams/${encodeURIComponent(name)}/thinking/${turn.n}`)
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.json() as Promise<{ text: string }>;
      })
      .then((data) => setState({ kind: "loaded", text: data.text }))
      .catch(() => setState({ kind: "failed" }));
  };
  return (
    <details className="group" onToggle={onToggle}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      {state.kind === "loading" && <p className="text-sm text-muted">Loading…</p>}
      {state.kind === "loaded" && <pre className="whitespace-pre-wrap text-sm text-muted">{state.text}</pre>}
      {state.kind === "failed" && <p className="text-sm text-muted">Could not load the thinking.</p>}
      {turn.thinking !== null && !turn.thinking.complete && (
        <p className="text-xs text-muted">The last moments of thinking before the turn ended may be missing.</p>
      )}
    </details>
  );
}

// A call in one line: the file's name and the lines it read when it names a path, else its first argument.
function callSummary(args: [string, string][]): { text: string; full: string } | null {
  const get = (key: string) => args.find(([k]) => k === key)?.[1];
  const path = get("path");
  if (path === undefined) return args.length > 0 ? { text: args[0][1], full: args[0][1] } : null;
  const name = path.split(/[\\/]/).filter((p) => p !== "").pop() ?? path;
  const start = get("start_line");
  const end = get("end_line");
  const lines = [start !== undefined ? `start ${start}` : null, end !== undefined ? `end ${end}` : null].filter((p) => p !== null);
  return { text: lines.length > 0 ? `${name} · ${lines.join(" ")}` : name, full: path };
}

function CallViewItem({ call }: { call: CallView }) {
  const [open, setOpen] = useState(false);
  const summary = callSummary(call.args);
  const figures = [
    call.status,
    call.result,
    call.time,
    call.exitCode !== null ? `exit ${call.exitCode}` : null,
  ].filter((p): p is string => p !== null);
  return (
    <li className={`border-t border-line px-3 py-2 bg-card first:border-t-0 ${call.ok === false ? "bg-hot/5" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={call.name}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        {call.ok === true && <Check aria-label="succeeded" role="img" size={14} className="text-state-ok" />}
        {call.ok === false && <X aria-label="failed" role="img" size={14} className="text-hot" />}
        <span className="whitespace-nowrap font-mono text-sm font-semibold">{call.name}</span>
        {summary !== null && (
          <span className="min-w-0 grow basis-full truncate font-mono text-sm text-muted sm:basis-auto" title={summary.full}>
            {summary.text}
          </span>
        )}
        {figures.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
            {figures.join(" · ")}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1 font-mono text-sm text-muted">
          {call.args.map(([key, value], i) => (
            <p key={i} className="break-all">{key}: {value}</p>
          ))}
        </div>
      )}
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
