// Polls the transcript folder: keeps one StreamReader per listed stream and
// turns the folder listing into the rows the UI shows.
import { join } from "node:path";
import { listNewest, StreamReader } from "./folder.ts";
import type { Listing } from "./folder.ts";
import { newStreamState, applyLine, listRow } from "./streams.ts";
import type { StreamState, ListRow } from "./streams.ts";

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

interface Entry {
  reader: StreamReader;
  state: StreamState;
  done: boolean;
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
  private current: ListResponse = emptyList();
  private timer: ReturnType<typeof setTimeout> | null = null;
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

    const listed = new Set(listing.names);
    for (const name of listing.names) {
      if (!this.entries.has(name)) {
        this.entries.set(name, {
          reader: new StreamReader(join(dir, name)),
          state: newStreamState(),
          done: false,
        });
      }
    }
    for (const name of this.entries.keys()) {
      if (!listed.has(name)) this.entries.delete(name);
    }

    for (const [name, entry] of this.entries) {
      if (entry.done) continue;
      try {
        const result = entry.reader.read();
        if (result.reset) entry.state = newStreamState();
        for (const line of result.lines) applyLine(entry.state, line);
        if (entry.state.end !== null) entry.done = true;
      } catch {
        // The file is gone; drop the entry entirely.
        this.entries.delete(name);
      }
    }

    const at = now();
    const built: { row: ListRow; badLines: number }[] = [];
    for (const [name, entry] of this.entries) {
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
  }

  list(): ListResponse {
    return this.current;
  }

  onChange(listener: (list: ListResponse) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(intervalSeconds: number): void {
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
    tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private update(next: ListResponse): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of this.listeners) listener(this.current);
  }
}
