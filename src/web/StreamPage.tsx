// One stream's page: the derived view and its live patches. StreamViewBody is
// split out so the presentational part can be rendered in tests without the hook.
import type { StreamView, TurnView, CallView, SummaryView } from "../server/view.ts";
import type { ListRow } from "../server/streams.ts";
import { useStreamView } from "./useStreamView.ts";
import { STATE_COLOR } from "./DelegationList.tsx";

const WHY_COLOR: Record<ListRow["state"], string> = {
  live: "text-blue-600 dark:text-blue-400",
  queued: "text-amber-600 dark:text-amber-400",
  quiet: "text-slate-500 dark:text-slate-400",
  ok: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  "cut off": "text-orange-600 dark:text-orange-400",
};

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

export function StreamPage({ name }: { name: string }) {
  const { view, connected, missing } = useStreamView(name);
  return (
    <div className="flex flex-col gap-4">
      <a href="/" className="hover:underline">
        ← All delegations
      </a>
      {missing ? (
        <p className="text-slate-500 dark:text-slate-400">No such delegation.</p>
      ) : view === null ? (
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <>
          {!connected && (
            <p className="rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm text-amber-700 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-300">
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
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATE_COLOR[row.state]}`}>
          {row.state}
        </span>
        <span className="min-w-0 truncate font-medium" title={row.title}>
          {row.title}
        </span>
      </div>
      {meta !== "" && <p className="text-sm text-slate-500 dark:text-slate-400">{meta}</p>}
      <p className="text-sm text-slate-500 dark:text-slate-400">
        started {row.startedAt === null ? "—" : new Date(row.startedAt).toLocaleString()}
      </p>
      {row.why !== null && row.why !== "" && (
        <p className={`text-sm ${WHY_COLOR[row.state]}`}>{row.why}</p>
      )}
      {row.unknownFormat !== null && row.unknownFormat !== "" && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          format {row.unknownFormat}: shown as best it can be
        </p>
      )}
      {view.task !== null && (
        <pre className="whitespace-pre-wrap rounded border border-slate-300 p-3 text-sm dark:border-slate-700">
          {view.task}
        </pre>
      )}
      {view.files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {view.files.map((file) => (
            <li key={file.path} className="flex flex-wrap gap-2">
              <span className="min-w-0 truncate font-medium" title={file.path}>
                {file.path}
              </span>
              {file.size !== null && <span className="text-slate-500 dark:text-slate-400">{file.size}</span>}
              {file.skipped !== null && (
                <span className="text-amber-600 dark:text-amber-400">{file.skipped}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.waiting !== null && (
        <p className="text-sm text-amber-600 dark:text-amber-400">{view.waiting}</p>
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
    <section className="rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <h3 className="font-semibold">{turn.heading}</h3>
      {turn.budget !== null && <p className="text-xs text-slate-500 dark:text-slate-400">{turn.budget}</p>}
      {turn.heartbeat !== null && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{turn.heartbeat}</p>
      )}
      <div className="mt-2 flex flex-col gap-3">
        {turn.calls.map((call, i) => (
          <CallViewItem key={i} call={call} />
        ))}
      </div>
      {turn.toolTime !== null && (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">tool time {turn.toolTime}</p>
      )}
      {turn.attempts !== null && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">attempts {turn.attempts}</p>
      )}
      {turn.partial !== null && <TurnPartial partial={turn.partial} />}
      {turn.reply !== null && <pre className="mt-2 whitespace-pre-wrap text-sm">{turn.reply}</pre>}
    </section>
  );
}

function TurnPartial({ partial }: { partial: NonNullable<TurnView["partial"]> }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {partial.answer !== "" && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">writing…</p>
          <pre className="whitespace-pre-wrap">{partial.answer}</pre>
        </>
      )}
      {partial.reasoning !== "" && (
        <details>
          <summary className="text-sm text-slate-500 dark:text-slate-400">reasoning</summary>
          <pre className="whitespace-pre-wrap">{partial.reasoning}</pre>
        </details>
      )}
    </div>
  );
}

function CallViewItem({ call }: { call: CallView }) {
  return (
    <div className="rounded border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <span className="font-medium">{call.name}</span>
        {call.ok === true && <span className="text-green-600 dark:text-green-400">✓</span>}
        {call.ok === false && <span className="text-red-600 dark:text-red-400">✗</span>}
        {call.status !== null && (
          <span className="text-sm text-slate-500 dark:text-slate-400">{call.status}</span>
        )}
      </div>
      {call.args.map(([key, value], i) => (
        <p key={i} className="truncate text-sm text-slate-500 dark:text-slate-400" title={`${key}: ${value}`}>
          {key}: {value}
        </p>
      ))}
      {call.message !== null && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{call.message}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-500 dark:text-slate-400">
        {call.result !== null && <span>{call.result}</span>}
        {call.exitCode !== null && <span>exit {call.exitCode}</span>}
        {call.time !== null && <span>{call.time}</span>}
      </div>
    </div>
  );
}

function SummarySection({ summary }: { summary: SummaryView }) {
  return (
    <section className="rounded-lg border border-slate-300 p-4 dark:border-slate-700">
      <h3 className="font-semibold">Summary</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm">
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
                ? "text-red-600 dark:text-red-400"
                : "text-slate-500 dark:text-slate-400"
            }
          >
            failures {summary.failures.toLocaleString()}
          </p>
        )}
        {summary.toolTime !== null && <p>tool time {summary.toolTime}</p>}
        {summary.finishReason !== null && <p>finish reason {summary.finishReason}</p>}
        {summary.error !== null && (
          <p className="whitespace-pre-wrap text-red-600 dark:text-red-400">{summary.error}</p>
        )}
      </div>
    </section>
  );
}
