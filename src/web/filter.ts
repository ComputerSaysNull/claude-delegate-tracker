// Pure filter helpers for the delegation list: no React, no side effects.
// The match rule and the query format now live in the server catalog, so the list
// and the /api/streams route filter the same way.
import type { ListRow } from "../server/streams.ts";
import { isFiltering, NO_FILTER, rowMatches, type RowFilter } from "../server/catalog.ts";

export { isFiltering, NO_FILTER };
export type { RowFilter };

// A row is kept when it matches the filter; see catalog.ts for the rule.
export function filterRows(rows: ListRow[], f: RowFilter): ListRow[] {
  return rows.filter((row) => rowMatches(row, f));
}

// The option list for a filter control: the server's choices (which can name a value no
// loaded row has, e.g. one that only an unloaded older page would match) unioned with the
// values the loaded rows show today, sorted.
export function unionChoices(rows: ListRow[], key: "kind" | "model" | "workspace", server: string[]): string[] {
  const seen = new Set<string>(server);
  for (const row of rows) {
    const value = row[key];
    if (value !== null && value !== "") seen.add(value);
  }
  return Array.from(seen).sort();
}
