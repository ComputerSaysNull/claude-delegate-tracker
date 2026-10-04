// The address the page is at: the open delegation in the path (`/s/<name>`, which older
// links already use) and the list's filters in the query. Pure: no React, no history.
// A name read here is only ever looked up in the list the backend itself serves.
import { STATES, type State } from "../server/streams.ts";
import { NO_FILTER, type RowFilter } from "./filter.ts";

export interface Address {
  selected: string | null;
  filter: RowFilter;
}

function decoded(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function readAddress(pathname: string, search: string): Address {
  const name = pathname.startsWith("/s/") ? decoded(pathname.slice(3)) : null;
  const q = new URLSearchParams(search);
  // A state the page does not know is left out, never an error.
  const states = [...new Set((q.get("state") ?? "").split(","))].filter((s): s is State =>
    (STATES as readonly string[]).includes(s),
  );
  return {
    selected: name === null || name === "" ? null : name,
    filter: {
      text: q.get("q") ?? NO_FILTER.text,
      states,
      kind: q.get("kind") || null,
      model: q.get("model") || null,
    },
  };
}

export function addressFor({ selected, filter }: Address): string {
  const q = new URLSearchParams();
  if (filter.text !== "") q.set("q", filter.text);
  if (filter.states.length > 0) q.set("state", filter.states.join(","));
  if (filter.kind !== null) q.set("kind", filter.kind);
  if (filter.model !== null) q.set("model", filter.model);
  const query = q.toString();
  return (selected === null ? "/" : `/s/${encodeURIComponent(selected)}`) + (query === "" ? "" : `?${query}`);
}
