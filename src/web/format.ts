// Counts a reader sees at a glance: large totals (tokens, and the like) written short,
// "4.6k" or "1.3M", instead of their full digits, while keeping the exact count under a
// thousand.
export function compactCount(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) {
    const v = (n / 1000).toFixed(1);
    return `${v.endsWith(".0") ? v.slice(0, -2) : v}k`;
  }
  const v = (n / 1_000_000).toFixed(1);
  return `${v.endsWith(".0") ? v.slice(0, -2) : v}M`;
}

// A byte count written short: "512 B", "1.5 KB", "5.7 GB". Below 1024 whole bytes; otherwise
// divide by 1024 into KB, MB, GB, TB, one decimal below 100 and whole at 100 and above; a
// rounding that reaches 1024 rolls up into the next unit ("1.0 MB").
export function bytes(n: number): string {
  if (Math.round(n) < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n;
  let index = -1;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (rounded >= 1024 && index < units.length - 1) {
    index++;
    return `${(value / 1024).toFixed(1)} ${units[index]}`;
  }
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[index]}`;
}
