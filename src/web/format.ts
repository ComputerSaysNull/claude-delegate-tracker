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
