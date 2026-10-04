// How each state looks, in one place: its icon, its colour and, while a run is in progress,
// the card's tint. A state never differs by colour alone. Class names are written out in
// full so Tailwind finds them.
import { Check, Circle, Clock, Pause, Scissors, X, type LucideIcon } from "lucide-react";
import type { State } from "../server/streams.ts";

export const STATE_ICON: Record<State, LucideIcon> = {
  live: Circle,
  queued: Clock,
  quiet: Pause,
  ok: Check,
  failed: X,
  "cut off": Scissors,
};

// The word a reader sees for each state; the stream's own codes ("live", "ok") stay inside.
export const STATE_LABEL: Record<State, string> = {
  live: "Running",
  queued: "Queued",
  quiet: "Quiet",
  ok: "Done",
  failed: "Failed",
  "cut off": "Cut off",
};

export const STATE_TEXT: Record<State, string> = {
  live: "text-state-live",
  queued: "text-state-queued",
  quiet: "text-state-quiet",
  ok: "text-state-ok",
  failed: "text-state-failed",
  "cut off": "text-state-cut-off",
};

export const STATE_BADGE: Record<State, string> = {
  live: "bg-state-live/14 text-state-live",
  queued: "bg-state-queued/14 text-state-queued",
  quiet: "bg-state-quiet/14 text-state-quiet",
  ok: "bg-state-ok/14 text-state-ok",
  failed: "bg-state-failed/14 text-state-failed",
  "cut off": "bg-state-cut-off/14 text-state-cut-off",
};

// A run in progress is tinted; a finished one stays a plain card and its icon tells the outcome.
export function cardClass(state: State): string {
  if (state === "live") return "bg-state-live/12 border-state-live/45";
  if (state === "queued") return "bg-state-queued/10 border-state-queued/35";
  return "bg-card border-line";
}

export function StateBadge({ state, className = "" }: { state: State; className?: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATE_BADGE[state]} ${className}`}>
      <Icon
        size={state === "live" ? 8 : 13}
        strokeWidth={2.4}
        aria-hidden="true"
        fill={state === "live" ? "currentColor" : "none"}
        className={state === "live" ? "animate-pulse" : undefined}
      />
      {STATE_LABEL[state]}
    </span>
  );
}
