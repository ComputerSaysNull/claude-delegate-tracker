// Every time the page shows, in the viewer's local time: streams and figures carry UTC.

// A time of day, for "as of" and "checked at".
export function localTime(iso: string | null): string {
  return iso === null ? "—" : new Date(iso).toLocaleTimeString();
}

// A date and time, for when a delegation started.
export function localDateTime(iso: string | null): string {
  return iso === null
    ? "—"
    : new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
