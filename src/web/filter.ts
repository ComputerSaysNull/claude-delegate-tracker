// Pure filter helpers for the delegation list: no React, no side effects.
import type { ListRow } from "../server/streams.ts";

export interface RowFilter {
  text: string;
  states: ListRow["state"][];
  kind: string | null;
  model: string | null;
  repo: string | null;
}

export const NO_FILTER: RowFilter = { text: "", states: [], kind: null, model: null, repo: null };

// A row is kept when ALL of the following hold:
//   - the trimmed text is empty, or every whitespace-separated word of it appears,
//     case-insensitively, somewhere in the row's title;
//   - the state set is empty or contains the row's state;
//   - kind is null or equals the row's kind;
//   - model is null or equals the row's model;
//   - repo is null or equals the row's workspace.
// The rows keep their original order.
export function filterRows(rows: ListRow[], f: RowFilter): ListRow[] {
  const query = f.text.trim().toLowerCase();
  const words = query === "" ? [] : query.split(/\s+/);
  return rows.filter((row) => {
    if (words.length > 0) {
      const title = row.title.toLowerCase();
      if (!words.every((word) => title.includes(word))) return false;
    }
    if (f.states.length > 0 && !f.states.includes(row.state)) return false;
    if (f.kind !== null && row.kind !== f.kind) return false;
    if (f.model !== null && row.model !== f.model) return false;
    if (f.repo !== null && row.workspace !== f.repo) return false;
    return true;
  });
}

// True when any part of the filter is set (text counted only after trimming).
export function isFiltering(f: RowFilter): boolean {
  return f.text.trim() !== "" || f.states.length > 0 || f.kind !== null || f.model !== null || f.repo !== null;
}

// The distinct, non-null values for a key, sorted for a stable option list.
export function choices(rows: ListRow[], key: "kind" | "model" | "workspace"): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value !== null && value !== "") seen.add(value);
  }
  return Array.from(seen).sort();
}
