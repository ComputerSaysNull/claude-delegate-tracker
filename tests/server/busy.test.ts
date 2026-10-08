// One test per rule in handoff/spec-56-fixes.md, for the KV-only busy store kept on disk.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BusyStore, KEEP_DAYS } from "../../src/server/busy.ts";
import type { HourBucket } from "../../src/server/busy.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
// A UTC hour boundary, so hour-of is easy to reason about.
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

const hourOf = (ms: number): number => Math.floor(ms / HOUR) * HOUR;

// A well-formed ok reading, as metrics.ts builds one.
function figures(over: Partial<ModelFigures> = {}): ModelFigures {
  return {
    status: "ok", running: 1, waiting: 0, kvCachePercent: null,
    decodeTokensPerSecond: null, decodeWindowSeconds: null, prefixHitPercent: null,
    preemptions: null, readAt: null,
    ...over,
  };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "busy-"));
}

function goodBucket(hour: number): HourBucket {
  return { hour, kvSum: 100, kvSeconds: 10, kvMax: 20 };
}

describe("BusyStore", () => {
  it("the first ok reading after start only sets the marker", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    expect(store.buckets()).toEqual([]);
  });

  it("credits the seconds since the previous reading to its UTC hour", () => {
    const store = new BusyStore(null, () => T0, 60);
    const a = T0 + HOUR - 1000; // last second of the hour
    const b = T0 + HOUR + 1000; // first second of the next hour
    store.push(a, figures({ kvCachePercent: 50 }));
    store.push(b, figures({ kvCachePercent: 50 }));
    expect(store.buckets()).toEqual([
      { hour: T0, kvSum: 100, kvSeconds: 2, kvMax: 50 },
    ]);
  });

  it("a reading that is not ok is a gap that adds nothing", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 2000, figures({ status: "unreachable", running: null }));
    expect(store.buckets()).toEqual([]);
  });

  it("an unanswered reading is a gap even when it carries a KV figure", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 11_000, figures({ status: "unreachable", kvCachePercent: 50 }));
    store.push(T0 + 21_000, figures({ kvCachePercent: 50 }));
    expect(store.buckets()).toEqual([]);
  });

  it("a reading with status ok but kv null is a gap that adds nothing", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 2000, figures({ kvCachePercent: null }));
    expect(store.buckets()).toEqual([]);
  });

  it("counts nothing across a gap: the next ok reading only starts again", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 11_000, figures({ status: "unreachable", running: null }));
    store.push(T0 + 21_000, figures({ kvCachePercent: 50 }));
    expect(store.buckets()).toEqual([]);
    store.push(T0 + 31_000, figures({ kvCachePercent: 50 }));
    expect(store.buckets().map((b) => [b.kvSum, b.kvSeconds, b.kvMax])).toEqual([[500, 10, 50]]);
  });

  it("caps the interval at maxGapSeconds so downtime is never counted", () => {
    const store = new BusyStore(null, () => T0, 30);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 1000 + 100_000, figures({ kvCachePercent: 50 })); // a 100 s gap
    expect(store.buckets()).toEqual([
      { hour: T0, kvSum: 1500, kvSeconds: 30, kvMax: 50 },
    ]);
  });

  it("accumulates kv time-weighted from the previous reading and takes the hour's kvMax", () => {
    const store = new BusyStore(null, () => T0, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 40 }));
    store.push(T0 + 2000, figures({ kvCachePercent: 30 }));
    store.push(T0 + 3000, figures({ kvCachePercent: 90 }));
    expect(store.buckets()).toEqual([
      { hour: T0, kvSum: 70, kvSeconds: 2, kvMax: 90 },
    ]);
  });

  it("returns buckets oldest first", () => {
    const store = new BusyStore(null, () => T0, 100_000);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 2000, figures({ kvCachePercent: 50 })); // hour T0
    store.push(T0 + HOUR + 1000, figures({ kvCachePercent: 50 })); // still credited to T0
    store.push(T0 + HOUR + 2000, figures({ kvCachePercent: 50 })); // hour T0 + HOUR
    expect(store.buckets().map((b) => b.hour)).toEqual([T0, T0 + HOUR]);
  });

  it("drops buckets older than KEEP_DAYS days on load", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    const oldHour = hourOf(T0 - (KEEP_DAYS + 1) * DAY);
    writeFileSync(file, JSON.stringify({ version: 2, buckets: [goodBucket(oldHour), goodBucket(T0)] }));
    const store = new BusyStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([goodBucket(T0)]);
  });

  it("drops buckets older than KEEP_DAYS days on push", () => {
    const store = new BusyStore(null, () => T0, 100_000);
    const oldHour = hourOf(T0 - (KEEP_DAYS + 1) * DAY);
    store.push(oldHour + 1000, figures({ kvCachePercent: 50 }));
    store.push(oldHour + 2000, figures({ kvCachePercent: 50 })); // creates an old bucket, dropped at once
    expect(store.buckets()).toEqual([]);
  });

  it("saves the buckets so a second store loading the file sees the same", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    let nowMs = T0;
    const store = new BusyStore(file, () => nowMs, 100_000);
    store.push(T0 + 1000, figures({ kvCachePercent: 40 }));
    store.push(T0 + 2000, figures({ kvCachePercent: 50 }));
    nowMs = T0 + 61_000;
    store.push(T0 + HOUR + 1000, figures({ kvCachePercent: 10 }));
    nowMs = T0 + 122_000;
    store.push(T0 + HOUR + 2000, figures({ kvCachePercent: 20 }));
    expect(store.writeError()).toBeNull();
    const expected = store.buckets();
    expect(expected).toHaveLength(2);
    // Only busy.json is written; the temp file is renamed away.
    expect(readdirSync(dir)).toEqual(["busy.json"]);
    const store2 = new BusyStore(file, () => nowMs, 100_000);
    store2.load();
    expect(store2.buckets()).toEqual(expected);
  });

  it("saves at most once per 60 s, so same-hour pushes do not rewrite the file", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    let nowMs = T0;
    const store = new BusyStore(file, () => nowMs, 60);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 2000, figures({ kvCachePercent: 50 }));
    const first = JSON.parse(readFileSync(file, "utf8")) as { buckets: HourBucket[] };
    expect(first.buckets).toEqual([{ hour: T0, kvSum: 50, kvSeconds: 1, kvMax: 50 }]);

    store.push(T0 + 3000, figures({ kvCachePercent: 50 })); // same hour, < 60 s: no save
    const second = JSON.parse(readFileSync(file, "utf8")) as { buckets: HourBucket[] };
    expect(second.buckets).toEqual(first.buckets);

    nowMs = T0 + 61_000; // now more than 60 s since the last save
    store.push(T0 + 4000, figures({ kvCachePercent: 50 }));
    const third = JSON.parse(readFileSync(file, "utf8")) as { buckets: HourBucket[] };
    expect(third.buckets).toEqual([{ hour: T0, kvSum: 150, kvSeconds: 3, kvMax: 50 }]);
  });

  it("saves as soon as a push starts a new hour, even before 60 s", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    // The clock never advances, so only a new hour can explain the write at the third push.
    const store = new BusyStore(file, () => T0, 100_000);
    store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
    store.push(T0 + 2000, figures({ kvCachePercent: 50 })); // hour T0, saved
    store.push(T0 + HOUR + 1000, figures({ kvCachePercent: 80 })); // crosses into T0 + HOUR
    const saved = JSON.parse(readFileSync(file, "utf8")) as { buckets: HourBucket[] };
    expect(saved.buckets.find((b) => b.hour === T0)?.kvSeconds).toBeGreaterThan(1);
  });

  it("ignores a corrupt or other-version busy file", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");

    writeFileSync(file, "not json");
    let store = new BusyStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([]);
    expect(store.writeError()).toBeNull();

    writeFileSync(file, JSON.stringify({ version: 3, buckets: [goodBucket(T0)] }));
    store = new BusyStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([]);
  });

  it("ignores a version-1 busy file", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    writeFileSync(file, JSON.stringify({ version: 1, buckets: [goodBucket(T0)] }));
    const store = new BusyStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([]);
  });

  it("drops a bucket of the wrong shape and keeps the good ones", () => {
    const dir = makeDir();
    const file = join(dir, "busy.json");
    const good = goodBucket(T0);
    const bad = [
      { ...good, hour: "x" },
      { ...good, kvSum: "many" },
      { ...good, kvSeconds: null },
      { ...good, kvMax: "many" },
      null,
      "x",
      {},
    ];
    writeFileSync(file, JSON.stringify({ version: 2, buckets: [good, ...bad] }));
    const store = new BusyStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([good]);
  });

  it("an unwritable dataDir sets writeError and does not throw", () => {
    const dir = makeDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x"); // an existing FILE, so mkdir of its child fails
    const store = new BusyStore(join(blocker, "busy.json"), () => T0, 60);
    expect(() => {
      store.push(T0 + 1000, figures({ kvCachePercent: 50 }));
      store.push(T0 + 2000, figures({ kvCachePercent: 50 })); // triggers a save
    }).not.toThrow();
    expect(store.writeError()).not.toBeNull();
  });
});
