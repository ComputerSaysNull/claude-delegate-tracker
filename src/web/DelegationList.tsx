import type { ListResponse } from "../server/poller.ts";
import type { ListRow } from "../server/streams.ts";

export const STATE_COLOR: Record<ListRow["state"], string> = {
  live: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  quiet: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  ok: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  "cut off": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

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

function startLine(row: ListRow): string {
  const time =
    row.startedAt === null
      ? "—"
      : new Date(row.startedAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  let text = time;
  if (row.age !== null && row.age !== "") {
    if (row.state === "quiet") text += ` · quiet for ${row.age}`;
    else if (row.state === "queued") text += ` · queued ${row.age}`;
  }
  return text;
}

export function DelegationList({ list }: { list: ListResponse | null }) {
  if (list === null) {
    return <p className="text-slate-500 dark:text-slate-400">Waiting for the first list…</p>;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Delegations</h2>
      {list.capped && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Showing the newest {list.rows.length} of {list.total.toLocaleString()}
        </p>
      )}
      {list.rows.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">No delegations yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {list.rows.map((row) => {
            const meta = metaLine(row);
            return (
              <li key={row.name} className="rounded-lg border border-slate-300 p-4 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATE_COLOR[row.state]}`}>
                    {row.state}
                  </span>
                  <a
                    href={"/s/" + encodeURIComponent(row.name)}
                    className="min-w-0 truncate font-medium hover:underline"
                    title={row.title}
                  >
                    {row.title}
                  </a>
                </div>
                {meta !== "" && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{meta}</p>
                )}
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{startLine(row)}</p>
                {row.why !== null && row.why !== "" && (
                  <p className={`mt-1 text-sm ${WHY_COLOR[row.state]}`}>{row.why}</p>
                )}
                {row.unknownFormat !== null && row.unknownFormat !== "" && (
                  <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                    format {row.unknownFormat}: shown as best it can be
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
