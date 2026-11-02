// The address the page is at: the section (`/` for the list, `/cluster` for the cluster), the open delegation in the path (`/s/<name>`, which older links already use) and the list's filters in the query. Pure: no React, no history. A name read here is only ever looked up in the list the backend itself serves. The query format lives in the server catalog, shared with /api/streams.
import { filterFromParams, filterToParams } from "../server/catalog.ts";
import type { RowFilter } from "./filter.ts";

export interface Address {
  selected: string | null;
  filter: RowFilter;
  section: "list" | "cluster" | "history";
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
  return {
    section: pathname === "/cluster" ? "cluster" : pathname === "/history" ? "history" : "list",
    selected: name === null || name === "" ? null : name,
    filter: filterFromParams(new URLSearchParams(search)),
  };
}

export function addressFor({ selected, filter, section }: Address): string {
  const q = new URLSearchParams();
  filterToParams(filter, q);
  const query = q.toString();
  const path =
    selected !== null
      ? `/s/${encodeURIComponent(selected)}`
      : section === "cluster"
        ? "/cluster"
        : section === "history"
          ? "/history"
          : "/";
  return path + (query === "" ? "" : `?${query}`);
}
