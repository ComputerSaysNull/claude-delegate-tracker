// How each state looks, in one place: its icon, its colour and, while a run is in progress,
// the card's tint. A state never differs by colour alone. Class names are written out in
// full so Tailwind finds them.
import { Check, Circle, CircleHelp, Clock, Hourglass, Pause, Scissors, Square, X, type LucideIcon } from "lucide-react";
import type { State } from "../server/streams.ts";

export const STATE_ICON: Record<State, LucideIcon> = {
  live: Circle,
  asking: CircleHelp,
  queued: Clock,
  quiet: Pause,
  ok: Check,
  failed: X,
  stopped: Square,
  "timed out": Hourglass,
  "cut off": Scissors,
};

// The word a reader sees for each state; the stream's own codes ("live", "ok") stay inside.
export const STATE_LABEL: Record<State, string> = {
  live: "Running",
  asking: "Asking",
  queued: "Queued",
  quiet: "Quiet",
  ok: "Done",
  failed: "Failed",
  stopped: "Stopped",
  "timed out": "Timed out",
  "cut off": "Cut off",
};

export const STATE_TEXT: Record<State, string> = {
  live: "text-state-live",
  asking: "text-state-asking",
  queued: "text-state-queued",
  quiet: "text-state-quiet",
  ok: "text-state-ok",
  failed: "text-state-failed",
  stopped: "text-state-stopped",
  "timed out": "text-state-timed-out",
  "cut off": "text-state-cut-off",
};

export const STATE_BADGE: Record<State, string> = {
  live: "bg-state-live/14 text-state-live",
  asking: "bg-state-asking/14 text-state-asking",
  queued: "bg-state-queued/14 text-state-queued",
  quiet: "bg-state-quiet/14 text-state-quiet",
  ok: "bg-state-ok/14 text-state-ok",
  failed: "bg-state-failed/14 text-state-failed",
  stopped: "bg-state-stopped/14 text-state-stopped",
  "timed out": "bg-state-timed-out/14 text-state-timed-out",
  "cut off": "bg-state-cut-off/14 text-state-cut-off",
};

// Every card is tinted in its state's colour. A run in progress (running, asking, queued) is
// tinted more strongly, so live work stands out from finished work. Class names are written
// out in full so Tailwind finds them.
export const CARD_TINT: Record<State, string> = {
  live: "bg-state-live/12 border-state-live/45",
  asking: "bg-state-asking/12 border-state-asking/45",
  queued: "bg-state-queued/10 border-state-queued/35",
  quiet: "bg-state-quiet/8 border-state-quiet/30",
  ok: "bg-state-ok/8 border-state-ok/30",
  failed: "bg-state-failed/8 border-state-failed/35",
  stopped: "bg-state-stopped/8 border-state-stopped/30",
  "timed out": "bg-state-timed-out/8 border-state-timed-out/35",
  "cut off": "bg-state-cut-off/8 border-state-cut-off/35",
};

export function cardClass(state: State): string {
  return CARD_TINT[state];
}

// The state's icon alone, coloured like the badge but without the badge's pill: the list's
// cards lead with it. A running delegation is a filled dot, as the badge draws it. It pulses,
// unless the system asks for reduced motion.
export function StateIcon({ state, size = 16 }: { state: State; size?: number }) {
  const Icon = STATE_ICON[state];
  return (
    <Icon
      size={size}
      strokeWidth={2.2}
      role="img"
      aria-label={STATE_LABEL[state]}
      fill={state === "live" ? "currentColor" : "none"}
      className={`shrink-0 ${STATE_TEXT[state]}${state === "live" ? " motion-safe:animate-pulse" : ""}`}
    />
  );
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
        className={state === "live" ? "motion-safe:animate-pulse" : undefined}
      />
      {STATE_LABEL[state]}
    </span>
  );
}
