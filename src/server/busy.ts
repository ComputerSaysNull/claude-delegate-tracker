// The model server's busy time and KV-cache use, kept per UTC hour on disk for the History tab.
import fs from "node:fs";
import path from "node:path";
import type { ModelFigures } from "./metrics.ts";

export interface HourBucket {
  hour: number;          // ms, the start of the UTC hour
  seconds: number;       // seconds of this hour covered by readings
  busySeconds: number;   // of those, seconds in which at least one request was running
  kvSum: number;         // sum of kvCachePercent × seconds, for a time-weighted average
  kvSeconds: number;     // seconds that had a KV-cache figure
  kvMax: number | null;  // the highest KV-cache percent read in the hour
}

export const KEEP_DAYS = 90;

const VERSION = 1;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SAVE_INTERVAL_MS = 60_000;

const numberOrNull = (v: unknown): boolean => v === null || typeof v === "number";

function isBucket(v: unknown): v is HourBucket {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return typeof b.hour === "number" && typeof b.seconds === "number" && typeof b.busySeconds === "number"
    && typeof b.kvSum === "number" && typeof b.kvSeconds === "number" && numberOrNull(b.kvMax);
}

const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

// The previous ok reading, so the seconds to the next one can be credited to its UTC hour.
interface Prev {
  atMs: number;
  running: number;
  kv: number | null;
}

// One bucket per UTC hour for the last KEEP_DAYS days, so the History tab can chart busy
// time and KV-cache use. Buckets are dropped when older than KEEP_DAYS days, on push and on load.
export class BusyStore {
  private file: string | null;
  private now: () => number;
  private maxGapSeconds: number;
  private byHour = new Map<number, HourBucket>();
  private prev: Prev | null = null;
  private lastSaveAt: number | null = null;
  private lastSavedHour: number | null = null;
  private error: string | null = null;

  constructor(file: string | null, now: () => number, maxGapSeconds: number) {
    this.file = file;
    this.now = now;
    this.maxGapSeconds = maxGapSeconds;
  }

  load(): void {
    this.byHour = new Map();
    this.prev = null;
    this.lastSaveAt = null;
    this.lastSavedHour = null;
    this.error = null;
    if (this.file === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== VERSION || !Array.isArray(obj.buckets)) return;
    // A bucket of the wrong shape is dropped; one older than KEEP_DAYS days is too.
    const cutoff = this.now() - KEEP_DAYS * DAY_MS;
    for (const b of obj.buckets as unknown[]) {
      if (!isBucket(b)) continue;
      if (b.hour < cutoff) continue;
      this.byHour.set(b.hour, b);
    }
  }

  push(atMs: number, model: ModelFigures): void {
    // A gap: it clears the previous-reading marker and adds nothing.
    if (model.status !== "ok" || model.running === null) {
      this.prev = null;
      this.prune();
      return;
    }
    const changed = this.apply(atMs, model.running, model.kvCachePercent);
    this.prune();
    if (changed) this.maybeSave(atMs);
  }

  buckets(): HourBucket[] {
    const out: HourBucket[] = [];
    for (const b of this.byHour.values()) {
      if (b.seconds > 0) out.push(b);
    }
    return out.sort((a, b) => a.hour - b.hour);
  }

  writeError(): string | null {
    return this.error;
  }

  private apply(atMs: number, running: number, kv: number | null): boolean {
    // The reading's own KV figure belongs to its own UTC hour.
    const bucket = this.getBucket(hourOf(atMs));
    if (kv !== null) {
      if (bucket.kvMax === null || kv > bucket.kvMax) bucket.kvMax = kv;
    }
    // The first ok reading after start or a gap only sets the marker.
    if (this.prev === null) {
      this.prev = { atMs, running, kv };
      return false;
    }
    const seconds = Math.min(atMs - this.prev.atMs, this.maxGapSeconds * 1000) / 1000;
    const credited = this.getBucket(hourOf(this.prev.atMs));
    credited.seconds += seconds;
    if (this.prev.running > 0) credited.busySeconds += seconds;
    if (this.prev.kv !== null) {
      credited.kvSum += this.prev.kv * seconds;
      credited.kvSeconds += seconds;
    }
    this.prev = { atMs, running, kv };
    return seconds > 0;
  }

  private getBucket(hour: number): HourBucket {
    let b = this.byHour.get(hour);
    if (b === undefined) {
      b = { hour, seconds: 0, busySeconds: 0, kvSum: 0, kvSeconds: 0, kvMax: null };
      this.byHour.set(hour, b);
    }
    return b;
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_DAYS * DAY_MS;
    for (const hour of this.byHour.keys()) {
      if (hour < cutoff) this.byHour.delete(hour);
    }
  }

  private maybeSave(atMs: number): void {
    if (this.file === null) return;
    const nowMs = this.now();
    const hour = hourOf(atMs);
    if (this.lastSaveAt === null || nowMs - this.lastSaveAt >= SAVE_INTERVAL_MS || hour !== this.lastSavedHour) {
      this.save();
      this.lastSaveAt = nowMs;
      this.lastSavedHour = hour;
    }
  }

  private save(): void {
    this.error = null;
    if (this.file === null) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ version: VERSION, buckets: this.buckets() }));
      fs.renameSync(this.file + ".tmp", this.file);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}
