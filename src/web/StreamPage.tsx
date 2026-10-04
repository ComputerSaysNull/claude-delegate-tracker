// One stream's page: the derived view and its live patches. StreamViewBody is
// split out so the presentational part can be rendered in tests without the hook.
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
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StateBadge state={row.state} />
        <span className="min-w-0 truncate font-medium" title={row.title}>
          {row.title}
        </span>
      </div>
      {meta !== "" && <p className="text-sm font-mono tabular-nums text-muted">{meta}</p>}
      <p className="text-sm font-mono tabular-nums text-muted">
        started {localDateTime(row.startedAt)}
      </p>
      {row.why !== null && row.why !== "" && (
        <p className={`text-sm ${STATE_TEXT[row.state]}`}>{row.why}</p>
      )}
      {row.unknownFormat !== null && row.unknownFormat !== "" && (
        <p className="text-sm text-warn">
          format {row.unknownFormat}: shown as best it can be
        </p>
      )}
      {view.task !== null && (
        <pre className="whitespace-pre-wrap rounded border border-line p-3 font-mono tabular-nums text-sm">
          {view.task}
        </pre>
      )}
      {view.files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {view.files.map((file) => (
            <li key={file.path} className="flex flex-wrap gap-2">
              <Clipped text={file.path} className="font-medium" />
              {file.size !== null && <span className="font-mono tabular-nums text-muted">{file.size}</span>}
              {file.skipped !== null && (
                <span className="text-warn">{file.skipped}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.waiting !== null && (
        <p className="text-sm font-mono tabular-nums text-warn">{view.waiting}</p>
      )}
      {view.turns.map((turn) => (
        <TurnSection key={turn.n} turn={turn} />
      ))}
      {view.summary !== null && <SummarySection summary={view.summary} />}
    </section>
  );
}

function TurnSection({ turn }: { turn: TurnView }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold font-mono tabular-nums">{turn.heading}</h3>
      {turn.budget !== null && <p className="text-xs font-mono tabular-nums text-muted">{turn.budget}</p>}
      {turn.heartbeat !== null && (
        <p className="text-xs font-mono tabular-nums text-muted">{turn.heartbeat}</p>
      )}
      <div className="mt-2 flex flex-col gap-3">
        {turn.calls.map((call, i) => (
          <CallViewItem key={i} call={call} />
        ))}
      </div>
      {turn.toolTime !== null && (
        <p className="mt-2 text-sm font-mono tabular-nums text-muted">tool time {turn.toolTime}</p>
      )}
      {turn.attempts !== null && (
        <p className="mt-1 text-sm font-mono tabular-nums text-muted">attempts {turn.attempts}</p>
      )}
      {turn.repeated !== null && (
        <p className="mt-1 text-sm font-mono tabular-nums text-muted">repeated output {turn.repeated}</p>
      )}
      {turn.evicted !== null && (
        <p className="mt-1 text-sm font-mono tabular-nums text-muted">tool results evicted {turn.evicted}</p>
      )}
      {turn.partial !== null && <TurnPartial partial={turn.partial} />}
      {turn.reply !== null && <pre className="mt-2 whitespace-pre-wrap font-mono tabular-nums text-sm">{turn.reply}</pre>}
    </section>
  );
}

function TurnPartial({ partial }: { partial: NonNullable<TurnView["partial"]> }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {partial.answer !== "" && (
        <>
          <p className="text-xs text-muted">writing…</p>
          <pre className="whitespace-pre-wrap font-mono tabular-nums">{partial.answer}</pre>
        </>
      )}
      {partial.reasoning !== "" && (
        <details>
          <summary className="text-sm text-muted">reasoning</summary>
          <pre className="whitespace-pre-wrap font-mono tabular-nums">{partial.reasoning}</pre>
        </details>
      )}
    </div>
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
    <div className="rounded border border-line p-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{call.name}</span>
        {call.ok === true && <span className="text-state-ok">✓</span>}
        {call.ok === false && <span className="text-hot">✗</span>}
        {call.status !== null && (
          <span className="text-sm font-mono tabular-nums text-muted">{call.status}</span>
        )}
      </div>
      {call.args.map(([key, value], i) => (
        <Clipped key={i} text={`${key}: ${value}`} className="text-sm font-mono tabular-nums text-muted" />
      ))}
      {call.message !== null && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-hot">{call.message}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-2 text-sm font-mono tabular-nums text-muted">
        {call.result !== null && <span>{call.result}</span>}
        {call.exitCode !== null && <span>exit {call.exitCode}</span>}
        {call.time !== null && <span>{call.time}</span>}
      </div>
    </div>
  );
}

function SummarySection({ summary }: { summary: SummaryView }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">Summary</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm font-mono tabular-nums">
        {summary.elapsed !== null && <p>elapsed {summary.elapsed}</p>}
        {summary.turns !== null && <p>turns {summary.turns}</p>}
        {summary.cached !== null && <p>cached {summary.cached.toLocaleString()}</p>}
        {summary.reuse !== null && <p>reuse {summary.reuse}</p>}
        {summary.returned !== null && <p>returned {summary.returned.toLocaleString()}</p>}
        {summary.load !== null && <p>load {summary.load.toLocaleString()}</p>}
        {summary.failures !== null && (
          <p
            className={
              summary.failures > 0
                ? "text-hot"
                : "text-muted"
            }
          >
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
    </section>
  );
}
