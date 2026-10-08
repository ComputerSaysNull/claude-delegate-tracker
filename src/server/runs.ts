// One record per finished run, kept on disk and checked against the streams.
import fs from "node:fs";
import path from "node:path";
import { listNewest } from "./folder.ts";
import { applyLine, newStreamState, parseAt, stateOf, WHY_TIMED_OUT } from "./streams.ts";

export type Outcome = "ok" | "failed" | "stopped" | "timed out" | "cut off";

export interface RunRecord {
  name: string;            // the stream's file name
  size: number;            // the file's size in bytes when summarised
  startedAt: number | null; // ms, from start.at (parseAt)
  outcome: Outcome;        // stateOf on the finished stream (streams.ts)
  reason: string | null;   // why it did not finish, as a short category, null for "ok"
  repo: string | null;     // start.workspace, or inferred from the paths a stream read
  repoFromPaths: boolean;  // true when repo came from the paths, false when the stream named it or it is null
  model: string | null;    // start.model_key
  elapsedSeconds: number | null; // end.elapsed_seconds
  inputTokens: number | null;    // end.input_tokens
  outputTokens: number | null;   // end.output_tokens
  cachedTokens: number | null;   // end.cached_tokens
}

export interface RunsStatus {
  records: number;           // how many records are kept
  checkedAt: number | null;  // ms of the last full check against the folder; null before the first
  checked: number;           // records whose stream was present and re-read in that check
  disagreed: number;         // of those, how many differed from the record and were rebuilt
  missing: number;           // records whose stream is no longer in the folder (kept)
  writeError: string | null; // the last error writing the file, null when the last write worked
}

const VERSION = 1;

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

export function summariseRun(name: string, size: number, lines: string[], now: Date): RunRecord | null {
  const s = newStreamState();
  for (const line of lines) applyLine(s, line);
  if (s.end === null) return null;
  const outcome = stateOf(s, now.getTime(), 0) as Outcome;
  return {
    name,
    size,
    startedAt: parseAt(s.start?.at),
    outcome,
    reason: reasonOf(outcome, s.end),
    repo: typeof s.start?.workspace === "string" ? s.start.workspace : null,
    repoFromPaths: false,
    model: typeof s.start?.model_key === "string" ? s.start.model_key : null,
    elapsedSeconds: typeof s.end.elapsed_seconds === "number" ? s.end.elapsed_seconds : null,
    inputTokens: typeof s.end.input_tokens === "number" ? s.end.input_tokens : null,
    outputTokens: typeof s.end.output_tokens === "number" ? s.end.output_tokens : null,
    cachedTokens: typeof s.end.cached_tokens === "number" ? s.end.cached_tokens : null,
  };
}

function sortRecords(records: RunRecord[]): RunRecord[] {
  return records.slice().sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1));
}

const OUTCOMES: readonly string[] = ["ok", "failed", "stopped", "timed out", "cut off"];
const numberOrNull = (v: unknown) => v === null || typeof v === "number";
const stringOrNull = (v: unknown) => v === null || typeof v === "string";

function isRecord(v: unknown): v is RunRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.name === "string" && typeof r.size === "number" && typeof r.outcome === "string" && OUTCOMES.includes(r.outcome)
    && numberOrNull(r.startedAt) && stringOrNull(r.reason) && stringOrNull(r.repo) && typeof r.repoFromPaths === "boolean" && stringOrNull(r.model)
    && numberOrNull(r.elapsedSeconds) && numberOrNull(r.inputTokens) && numberOrNull(r.outputTokens) && numberOrNull(r.cachedTokens);
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
    this.kept = sortRecords((obj.runs as unknown[]).filter(isRecord));
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
