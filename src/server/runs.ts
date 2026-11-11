// One record per finished run, kept on disk and checked against the streams.
import fs from "node:fs";
import path from "node:path";
import { listNewest } from "./folder.ts";
import { applyLine, newStreamState, parseAt, stateOf, WHY_TIMED_OUT } from "./streams.ts";

export type Outcome = "ok" | "failed" | "stopped" | "timed out" | "cut off";

// One 15-minute window of a run's work: [slot start ms (a multiple of SLOT_MS), input, cached, output, rebuilt].
// Each figure is the sum of what the turns finishing in that window reported, null when none of them reported it.
export type Slot = [number, number | null, number | null, number | null, number | null];
export const SLOT_MS = 15 * 60 * 1000;

export interface RunRecord {
  name: string;            // the stream's file name
  size: number;            // the file's size in bytes when summarised
  startedAt: number | null; // ms, from start.at (parseAt)
  outcome: Outcome;        // stateOf on the finished stream (streams.ts)
  reason: string | null;   // why it did not finish, as a short category, null for "ok"
  repo: string | null;     // start.workspace, or inferred from the paths a stream read
  repoFromPaths: boolean;  // true when repo came from the paths, false when the stream named it or it is null
  model: string | null;    // start.model_key
  mcpTask: boolean | null; // start.mcp_task (format 1.12): false when the call ran inline; null when the stream does not say or on a record saved before this field
  elapsedSeconds: number | null; // end.elapsed_seconds
  inputTokens: number | null;    // end.input_tokens, or the turns' sum when higher or when end has none
  outputTokens: number | null;   // the same, from end.output_tokens and the turns
  cachedTokens: number | null;   // the same, from end.cached_tokens and the turns
  rebuiltTurns: number | null;   // turns that rebuilt their prompt because the saved one was gone; null when the stream reported no cached tokens
  slots: Slot[];                 // 15-minute windows of the turns' work, by slot start, ascending
  asks: number | null;      // question events: how many times it called ask_caller; null on a record saved before this field
  questions: number | null; // the questions those events held (each one's questions array, string entries only)
  messages: number | null;      // message events the caller sent the run; null on a record saved before this field
  undelivered: number | null;   // of those, how many never reached the run
  messageWaits: number[] | null; // the queued_seconds of the delivered ones, in order
}

export interface RunsStatus {
  records: number;           // how many records are kept
  checkedAt: number | null;  // ms of the last full check against the folder; null before the first
  checked: number;           // records whose stream was present and re-read in that check
  disagreed: number;         // of those, how many differed from the record and were rebuilt
  missing: number;           // records whose stream is no longer in the folder (kept)
  writeError: string | null; // the last error writing the file, null when the last write worked
}

// Version 2 added rebuiltTurns; version 3 added slots. An older file is rebuilt from the streams.
const VERSION = 3;

function reasonOf(outcome: Outcome, end: Record<string, unknown> | null): string | null {
  if (outcome === "ok") return null;
  if (outcome === "stopped") return "stopped by the caller";
  if (outcome === "timed out") return WHY_TIMED_OUT[String(end?.ended)] ?? null;
  // Short categories to count by, not the list's advice.
  if (outcome === "cut off") return end?.finish_reason === "length" ? "hit the token limit" : "the endpoint stopped it";
  // A failure's text carries ids and timings, so the same cause would count apart: take its
  // first sentence, write any word with a digit as N, and cut to eight words.
  const err = end?.error;
  if (typeof err === "string" && err.trim() !== "") {
    const sentence = err.split(/\r?\n/)[0].split(/:\s|\.\s/)[0];
    const words = sentence.split(/\s+/).filter((w) => w !== "").map((w) => (/\d/.test(w) ? "N" : w));
    if (words.length > 0) return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
  }
  return "failed";
}

// The question events a stream holds, as the counts summariseRun records: how many times it
// called ask_caller, and how many questions those events held (their questions arrays' strings).
function countQuestions(lines: string[]): { asks: number; questions: number } {
  let asks = 0;
  let questions = 0;
  for (const line of lines) {
    if (!line.includes("question")) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    if (e.t !== "question") continue;
    asks += 1;
    if (Array.isArray(e.questions)) {
      for (const q of e.questions) {
        if (typeof q === "string") questions += 1;
      }
    }
  }
  return { asks, questions };
}

// The message events a stream holds, as summariseRun records them: how many the caller sent,
// how many never reached the run, and the queued_seconds of the ones that did.
function countMessages(lines: string[]): { messages: number; undelivered: number; messageWaits: number[] } {
  let messages = 0;
  let undelivered = 0;
  const messageWaits: number[] = [];
  for (const line of lines) {
    if (!line.includes("message")) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    if (e.t !== "message") continue;
    messages += 1;
    if (e.delivered === false) {
      undelivered += 1;
    } else if (typeof e.queued_seconds === "number") {
      messageWaits.push(e.queued_seconds);
    }
  }
  return { messages, undelivered, messageWaits };
}

// A prompt under this many tokens costs nothing to rebuild, so it does not count.
const REBUILD_MIN_PROMPT = 4096;
// Under half of the previous prompt cached means the saved prefix was gone; a turn that trimmed
// tool results shortened the cached prefix on purpose, so it is left out.
const REBUILD_CACHE_SHARE = 1 / 2;

// The turns a stream holds that rebuilt their prompt, as summariseRun records them: a turn after
// the first whose cached tokens are under half the previous turn's prompt of at least
// REBUILD_MIN_PROMPT tokens, unless it trimmed tool results. Null when no turn reported cached
// tokens, since then nothing says whether a prompt was rebuilt. Also which turns those were, by
// their order among the stream's turn events.
function countRebuilt(lines: string[]): { rebuiltTurns: number | null; turns: Set<number> } {
  let prev: number | null = null;
  let index = 0;
  let reported = false;
  const turns = new Set<number>();
  for (const line of lines) {
    if (!line.includes("turn")) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    if (e.t !== "turn") continue;
    const cached = e.cached_tokens;
    if (typeof cached === "number") {
      reported = true;
      const evicted = e.tool_results_evicted;
      const trimmed = evicted === true || (typeof evicted === "number" && evicted > 0);
      if (prev !== null && prev >= REBUILD_MIN_PROMPT && cached < prev * REBUILD_CACHE_SHARE && !trimmed) turns.add(index);
    }
    if (typeof e.input_tokens === "number") prev = e.input_tokens;
    index += 1;
  }
  return { rebuiltTurns: reported ? turns.size : null, turns };
}

interface TurnFigures {
  at: number | null;
  input: number | null;
  cached: number | null;
  output: number | null;
}

// The stream's turn events in order, with the token figures each reported.
function turnFigures(lines: string[]): TurnFigures[] {
  const out: TurnFigures[] = [];
  for (const line of lines) {
    if (!line.includes("turn")) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    if (e.t !== "turn") continue;
    out.push({
      at: parseAt(e.at),
      input: typeof e.input_tokens === "number" ? e.input_tokens : null,
      cached: typeof e.cached_tokens === "number" ? e.cached_tokens : null,
      output: typeof e.output_tokens === "number" ? e.output_tokens : null,
    });
  }
  return out;
}

const FIGURES = ["input", "cached", "output"] as const;
type Figure = (typeof FIGURES)[number];
const END_KEY: Record<Figure, string> = { input: "input_tokens", cached: "cached_tokens", output: "output_tokens" };

interface SlotTotals { input: number | null; cached: number | null; output: number | null; rebuilt: number }

// The slots a stream's turns fall into, by each turn's own time (its `at`, then the end's, then
// the start's), and what the end reported beyond the turns' sum in the slot of the end's time.
function buildSlots(
  lines: string[],
  end: Record<string, unknown>,
  startAt: number | null,
  rebuilt: Set<number>,
  rebuiltTurns: number | null,
): { slots: Slot[]; inputTokens: number | null; cachedTokens: number | null; outputTokens: number | null } {
  const endAt = parseAt(end.at);
  const turns = turnFigures(lines);
  const turnMs = turns.map((t) => t.at ?? endAt ?? startAt);
  const bySlot = new Map<number, SlotTotals>();
  const slotOf = (ms: number): SlotTotals => {
    const start = Math.floor(ms / SLOT_MS) * SLOT_MS;
    let acc = bySlot.get(start);
    if (acc === undefined) {
      acc = { input: null, cached: null, output: null, rebuilt: 0 };
      bySlot.set(start, acc);
    }
    return acc;
  };
  const add = (acc: SlotTotals, figure: Figure, v: number | null): void => {
    if (v === null) return;
    acc[figure] = (acc[figure] ?? 0) + v;
  };
  const sums: Record<Figure, number | null> = { input: null, cached: null, output: null };
  turns.forEach((t, i) => {
    const ms = turnMs[i] ?? null;
    if (ms !== null) {
      const acc = slotOf(ms);
      add(acc, "input", t.input);
      add(acc, "cached", t.cached);
      add(acc, "output", t.output);
      if (rebuiltTurns !== null && rebuilt.has(i)) acc.rebuilt += 1;
    }
    for (const figure of FIGURES) {
      const v = t[figure];
      if (v !== null) sums[figure] = (sums[figure] ?? 0) + v;
    }
  });
  // The end's figure is what the whole run used; the part of it no turn reported goes in the slot
  // of the end's time.
  const lastTurnMs = turnMs.length > 0 ? (turnMs[turnMs.length - 1] ?? null) : null;
  const endSlotMs = endAt ?? lastTurnMs ?? startAt;
  const totals: Record<Figure, number | null> = { input: null, cached: null, output: null };
  for (const figure of FIGURES) {
    const reported = end[END_KEY[figure]];
    const endFigure = typeof reported === "number" ? reported : null;
    const sum = sums[figure];
    if (endFigure !== null && (sum === null || endFigure > sum)) {
      const remainder = endFigure - (sum ?? 0);
      if (endSlotMs !== null) add(slotOf(endSlotMs), figure, remainder);
      totals[figure] = (sum ?? 0) + remainder;
    } else {
      totals[figure] = sum;
    }
  }
  const slots: Slot[] = [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, acc]): Slot => [start, acc.input, acc.cached, acc.output, rebuiltTurns === null ? null : acc.rebuilt]);
  return { slots, inputTokens: totals.input, cachedTokens: totals.cached, outputTokens: totals.output };
}

export function summariseRun(name: string, size: number, lines: string[], now: Date): RunRecord | null {
  const s = newStreamState();
  for (const line of lines) applyLine(s, line);
  if (s.end === null) return null;
  const end = s.end;
  const outcome = stateOf(s, now.getTime(), 0) as Outcome;
  const { asks, questions } = countQuestions(lines);
  const { messages, undelivered, messageWaits } = countMessages(lines);
  const { rebuiltTurns, turns: rebuilt } = countRebuilt(lines);
  const startedAt = parseAt(s.start?.at);
  const { slots, inputTokens, cachedTokens, outputTokens } = buildSlots(lines, end, startedAt, rebuilt, rebuiltTurns);
  return {
    name,
    size,
    startedAt,
    outcome,
    reason: reasonOf(outcome, end),
    repo: typeof s.start?.workspace === "string" ? s.start.workspace : null,
    repoFromPaths: false,
    model: typeof s.start?.model_key === "string" ? s.start.model_key : null,
    mcpTask: typeof s.start?.mcp_task === "boolean" ? s.start.mcp_task : null,
    elapsedSeconds: typeof end.elapsed_seconds === "number" ? end.elapsed_seconds : null,
    inputTokens,
    outputTokens,
    cachedTokens,
    rebuiltTurns,
    slots,
    asks,
    questions,
    messages,
    undelivered,
    messageWaits,
  };
}

function sortRecords(records: RunRecord[]): RunRecord[] {
  return records.slice().sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1));
}

const OUTCOMES: readonly string[] = ["ok", "failed", "stopped", "timed out", "cut off"];
const numberOrNull = (v: unknown) => v === null || typeof v === "number";
const stringOrNull = (v: unknown) => v === null || typeof v === "string";
const numbersOrNull = (v: unknown): v is number[] | null => v === null || (Array.isArray(v) && v.every((x) => typeof x === "number"));
const isSlot = (v: unknown): v is Slot => Array.isArray(v) && v.length === 5 && typeof v[0] === "number" && v.slice(1).every(numberOrNull);
const isSlots = (v: unknown): v is Slot[] => Array.isArray(v) && v.every(isSlot);

function isRecord(v: unknown): v is RunRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.name === "string" && typeof r.size === "number" && typeof r.outcome === "string" && OUTCOMES.includes(r.outcome)
    && numberOrNull(r.startedAt) && stringOrNull(r.reason) && stringOrNull(r.repo) && typeof r.repoFromPaths === "boolean" && stringOrNull(r.model)
    && numberOrNull(r.elapsedSeconds) && numberOrNull(r.inputTokens) && numberOrNull(r.outputTokens) && numberOrNull(r.cachedTokens)
    && numberOrNull(r.rebuiltTurns) && isSlots(r.slots) && numberOrNull(r.asks) && numberOrNull(r.questions) && (r.mcpTask === null || typeof r.mcpTask === "boolean")
    && numberOrNull(r.messages) && numberOrNull(r.undelivered) && numbersOrNull(r.messageWaits);
}

function sameRecord(a: RunRecord, b: RunRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Normalise a path a stream names; null when it is not absolute.
function normalisePath(p: string): string | null {
  let s = p.replace(/\\/g, "/");
  const wsl = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(s);
  if (wsl !== null) s = `${wsl[1].toUpperCase()}:/${wsl[2]}`;
  s = s.replace(/^([a-zA-Z]):/, (_, letter) => `${letter.toUpperCase()}:`);
  if (s.endsWith("/")) s = s.slice(0, -1);
  return /^[A-Z]:\/|^\//.test(s) ? s : null;
}

// Every absolute path a stream names: files_read/files_skipped, and tool call paths.
export function absolutePaths(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v !== "string") return;
    const p = normalisePath(v);
    if (p !== null && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const line of lines) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    if (e.t === "start") {
      for (const key of ["files_read", "files_skipped"]) {
        const arr = e[key];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (typeof item !== "object" || item === null) continue;
          const it = item as Record<string, unknown>;
          add(it.path);
          add(it.given);
        }
      }
    } else if (e.t === "turn" || e.t === "tools") {
      const calls = e.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        if (typeof call !== "object" || call === null) continue;
        const args = (call as Record<string, unknown>).arguments;
        if (typeof args !== "object" || args === null) continue;
        add((args as Record<string, unknown>).path);
      }
    }
  }
  return out;
}

// The joined segments before each segment equal to a named repo, distinct.
export function learnParents(named: { repo: string; paths: string[] }[]): string[] {
  const parents = new Set<string>();
  for (const { repo, paths } of named) {
    for (const p of paths) {
      const segments = p.split("/");
      for (let i = 0; i < segments.length; i++) {
        if (segments[i] === repo) parents.add(segments.slice(0, i).join("/"));
      }
    }
  }
  return [...parents];
}

// The folder after the longest parent each path starts with; one name or null.
export function repoFromPaths(paths: string[], parents: string[]): string | null {
  const names = new Set<string>();
  for (const p of paths) {
    let best: string | null = null;
    for (const parent of parents) {
      const prefix = parent + "/";
      if (p.startsWith(prefix) && (best === null || parent.length > best.length)) best = parent;
    }
    if (best !== null) {
      const next = p.slice(best.length + 1).split("/")[0];
      if (next !== "") names.add(next);
    }
  }
  return names.size === 1 ? [...names][0] : null;
}

export class RunStore {
  private file: string | null;
  private dir: string | null;
  private now: () => Date;
  private kept: RunRecord[] = [];
  private parents: string[] = [];
  private state: RunsStatus = { records: 0, checkedAt: null, checked: 0, disagreed: 0, missing: 0, writeError: null };

  constructor(file: string | null, dir: string | null, now: () => Date) {
    this.file = file;
    this.dir = dir;
    this.now = now;
  }

  load(): void {
    this.kept = [];
    this.state = { records: 0, checkedAt: null, checked: 0, disagreed: 0, missing: 0, writeError: null };
    if (this.file === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== VERSION || !Array.isArray(obj.runs)) return;
    // A record of the wrong shape is dropped: the page reads these fields without checking.
    // A record saved before asks/questions existed is kept, with those two read as null; the
    // same holds for mcpTask, for the message counts on a record saved before they existed, and
    // for rebuiltTurns.
    const runs = (obj.runs as unknown[]).map((r) => {
      if (typeof r !== "object" || r === null) return r;
      const rec = r as Record<string, unknown>;
      return {
        ...rec,
        rebuiltTurns: rec.rebuiltTurns === undefined ? null : rec.rebuiltTurns,
        asks: rec.asks === undefined ? null : rec.asks,
        questions: rec.questions === undefined ? null : rec.questions,
        mcpTask: rec.mcpTask === undefined ? null : rec.mcpTask,
        messages: rec.messages === undefined ? null : rec.messages,
        undelivered: rec.undelivered === undefined ? null : rec.undelivered,
        messageWaits: rec.messageWaits === undefined ? null : rec.messageWaits,
      };
    });
    this.kept = sortRecords(runs.filter(isRecord));
    this.state.records = this.kept.length;
  }

  checkAll(): void {
    this.state.checked = 0;
    this.state.disagreed = 0;
    this.state.missing = 0;
    const existing = new Map(this.kept.map((r) => [r.name, r]));
    const present = new Set<string>();
    const summaries = new Map<string, { record: RunRecord; paths: string[] }>();
    for (const name of this.listJsonl()) {
      present.add(name);
      const s = this.summariseFile(name);
      if (s !== null) summaries.set(name, s);
    }
    // Learn the parents from the runs that name a repo, then infer a repo for the rest.
    const named: { repo: string; paths: string[] }[] = [];
    for (const { record, paths } of summaries.values()) {
      if (record.repo !== null) named.push({ repo: record.repo, paths });
    }
    this.parents = learnParents(named);
    const next: RunRecord[] = [];
    for (const name of present) {
      const s = summaries.get(name);
      const prev = existing.get(name);
      if (prev !== undefined) this.state.checked += 1;
      let rec: RunRecord | null = null;
      if (s !== undefined) {
        rec = s.record;
        if (rec.repo === null) {
          const repo = repoFromPaths(s.paths, this.parents);
          rec = { ...rec, repo, repoFromPaths: repo !== null };
        }
      }
      if (rec === null) {
        if (prev !== undefined) next.push(prev);
      } else if (prev === undefined) {
        next.push(rec);
      } else if (sameRecord(prev, rec)) {
        next.push(prev);
      } else {
        this.state.disagreed += 1;
        next.push(rec);
      }
    }
    // With no folder to compare against there is nothing to call missing.
    if (this.dir !== null) {
      for (const [name, rec] of existing) {
        if (!present.has(name)) {
          this.state.missing += 1;
          next.push(rec);
        }
      }
    } else {
      for (const rec of existing.values()) next.push(rec);
    }
    this.kept = sortRecords(next);
    this.state.records = this.kept.length;
    this.state.checkedAt = this.now().getTime();
    this.save();
  }

  scan(): void {
    if (this.dir === null) return;
    let changed = false;
    const next = this.kept.slice();
    const indexOf = new Map(next.map((r, i) => [r.name, i]));
    for (const name of this.listJsonl()) {
      let size: number;
      try {
        size = fs.statSync(path.join(this.dir, name)).size;
      } catch {
        continue;
      }
      const idx = indexOf.get(name);
      if (idx !== undefined && next[idx].size === size) continue;
      const s = this.summariseFile(name);
      if (s === null) continue;
      let rec = s.record;
      if (rec.repo === null) {
        const repo = repoFromPaths(s.paths, this.parents);
        rec = { ...rec, repo, repoFromPaths: repo !== null };
      }
      if (idx === undefined) {
        indexOf.set(name, next.length);
        next.push(rec);
        changed = true;
      } else if (!sameRecord(next[idx], rec)) {
        next[idx] = rec;
        changed = true;
      }
    }
    if (!changed) return;
    this.kept = sortRecords(next);
    this.state.records = this.kept.length;
    this.save();
  }

  records(): RunRecord[] {
    return sortRecords(this.kept);
  }

  status(): RunsStatus {
    return { ...this.state };
  }

  private listJsonl(): string[] {
    if (this.dir === null) return [];
    try {
      return [...listNewest(this.dir, 0).all];
    } catch {
      return [];
    }
  }

  private summariseFile(name: string): { record: RunRecord; paths: string[] } | null {
    if (this.dir === null) return null;
    const full = path.join(this.dir, name);
    let content: string;
    let size: number;
    try {
      const buf = fs.readFileSync(full);
      size = buf.length;
      content = buf.toString("utf8");
    } catch {
      return null;
    }
    const lines = content
      .split("\n")
      .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
      .filter((line) => line !== "");
    const record = summariseRun(name, size, lines, this.now());
    if (record === null) return null;
    return { record, paths: absolutePaths(lines) };
  }

  private save(): void {
    this.state.writeError = null;
    if (this.file === null) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ version: VERSION, runs: this.kept }));
      fs.renameSync(this.file + ".tmp", this.file);
    } catch (e) {
      this.state.writeError = e instanceof Error ? e.message : String(e);
    }
  }
}
