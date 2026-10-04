// One stream's full derived view for the stream page, and the patch a followed
// stream sends: every rule in docs/ARCHITECTURE.md "Turns and calls", "Heartbeat and
// waiting", "Budget wording", "Tokens", "Failures" and "Absent is not zero" lives here.
import type { ListRow, State, StreamState } from "./streams.ts";
import { formatAge, formatDuration } from "./streams.ts";

export interface FileView {
  path: string;                 // `given` when present, else `path`
  size: string | null;          // from `bytes`, e.g. "1.2 KB"; null when absent
  skipped: string | null;       // a skipped file's `reason`; null for a file that was read
}

export interface CallView {
  name: string;
  ok: boolean | null;           // outcome `ran` or `repeat` → true; another outcome → false; no outcome yet → null
  outcome: string | null;       // the outcome as written, when there is one
  status: string | null;        // while the turn is open: the `running` status from the newest `alive`
  args: [string, string][];     // every argument, in order; a non-string value as JSON
  message: string | null;       // a refusal's `message`, in full
  result: string | null;        // "40 lines, 1.2 KB" from result_lines/result_bytes; whichever exist; null when neither
  exitCode: number | null;
  time: string | null;          // from the call's `ms`: "<1s" under 1 s, else formatDuration
}

export interface TurnView {
  n: number;
  heading: string;              // "turn N of M" when of_turns is present, else "turn N"
  budget: string | null;        // from `priced`; names its turn; null when the turn has no `priced`
  calls: CallView[];
  reply: string | null;         // the closing `turn` event's `text`
  closed: boolean;              // a `turn` event for this number has landed
  heartbeat: string | null;     // open turn only, from the newest `alive` after its `priced`
  partial: { reasoning: string; answer: string } | null; // open turn only: its `partial` text so far
  toolTime: string | null;      // closed turn: Σ calls' ms, else ms − backend_ms when there are calls; null without calls
  attempts: number | null;      // only when above 1
  repeated: string | null;      // turn.duplicate_line_share as a percent, only from 15%
  evicted: number | null;       // turn.tool_results_evicted, only when a number (a measured 0 too)
  tokensIn: number | null;      // closed turn: input_tokens
  tokensOut: number | null;     // closed turn: output_tokens
  tokS: number | null;          // closed turn: out_tok_s, the decode speed
  clock: { elapsed: number; of: number } | null; // open turn: the newest alive's elapsed_seconds of of_seconds
}

// While running, built from the closed turns; null when none of its fields are present.
export interface SummaryView {
  finished: boolean;            // an `end` exists
  ok: boolean | null;           // end.ok; null while running
  elapsed: string | null;
  turns: string | null;         // "2 of 4" / "2"
  cached: number | null;        // finished: end.cached_tokens; running: Σ turns' cached_tokens
  reuse: string | null;         // cached ÷ Σ turns' input_tokens, as a percent "61%"
  returned: number | null;      // finished: end.output_tokens, else the last turn's output_tokens
  load: number | null;          // Σ turns' (input_tokens + output_tokens)
  failures: number | null;      // end.failed_calls, else tool_errors + bash_failures, else null
  toolTime: string | null;      // end.tool_seconds as a duration
  finishReason: string | null;
  error: string | null;         // end.error in full
  shellCalls: number | null;    // end.bash_calls, only above 0
}

export interface StreamView {
  name: string;
  seq: number;                  // bumped each time a read changes the view
  row: ListRow;                 // the list row: state, why, age, title, elapsed, …
  task: string | null;          // start.task in full
  files: FileView[];            // files_read, then files_skipped
  waiting: string | null;       // "queued 3m of 10m" / "queued 3m"; only while the state is queued
  turns: TurnView[];
  summary: SummaryView | null;
}

// What a followed stream sends: never the closed turns it already sent.
export interface ViewPatch {
  name: string;
  seq: number;                  // the page refetches the whole view when this isn't its seq + 1
  row: ListRow;
  waiting: string | null;
  // Only turns that changed since the previous seq. With `append`, the turn's `partial`
  // holds only the text added since then, for the page to add to what it holds.
  turns: { index: number; turn: TurnView; append?: true }[];
  summary: SummaryView | null;
}

// Raw events kept per stream; StreamState (streams.ts) keeps start and end.
export interface ViewState {
  seq: number;
  turns: Map<number, TurnSlot>;
  waiting: Record<string, unknown> | null;
}

export interface TurnSlot {
  priced: Record<string, unknown> | null; tools: Record<string, unknown> | null;
  turn: Record<string, unknown> | null; alive: Record<string, unknown> | null;
  partialReasoning: string; partialAnswer: string; partialSeen: boolean;
}

function newSlot(): TurnSlot {
  return { priced: null, tools: null, turn: null, alive: null, partialReasoning: "", partialAnswer: "", partialSeen: false };
}

export function newViewState(): ViewState {
  return { seq: 0, turns: new Map(), waiting: null };
}

// Feed one parsed event (start and end too, which StreamState keeps); bumps seq and
// returns true when it changes the view. Unknown kinds change nothing.
export function applyViewEvent(v: ViewState, evt: Record<string, unknown>): boolean {
  const t = evt.t;
  if (t === "start" || t === "end") {
    v.seq += 1;
    return true;
  }
  if (t === "priced" || t === "tools" || t === "turn") {
    const turn = evt.turn;
    if (typeof turn !== "number") return false;
    let slot = v.turns.get(turn);
    if (slot === undefined) {
      slot = newSlot();
      v.turns.set(turn, slot);
    }
    if (t === "priced") slot.priced = evt;
    else if (t === "tools") slot.tools = evt;
    else slot.turn = evt;
    v.seq += 1;
    return true;
  }
  if (t === "partial") {
    const turn = evt.turn;
    if (typeof turn !== "number") return false;
    let slot = v.turns.get(turn);
    if (slot === undefined) {
      slot = newSlot();
      v.turns.set(turn, slot);
    }
    if (typeof evt.reasoning === "string") slot.partialReasoning += evt.reasoning;
    if (typeof evt.answer === "string") slot.partialAnswer += evt.answer;
    slot.partialSeen = true;
    v.seq += 1;
    return true;
  }
  if (t === "alive") {
    let highest = -1;
    for (const [key, slot] of v.turns) {
      if (slot.priced !== null && key > highest) highest = key;
    }
    if (highest === -1) return false;
    const slot = v.turns.get(highest);
    if (slot !== undefined) slot.alive = evt;
    v.seq += 1;
    return true;
  }
  if (t === "waiting") {
    v.waiting = evt;
    v.seq += 1;
    return true;
  }
  return false;
}

function recordOf(x: unknown): Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? x as Record<string, unknown> : {};
}

function argsOf(args: unknown): [string, string][] {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
  return Object.entries(args as Record<string, unknown>).map(([k, val]) =>
    [k, typeof val === "string" ? val : JSON.stringify(val) ?? "undefined"]);
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resultOf(call: Record<string, unknown>): string | null {
  const lines = typeof call.result_lines === "number" ? call.result_lines : null;
  const bytes = typeof call.result_bytes === "number" ? call.result_bytes : null;
  if (lines === null && bytes === null) return null;
  const parts: string[] = [];
  if (lines !== null) parts.push(`${lines} lines`);
  if (bytes !== null) parts.push(sizeOf(bytes));
  return parts.join(", ");
}

function formatMs(ms: number): string {
  return ms < 1000 ? "<1s" : formatDuration(ms / 1000);
}

function timeOf(ms: unknown): string | null {
  return typeof ms === "number" ? formatMs(ms) : null;
}

function statusAt(running: unknown[], index: number, name: string): string | null {
  const entry = running[index];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (e.name !== name) return null;
  return typeof e.status === "string" ? e.status : null;
}

function callView(call: Record<string, unknown>, status: string | null): CallView {
  const outcome = call.outcome;
  let ok: boolean | null = null;
  if (outcome === "ran" || outcome === "repeat") ok = true;
  else if (typeof outcome === "string") ok = false;
  return {
    name: typeof call.name === "string" ? call.name : "",
    ok,
    outcome: typeof outcome === "string" ? outcome : null,
    status,
    args: argsOf(call.arguments),
    message: typeof call.message === "string" ? call.message : null,
    result: resultOf(call),
    exitCode: typeof call.exit_code === "number" ? call.exit_code : null,
    time: timeOf(call.ms),
  };
}

function callsOf(slot: TurnSlot, closed: boolean): CallView[] {
  if (closed) {
    const calls = slot.turn?.tool_calls;
    if (!Array.isArray(calls)) return [];
    return calls.map((c) => callView(recordOf(c), null));
  }
  const fromTools = slot.tools?.tool_calls;
  const running = Array.isArray(slot.alive?.running) ? (slot.alive as Record<string, unknown>).running as unknown[] : [];
  const calls: unknown[] = Array.isArray(fromTools) ? fromTools : running;
  return calls.map((c, i) => {
    const rec = recordOf(c);
    return callView(rec, statusAt(running, i, typeof rec.name === "string" ? rec.name : ""));
  });
}

function budgetOf(priced: Record<string, unknown> | null): string | null {
  if (priced === null || typeof priced.turn !== "number") return null;
  const turn = priced.turn;
  const pieces: string[] = [`turn ${turn}`];
  if (typeof priced.max_tokens === "number") pieces.push(`max_tokens ${priced.max_tokens}`);
  if ("budget_ceiling" in priced) {
    if (priced.budget_ceiling === null) pieces.push("no cap");
    else if (typeof priced.budget_ceiling === "number") pieces.push(`cap ${priced.budget_ceiling}`);
  }
  const running = priced.requests_running;
  if (typeof running === "number") {
    const rs = priced.rate_source;
    if (rs === "cluster_since_boot") pieces.push(`${running} running`);
    else if (rs === "observed_at_concurrency" || rs === "own_turns") pieces.push(`priced for ${running}`);
    else pieces.push(`concurrency ${running}`);
  }
  return pieces.join(" · ");
}

function heartbeatOf(slot: TurnSlot): string | null {
  const alive = slot.alive;
  if (alive === null) return null;
  const pieces: string[] = [];
  const chunks = alive.chunks_seen;
  if (typeof chunks === "number" && chunks > 0) {
    let piece = `${chunks} chunks`;
    const reasoning = alive.reasoning_chunks;
    if (typeof reasoning === "number") {
      const answering = typeof alive.answer_chunks === "number" ? alive.answer_chunks : chunks - reasoning;
      piece += ` (${reasoning} thinking / ${answering} answering)`;
    }
    pieces.push(piece);
  } else {
    pieces.push("still running");
  }
  if (typeof alive.since_chunk_seconds === "number" && alive.since_chunk_seconds >= 2) {
    pieces.push(`${formatAge(alive.since_chunk_seconds)} since the last chunk`);
  }
  if (typeof alive.ends_in_seconds === "number") {
    pieces.push(`ends in ${formatDuration(alive.ends_in_seconds)}`);
  }
  return pieces.join(" · ");
}

function toolTimeOf(slot: TurnSlot): string | null {
  const calls = slot.turn?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const c of calls) {
    if (typeof c === "object" && c !== null && !Array.isArray(c)) {
      const ms = (c as Record<string, unknown>).ms;
      if (typeof ms === "number") { sum += ms; any = true; }
    }
  }
  if (any) return formatMs(sum);
  const ms = slot.turn?.ms;
  const backend = slot.turn?.backend_ms;
  if (typeof ms === "number" && typeof backend === "number") return formatMs(ms - backend);
  return null;
}

function ofTurnsOf(slot: TurnSlot): number | null {
  for (const e of [slot.turn, slot.priced, slot.tools]) {
    if (e !== null && typeof e.of_turns === "number") return e.of_turns;
  }
  return null;
}

function partialOf(slot: TurnSlot, closed: boolean): { reasoning: string; answer: string } | null {
  if (closed || !slot.partialSeen) return null;
  return { reasoning: slot.partialReasoning, answer: slot.partialAnswer };
}

function buildTurn(n: number, slot: TurnSlot): TurnView {
  const closed = slot.turn !== null;
  const of = ofTurnsOf(slot);
  const reply = slot.turn?.text;
  const attempts = slot.turn?.attempts;
  const share = slot.turn?.duplicate_line_share;
  const evicted = slot.turn?.tool_results_evicted;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const elapsed = num(slot.alive?.elapsed_seconds);
  const budget = num(slot.alive?.of_seconds);
  return {
    n,
    heading: of === null ? `turn ${n}` : `turn ${n} of ${of}`,
    budget: budgetOf(slot.priced),
    calls: callsOf(slot, closed),
    reply: typeof reply === "string" ? reply : null,
    closed,
    heartbeat: closed ? null : heartbeatOf(slot),
    partial: partialOf(slot, closed),
    toolTime: closed ? toolTimeOf(slot) : null,
    attempts: typeof attempts === "number" && attempts > 1 ? attempts : null,
    repeated: typeof share === "number" && share >= 0.15 ? `${Math.round(share * 100)}%` : null,
    // The schema also allows a boolean here, which says nothing countable.
    evicted: typeof evicted === "number" ? evicted : null,
    tokensIn: num(slot.turn?.input_tokens),
    tokensOut: num(slot.turn?.output_tokens),
    tokS: num(slot.turn?.out_tok_s),
    clock: !closed && elapsed !== null && budget !== null && budget > 0 ? { elapsed, of: budget } : null,
  };
}

function fileView(e: unknown): FileView | null {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return null;
  const rec = e as Record<string, unknown>;
  const path = typeof rec.given === "string" ? rec.given : (typeof rec.path === "string" ? rec.path : null);
  if (path === null) return null;
  return {
    path,
    size: typeof rec.bytes === "number" ? sizeOf(rec.bytes) : null,
    skipped: typeof rec.reason === "string" ? rec.reason : null,
  };
}

function filesOf(start: Record<string, unknown> | null): FileView[] {
  const out: FileView[] = [];
  if (start === null) return out;
  const read = Array.isArray(start.files_read) ? start.files_read : [];
  const skipped = Array.isArray(start.files_skipped) ? start.files_skipped : [];
  for (const e of read) { const f = fileView(e); if (f !== null) out.push(f); }
  for (const e of skipped) { const f = fileView(e); if (f !== null) out.push(f); }
  return out;
}

function waitingOf(waiting: Record<string, unknown> | null, state: State): string | null {
  if (state !== "queued" || waiting === null) return null;
  const waited = waiting.waited_seconds;
  if (typeof waited !== "number") return null;
  let s = `queued ${formatAge(waited)}`;
  const of = waiting.of_seconds;
  if (typeof of === "number" && of > 0) s += ` of ${formatAge(of)}`;
  return s;
}

function summaryTurns(s: StreamState): string | null {
  const end = s.end;
  const used = end !== null && typeof end.turns === "number" ? end.turns : s.maxTurn;
  let of: number | null = null;
  if (end !== null && typeof end.max_turns === "number") of = end.max_turns;
  else if (s.start !== null && typeof s.start.max_turns === "number") of = s.start.max_turns;
  else if (typeof s.ofTurns === "number") of = s.ofTurns;
  return of === null ? (used === 0 ? null : String(used)) : `${used} of ${of}`;
}

function buildSummary(s: StreamState, closedTurns: TurnSlot[]): SummaryView | null {
  const end = s.end;
  const finished = end !== null;
  const ok = end !== null && typeof end.ok === "boolean" ? end.ok : null;
  const elapsed = end !== null && typeof end.elapsed_seconds === "number" ? formatDuration(end.elapsed_seconds) : null;
  const turns = summaryTurns(s);

  let cached: number | null;
  if (end !== null) cached = typeof end.cached_tokens === "number" ? end.cached_tokens : null;
  else {
    let sum = 0;
    let any = false;
    for (const slot of closedTurns) {
      const c = slot.turn?.cached_tokens;
      if (typeof c === "number") { sum += c; any = true; }
    }
    cached = any ? sum : null;
  }

  let inputSum = 0;
  let inputAny = false;
  for (const slot of closedTurns) {
    const inp = slot.turn?.input_tokens;
    if (typeof inp === "number") { inputSum += inp; inputAny = true; }
  }
  const reuse = cached !== null && inputAny && inputSum > 0 ? `${Math.round((cached / inputSum) * 100)}%` : null;

  let returned: number | null = null;
  if (end !== null) {
    if (typeof end.output_tokens === "number") returned = end.output_tokens;
    else {
      for (let i = closedTurns.length - 1; i >= 0; i--) {
        const ot = closedTurns[i].turn?.output_tokens;
        if (typeof ot === "number") { returned = ot; break; }
      }
    }
  }

  let load = 0;
  let loadAny = false;
  for (const slot of closedTurns) {
    const inp = slot.turn?.input_tokens;
    const ot = slot.turn?.output_tokens;
    if (typeof inp === "number") { load += inp; loadAny = true; }
    if (typeof ot === "number") { load += ot; loadAny = true; }
  }
  const loadVal = loadAny ? load : null;

  let failures: number | null = null;
  if (end !== null) {
    if (typeof end.failed_calls === "number") failures = end.failed_calls;
    else if (typeof end.tool_errors === "number" && typeof end.bash_failures === "number") failures = end.tool_errors + end.bash_failures;
  }

  const toolTime = end !== null && typeof end.tool_seconds === "number" ? formatDuration(end.tool_seconds) : null;
  const finishReason = end !== null && typeof end.finish_reason === "string" ? end.finish_reason : null;
  const error = end !== null && typeof end.error === "string" && end.error !== "" ? end.error : null;
  const shellCalls = end !== null && typeof end.bash_calls === "number" && end.bash_calls > 0 ? end.bash_calls : null;

  if (elapsed === null && turns === null && cached === null && reuse === null && returned === null &&
      loadVal === null && failures === null && toolTime === null && finishReason === null && error === null &&
      shellCalls === null) return null;
  return { finished, ok, elapsed, turns, cached, reuse, returned, load: loadVal, failures, toolTime, finishReason, error, shellCalls };
}

export function buildView(name: string, v: ViewState, s: StreamState, row: ListRow): StreamView {
  const turns: TurnView[] = [];
  const closedTurns: TurnSlot[] = [];
  const keys = Array.from(v.turns.keys()).sort((a, b) => a - b);
  for (const n of keys) {
    const slot = v.turns.get(n);
    if (slot === undefined) continue;
    turns.push(buildTurn(n, slot));
    if (slot.turn !== null) closedTurns.push(slot);
  }
  const task = s.start?.task;
  return {
    name,
    seq: v.seq,
    row,
    task: typeof task === "string" ? task : null,
    files: filesOf(s.start),
    waiting: waitingOf(v.waiting, row.state),
    turns,
    summary: buildSummary(s, closedTurns),
  };
}

// A changed turn is sent as an append only when the new partial extends the old one.
function appendDiff(prevTurn: TurnView | undefined, nextTurn: TurnView): { turn: TurnView; append: true } | null {
  const prevP = prevTurn?.partial;
  const nextP = nextTurn.partial;
  if (prevP === undefined || prevP === null || nextP === null) return null;
  if (!nextP.reasoning.startsWith(prevP.reasoning) || !nextP.answer.startsWith(prevP.answer)) return null;
  return {
    turn: {
      ...nextTurn,
      partial: {
        reasoning: nextP.reasoning.slice(prevP.reasoning.length),
        answer: nextP.answer.slice(prevP.answer.length),
      },
    },
    append: true,
  };
}

// The patch from the view last sent to the view now: only turns whose content changed.
export function diffView(prev: StreamView | null, next: StreamView): ViewPatch {
  const turns: { index: number; turn: TurnView; append?: true }[] = [];
  if (prev === null) {
    next.turns.forEach((turn, i) => turns.push({ index: i, turn }));
  } else {
    next.turns.forEach((turn, i) => {
      if (JSON.stringify(prev.turns[i]) !== JSON.stringify(turn)) {
        const appended = appendDiff(prev.turns[i], turn);
        if (appended === null) turns.push({ index: i, turn });
        else turns.push({ index: i, turn: appended.turn, append: true });
      }
    });
  }
  return { name: next.name, seq: next.seq, row: next.row, waiting: next.waiting, turns, summary: next.summary };
}
