// Every time the page shows, in the viewer's local time: streams and figures carry UTC.
// Written out by hand rather than by the browser's locale, so it reads the same everywhere:
// a 24-hour clock, and dates as "12 Nov", with the year only when it is not this year.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (n: number): string => String(n).padStart(2, "0");
const clock = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}`;

// A time of day, for "as of" and "checked at".
export function localTime(iso: string | null): string {
  return iso === null ? "—" : clock(new Date(iso));
}

// A date and time, for when a delegation started.
export function localDateTime(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${clock(d)}`;
}
