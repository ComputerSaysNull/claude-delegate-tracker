// Polls the transcript folder: keeps one StreamReader per listed stream and
// turns the folder listing into the rows the UI shows. A followed stream is also
// read on its own, faster interval, and sends patches of its view.
import { join } from "node:path";
import { listNewest, StreamReader } from "./folder.ts";
import type { Listing } from "./folder.ts";
import { newStreamState, applyLine, listRow } from "./streams.ts";
import type { StreamState, ListRow } from "./streams.ts";
import { newViewState, applyViewEvent, buildView, diffView } from "./view.ts";
import type { ViewState, StreamView, ViewPatch } from "./view.ts";

export const PICK_BY_NAME = 25; // names listed before ordering by start.at
export const LIST_LIMIT = 20;

export interface ListResponse {
  rows: ListRow[];
  capped: boolean;
  total: number;
  unstamped: number;
  folderReadable: boolean;
  badLines: number;
}

export interface PollerDeps {
  dir: string | null;
  quietAfterSeconds: number;
  now: () => Date;
}

type PatchListener = (patch: ViewPatch) => void;

interface Entry {
  reader: StreamReader;
  state: StreamState;
  view: ViewState;
  done: boolean;
  sent: StreamView | null; // the view as last served or sent; its seq numbers what was sent
  followers: Set<PatchListener>;
}

function emptyList(): ListResponse {
  return { rows: [], capped: false, total: 0, unstamped: 0, folderReadable: false, badLines: 0 };
}

function compareRows(a: ListRow, b: ListRow): number {
  if (a.startedAt === null && b.startedAt === null) return b.name.localeCompare(a.name);
  if (a.startedAt === null) return 1;
  if (b.startedAt === null) return -1;
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return b.name.localeCompare(a.name);
}

export class Poller {
  private readonly deps: PollerDeps;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(list: ListResponse) => void>();
  private known = new Set<string>();
  private current: ListResponse = emptyList();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private followTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(deps: PollerDeps) {
    this.deps = deps;
  }

  pass(): void {
    const { dir, now, quietAfterSeconds } = this.deps;
    if (dir === null) {
      this.update(emptyList());
      return;
    }

    let listing: Listing;
    try {
      listing = listNewest(dir, PICK_BY_NAME);
    } catch {
      // Keep the last known state; the folder is simply not readable right now.
      this.update({ ...this.current, folderReadable: false });
      return;
    }
    this.known = listing.all;

    const listed = new Set(listing.names);
    for (const name of listing.names) {
      if (!this.entries.has(name)) this.entries.set(name, this.newEntry(dir, name));
    }
    for (const [name, entry] of this.entries) {
      // A followed stream stays while a page follows it, listed or not.
      if (!listed.has(name) && entry.followers.size === 0) this.entries.delete(name);
    }

    for (const name of [...this.entries.keys()]) this.readEntry(name);

    const at = now();
    const built: { row: ListRow; badLines: number }[] = [];
    for (const [name, entry] of this.entries) {
      if (!listed.has(name)) continue;
      built.push({ row: listRow(name, entry.state, at, quietAfterSeconds), badLines: entry.state.badLines });
    }
    built.sort((a, b) => compareRows(a.row, b.row));
    const kept = built.slice(0, LIST_LIMIT);

    this.update({
      rows: kept.map((b) => b.row),
      capped: listing.total > LIST_LIMIT,
      total: listing.total,
      unstamped: listing.unstamped,
      folderReadable: true,
      badLines: kept.reduce((sum, b) => sum + b.badLines, 0),
    });
    for (const name of this.entries.keys()) this.sendIfChanged(name);
  }

  // Read the followed streams only; runs on the shorter follow interval.
  followPass(): void {
    for (const [name, entry] of [...this.entries]) {
      if (entry.followers.size === 0) continue;
      this.readEntry(name);
      this.sendIfChanged(name);
    }
  }

  list(): ListResponse {
    return this.current;
  }

  onChange(listener: (list: ListResponse) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // One stream's whole view, or null for a name the folder listing did not hold.
  view(name: string): StreamView | null {
    const entry = this.entryFor(name);
    if (entry === null) return null;
    this.sendIfChanged(name, true);
    return entry.sent;
  }

  // Follow a stream's patches; null for a name the folder listing did not hold.
  follow(name: string, listener: PatchListener): (() => void) | null {
    const entry = this.entryFor(name);
    if (entry === null) return null;
    entry.followers.add(listener);
    return () => entry.followers.delete(listener);
  }

  start(intervalSeconds: number, followSeconds: number): void {
    this.stop();
    this.running = true;
    const tick = (): void => {
      try {
        this.pass();
      } catch (e) {
        console.error(e);
      }
      if (this.running) this.timer = setTimeout(tick, intervalSeconds * 1000);
    };
    const followTick = (): void => {
      try {
        this.followPass();
      } catch (e) {
        console.error(e);
      }
      if (this.running) this.followTimer = setTimeout(followTick, followSeconds * 1000);
    };
    tick();
    this.followTimer = setTimeout(followTick, followSeconds * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.followTimer !== null) {
      clearTimeout(this.followTimer);
      this.followTimer = null;
    }
  }

  private newEntry(dir: string, name: string): Entry {
    return {
      reader: new StreamReader(join(dir, name)),
      state: newStreamState(),
      view: newViewState(),
      done: false,
      sent: null,
      followers: new Set(),
    };
  }

  // The name is looked up in the listing; only a listed name is ever joined onto the folder.
  private entryFor(name: string): Entry | null {
    const { dir } = this.deps;
    if (dir === null || !this.known.has(name)) return null;
    let entry = this.entries.get(name);
    if (entry === undefined) {
      entry = this.newEntry(dir, name);
      this.entries.set(name, entry);
      if (!this.readEntry(name)) return null;
    }
    return entry;
  }

  // Returns false when the file is gone (the entry is then dropped).
  private readEntry(name: string): boolean {
    const entry = this.entries.get(name);
    if (entry === undefined) return false;
    if (entry.done) return true;
    try {
      const result = entry.reader.read();
      if (result.reset) {
        entry.state = newStreamState();
        entry.view = newViewState();
      }
      for (const line of result.lines) {
        const evt = applyLine(entry.state, line);
        if (evt !== null) applyViewEvent(entry.view, evt);
      }
      if (entry.state.end !== null) entry.done = true;
      return true;
    } catch {
      this.entries.delete(name);
      return false;
    }
  }

  // Rebuild a stream's view; when it changed, number it and send the patch to its followers.
  // Views are built only once someone asks: a page fetching it (asked) or following it.
  private sendIfChanged(name: string, asked = false): void {
    const entry = this.entries.get(name);
    if (entry === undefined) return;
    if (!asked && entry.sent === null && entry.followers.size === 0) return;
    const { now, quietAfterSeconds } = this.deps;
    const next = buildView(name, entry.view, entry.state, listRow(name, entry.state, now(), quietAfterSeconds));
    const prev = entry.sent;
    next.seq = prev === null ? 1 : prev.seq;
    if (prev !== null && JSON.stringify(next) === JSON.stringify(prev)) return;
    if (prev !== null) next.seq = prev.seq + 1;
    entry.sent = next;
    const patch = diffView(prev, next);
    for (const listener of entry.followers) listener(patch);
  }

  private update(next: ListResponse): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of this.listeners) listener(this.current);
  }
}
