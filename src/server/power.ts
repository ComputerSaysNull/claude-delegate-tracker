// The nodes' GPU power, kept per UTC hour per node on disk for the History tab, so the page can
// chart the energy each day. Like busy.ts, only the power figures are kept; the time between two
// readings is credited to the earlier one's watts, capped at a gap, and split across the hours it
// crosses.
import fs from "node:fs";
import path from "node:path";
import { KEEP_DAYS } from "./busy.ts";
import type { NodeFigures } from "./nodes.ts";

export interface PowerBucket {
  hour: number;          // ms, the start of the UTC hour
  node: string;          // the node's name
  wh: number;            // energy credited to this hour: Σ watts × seconds ÷ 3600
  seconds: number;       // seconds that had a power figure
  maxW: number | null;   // the highest watts read in the hour
}

const VERSION = 1;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SAVE_INTERVAL_MS = 60_000;

const numberOrNull = (v: unknown): boolean => v === null || typeof v === "number";

function isBucket(v: unknown): v is PowerBucket {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return typeof b.hour === "number"
    && typeof b.node === "string"
    && typeof b.wh === "number"
    && typeof b.seconds === "number"
    && numberOrNull(b.maxW);
}

const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

// The previous ok reading per node, so the seconds to the next one can be credited to its hours.
interface Prev {
  atMs: number;
  w: number;
}

// One bucket per UTC hour per node for the last KEEP_DAYS days, so the History tab can chart GPU
// energy. Buckets are dropped when older than KEEP_DAYS days, on push and on load.
export class PowerStore {
  private file: string | null;
  private now: () => number;
  private maxGapSeconds: number;
  private byHour = new Map<number, Map<string, PowerBucket>>();
  private prev = new Map<string, Prev>();
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
    this.prev = new Map();
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
      const bucket = this.getBucket(b.hour, b.node);
      bucket.wh = b.wh;
      bucket.seconds = b.seconds;
      bucket.maxW = b.maxW;
    }
  }

  push(atMs: number, nodes: NodeFigures[]): void {
    // A node missing from the push is left alone; its previous reading is kept.
    let changed = false;
    for (const node of nodes) {
      // A gap: it clears that node's previous-reading marker and adds nothing.
      if (node.status !== "ok" || node.gpuPowerW === null) {
        this.prev.delete(node.name);
        continue;
      }
      if (this.apply(atMs, node.name, node.gpuPowerW)) changed = true;
      this.prev.set(node.name, { atMs, w: node.gpuPowerW });
    }
    this.prune();
    if (changed) this.maybeSave(atMs);
  }

  buckets(): PowerBucket[] {
    const out: PowerBucket[] = [];
    for (const byNode of this.byHour.values()) {
      for (const b of byNode.values()) {
        if (b.seconds > 0 || b.maxW !== null) out.push(b);
      }
    }
    return out.sort((a, b) => a.hour - b.hour || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
  }

  writeError(): string | null {
    return this.error;
  }

  private apply(atMs: number, node: string, w: number): boolean {
    // The seconds since the previous reading count by the earlier one, capped at maxGapSeconds and
    // split across the UTC hour boundaries they cross.
    let changed = false;
    const prev = this.prev.get(node);
    if (prev !== undefined) {
      const seconds = Math.min((atMs - prev.atMs) / 1000, this.maxGapSeconds);
      if (seconds > 0) {
        const endMs = prev.atMs + seconds * 1000;
        let cur = prev.atMs;
        while (cur < endMs) {
          const hour = hourOf(cur);
          const segEnd = Math.min(endMs, hour + HOUR_MS);
          const segSeconds = (segEnd - cur) / 1000;
          const bucket = this.getBucket(hour, node);
          bucket.wh += (prev.w * segSeconds) / 3600;
          bucket.seconds += segSeconds;
          if (bucket.maxW === null || prev.w > bucket.maxW) bucket.maxW = prev.w;
          cur = segEnd;
        }
        changed = true;
      }
    }
    // The reading's own watts belong to its own UTC hour, which gets a bucket if it has none.
    const own = this.getBucket(hourOf(atMs), node);
    if (own.maxW === null || w > own.maxW) own.maxW = w;
    return changed;
  }

  private getBucket(hour: number, node: string): PowerBucket {
    let byNode = this.byHour.get(hour);
    if (byNode === undefined) {
      byNode = new Map();
      this.byHour.set(hour, byNode);
    }
    let b = byNode.get(node);
    if (b === undefined) {
      b = { hour, node, wh: 0, seconds: 0, maxW: null };
      byNode.set(node, b);
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
