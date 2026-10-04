// Build stream state from transcript events, and a list row for the page.
import { titleOf } from "./titles.ts";

export const STATES = ["live", "asking", "queued", "quiet", "ok", "failed", "cut off"] as const;
export type State = (typeof STATES)[number];
export const KNOWN_MAJOR = 1;

export interface StreamState {
  start: Record<string, unknown> | null;
  end: Record<string, unknown> | null;
  lastAtMs: number | null;
  lastSignal: "waiting" | "priced" | "turn" | "alive" | "end" | null;
  waitedSeconds: number | null;
  maxTurn: number;
  ofTurns: number | null;
  badLines: number;
  waitOfSeconds: number | null;  // the newest `waiting.of_seconds`: how long it may wait
  endsInSeconds: number | null;  // the newest `alive.ends_in_seconds`: the deadline that ends the run
  askedAtMs: number | null;      // when the open `question` was asked; null once answered
}

export function newStreamState(): StreamState {
  return { start: null, end: null, lastAtMs: null, lastSignal: null, waitedSeconds: null, maxTurn: 0, ofTurns: null, badLines: 0, waitOfSeconds: null, endsInSeconds: null, askedAtMs: null };
}

// Normalise a 6-digit (or any) fraction to at most 3 digits before Date.parse.
export function parseAt(at: unknown): number | null {
  if (typeof at !== "string") return null;
  let s = at;
  const m = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)/.exec(s);
  if (m) s = m[1] + "." + m[2].slice(0, 3) + s.slice(m[0].length);
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

// Returns the event, so the stream view can use it too; null for a line that is not one.
export function applyLine(s: StreamState, line: string): Record<string, unknown> | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { s.badLines += 1; return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const evt = value as Record<string, unknown>;
  const atMs = parseAt(evt.at);
  if (atMs !== null && (s.lastAtMs === null || atMs > s.lastAtMs)) s.lastAtMs = atMs;
  const t = evt.t;
  if (t === "start") s.start = evt;
  else if (t === "end") { s.end = evt; s.lastSignal = "end"; }
  else if (t === "waiting") {
    s.lastSignal = "waiting";
    if (typeof evt.waited_seconds === "number") s.waitedSeconds = evt.waited_seconds;
    s.waitOfSeconds = typeof evt.of_seconds === "number" ? evt.of_seconds : null;
  }
  else if (t === "priced" || t === "turn") {
    s.lastSignal = t;
    if (typeof evt.turn === "number") s.maxTurn = Math.max(s.maxTurn, evt.turn);
    if (typeof evt.of_turns === "number") s.ofTurns = evt.of_turns;
  } else if (t === "question") s.askedAtMs = atMs ?? s.lastAtMs;
  else if (t === "answer") s.askedAtMs = null;
  else if (t === "alive") {
    s.lastSignal = "alive";
    s.endsInSeconds = typeof evt.ends_in_seconds === "number" ? evt.ends_in_seconds : null;
  }
  return evt;
}

function stateOf(s: StreamState, nowMs: number, quietAfterSeconds: number): State {
  if (s.end !== null && s.end.ok === false) return "failed";
  if (s.end !== null && s.end.ok === true && (s.end.finish_reason === "length" || s.end.finish_reason === "content_filter")) return "cut off";
  if (s.end !== null) return "ok";
  // Waiting on its caller is not going quiet, however long the answer takes.
  if (s.askedAtMs !== null) return "asking";
  if (s.lastAtMs === null || nowMs - s.lastAtMs >= quietAfterSeconds * 1000) return "quiet";
  return s.lastSignal === "waiting" ? "queued" : "live";
}

function kindOf(s: StreamState): string {
  if (s.start === null) return "?";
  const tools = s.start.tools;
  if (tools === undefined) return "?";
  if (Array.isArray(tools) && tools.length === 0) return "one-shot";
  return typeof s.start.tool === "string" ? s.start.tool : "?";
}

function whyOf(state: State, s: StreamState): string | null {
  if (state === "failed") {
    const err = s.end?.error;
    if (typeof err === "string" && err !== "") return err.split(/\r\n|\n/)[0];
    return null;
  }
  if (state === "cut off") {
    if (s.end?.finish_reason === "length") return "hit the token limit: raise max_tokens or split the task";
    if (s.end?.finish_reason === "content_filter") return "the endpoint stopped it";
  }
  return null;
}

function ageOf(state: State, s: StreamState, nowMs: number): string | null {
  if (state === "quiet") return s.lastAtMs === null ? null : formatAge(Math.floor((nowMs - s.lastAtMs) / 1000));
  if (state === "queued") return s.waitedSeconds === null ? null : formatAge(s.waitedSeconds);
  if (state === "asking") return s.askedAtMs === null ? null : formatAge(Math.floor((nowMs - s.askedAtMs) / 1000));
  return null;
}

function elapsedOf(s: StreamState, nowMs: number): string | null {
  if (s.end !== null) return typeof s.end.elapsed_seconds === "number" ? formatDuration(s.end.elapsed_seconds) : null;
  const startMs = parseAt(s.start?.at);
  return startMs === null ? null : formatDuration((nowMs - startMs) / 1000);
}

function turnsOf(s: StreamState): string | null {
  const used = s.end !== null && typeof s.end.turns === "number" ? s.end.turns : s.maxTurn;
  let of: number | null = null;
  if (s.end !== null && typeof s.end.max_turns === "number") of = s.end.max_turns;
  else if (s.start !== null && typeof s.start.max_turns === "number") of = s.start.max_turns;
  else if (typeof s.ofTurns === "number") of = s.ofTurns;
  return of === null ? (used === 0 ? null : String(used)) : `${used} of ${of}`;
}

function unknownFormatOf(s: StreamState): string | null {
  const fmt = s.start?.format;
  if (typeof fmt !== "string") return null; // missing means 1.0, known
  return fmt.split(".")[0] === String(KNOWN_MAJOR) ? null : fmt;
}

export function listRow(name: string, s: StreamState, now: Date, quietAfterSeconds: number): ListRow {
  const nowMs = now.getTime();
  const state = stateOf(s, nowMs, quietAfterSeconds);
  const startMs = parseAt(s.start?.at);
  return {
    name,
    state,
    why: whyOf(state, s),
    age: ageOf(state, s, nowMs),
    kind: kindOf(s),
    model: typeof s.start?.model_key === "string" ? s.start.model_key : null,
    effort: typeof s.start?.effort === "string" ? s.start.effort : null,
    title: titleOf(s.start),
    startedAt: startMs === null ? null : new Date(startMs).toISOString(),
    elapsed: elapsedOf(s, nowMs),
    turns: turnsOf(s),
    unknownFormat: unknownFormatOf(s),
    // As the newest heartbeat gives it, never a deadline of our own.
    left: state === "live" && s.endsInSeconds !== null ? formatDuration(s.endsInSeconds) : null,
    // A limit of 0 is no limit.
    queueOf: state === "queued" && s.waitOfSeconds !== null && s.waitOfSeconds > 0 ? formatAge(s.waitOfSeconds) : null,
  };
}

export interface ListRow {
  name: string; state: State; why: string | null; age: string | null; kind: string;
  model: string | null; effort: string | null; title: string; startedAt: string | null;
  elapsed: string | null; turns: string | null; unknownFormat: string | null;
  left: string | null;          // a running delegation's time left
  queueOf: string | null;       // a queued delegation's longest wait
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)); // clock skew can make a fresh age negative
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  return minutes < 90 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
