// Build a short title from a task's first non-blank line.
export function titleFromTask(task: unknown): string {
  if (typeof task !== "string") return "(no task)";
  let first: string | undefined;
  for (const line of task.split(/\r\n|\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      first = trimmed;
      break;
    }
  }
  if (first === undefined) return "(no task)";
  if (first.length <= 60) return first;
  const slice = first.slice(0, 60);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace).trimEnd() + "\u2026";
  }
  return slice.slice(0, 59).trimEnd() + "\u2026";
}
