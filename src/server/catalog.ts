// The server-side list filter: the one-row match rule, the query-parameter round
// trip the list page and the /api/streams route both rely on, and the slimmed
// state a cached catalog keeps for every stream.
import { titleOf } from "./titles.ts";
import { STATES, type ListRow, type State, type StreamState } from "./streams.ts";

export interface RowFilter {
  text: string;
  states: ListRow["state"][];
  kind: string | null;
  model: string | null;
  repo: string | null;
  messaged: boolean;            // only runs the caller sent a `message` (format 1.14)
}

export const NO_FILTER: RowFilter = { text: "", states: [], kind: null, model: null, repo: null, messaged: false };

// A row is kept when ALL of the following hold:
//   - the trimmed text is empty, or every whitespace-separated word of it appears,
//     case-insensitively, somewhere in the row's title;
//   - the state set is empty or contains the row's state;
//   - kind is null or equals the row's kind;
//   - model is null or equals the row's model;
//   - repo is null or equals the row's workspace;
//   - messaged is off, or the caller sent the run a message.
// The rows keep their original order.
export function rowMatches(row: ListRow, f: RowFilter): boolean {
  const query = f.text.trim().toLowerCase();
  const words = query === "" ? [] : query.split(/\s+/);
  if (words.length > 0) {
    const title = row.title.toLowerCase();
    if (!words.every((word) => title.includes(word))) return false;
  }
  if (f.states.length > 0 && !f.states.includes(row.state)) return false;
  if (f.kind !== null && row.kind !== f.kind) return false;
  if (f.model !== null && row.model !== f.model) return false;
  if (f.repo !== null && row.workspace !== f.repo) return false;
  if (f.messaged && !row.messaged) return false;
  return true;
}

export function isFiltering(f: RowFilter): boolean {
  return f.text.trim() !== "" || f.states.length > 0 || f.kind !== null || f.model !== null || f.repo !== null || f.messaged;
}

// The query the list page and /api/streams share. A state the page does not know
// is left out, never an error; repeats are dropped.
export function filterFromParams(q: URLSearchParams): RowFilter {
  const states = [...new Set((q.get("state") ?? "").split(","))].filter((s): s is State =>
    (STATES as readonly string[]).includes(s),
  );
  return {
    text: q.get("q") ?? NO_FILTER.text,
    states,
    kind: q.get("kind") || null,
    model: q.get("model") || null,
    repo: q.get("repo") || null,
    messaged: q.get("messaged") === "1",
  };
}

export function filterToParams(f: RowFilter, q: URLSearchParams): void {
  if (f.text !== "") q.set("q", f.text);
  if (f.states.length > 0) q.set("state", f.states.join(","));
  if (f.kind !== null) q.set("kind", f.kind);
  if (f.model !== null) q.set("model", f.model);
  if (f.repo !== null) q.set("repo", f.repo);
  if (f.messaged) q.set("messaged", "1");
}

// The slimmed state a cached catalog keeps: a summary of every stream stays small
// even when the folder holds many. The list row it produces is unchanged.
export function slimState(s: StreamState): StreamState {
  return { ...s, start: slimStart(s.start), end: slimEnd(s.end) };
}

function slimStart(start: Record<string, unknown> | null): Record<string, unknown> | null {
  if (start === null) return null;
  const out: Record<string, unknown> = { title: titleOf(start) };
  for (const key of ["at", "tool", "workspace", "mcp_task", "model_key", "effort", "max_turns", "format"]) {
    if (key in start) out[key] = start[key];
  }
  if ("tools" in start) {
    const tools = start.tools;
    // Empty stays [], non-empty becomes [first]: only its emptiness matters to a row.
    out.tools = Array.isArray(tools) ? (tools.length === 0 ? [] : [tools[0]]) : tools;
  }
  return out;
}

function slimEnd(end: Record<string, unknown> | null): Record<string, unknown> | null {
  if (end === null) return null;
  const out: Record<string, unknown> = {};
  for (const key of ["ended", "ok", "finish_reason", "elapsed_seconds", "turns", "max_turns"]) {
    if (key in end) out[key] = end[key];
  }
  if (typeof end.error === "string") out.error = end.error.split(/\r\n|\n/)[0];
  return out;
}
