// How each state looks, in one place: its icon, its colour and, while a run is in progress,
// the card's tint. A state never differs by colour alone. Class names are written out in
// full so Tailwind finds them.
import { Check, CircleDot, Clock, Pause, Scissors, X, type LucideIcon } from "lucide-react";
import type { State } from "../server/streams.ts";

export const STATE_ICON: Record<State, LucideIcon> = {
  live: CircleDot,
  queued: Clock,
  quiet: Pause,
  ok: Check,
  failed: X,
  "cut off": Scissors,
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
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${STATE_BADGE[state]} ${className}`}>
      <Icon size={12} strokeWidth={2.4} aria-hidden="true" className={state === "live" ? "animate-pulse" : undefined} />
      {state}
    </span>
  );
}
