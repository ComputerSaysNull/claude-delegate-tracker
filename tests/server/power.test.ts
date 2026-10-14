// One test per rule in handoff/spec92.md, for the power store kept on disk.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PowerStore } from "../../src/server/power.ts";
import type { PowerBucket } from "../../src/server/power.ts";
import { KEEP_DAYS } from "../../src/server/busy.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
// A UTC hour boundary, so hour-of is easy to reason about.
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

const hourOf = (ms: number): number => Math.floor(ms / HOUR) * HOUR;

// A well-formed ok node reading, as nodes.ts builds one.
function figures(over: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name: "n1",
    status: "ok",
    cpuPercent: null,
    cpuWindowSeconds: null,
    cpuTempC: null,
    gpuPercent: null,
    gpuTempC: null,
    memUsedPercent: null,
    memAvailableBytes: null,
    gpuPowerW: null,
    diskUsedPercent: null,
    diskReadBps: null,
    diskWriteBps: null,
    netRxBps: null,
    netTxBps: null,
    linkPortsUp: null,
    linkPortsSeenUp: null,
    linkDown: null,
    linkGbps: null,
    linkRxBps: null,
    linkTxBps: null,
    linkDropsRising: null,
    readAt: null,
    ...over,
  };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "power-"));
}

function goodBucket(hour: number, node = "n1"): PowerBucket {
  return { hour, node, wh: 1, seconds: 10, maxW: 20 };
}

// wh is a float built from integer seconds and watts, so compare it loosely.
function expectPowerBucket(
  b: PowerBucket,
  hour: number,
  node: string,
  wh: number,
  seconds: number,
  maxW: number | null,
): void {
  expect(b.hour).toBe(hour);
  expect(b.node).toBe(node);
  expect(b.wh).toBeCloseTo(wh, 9);
  expect(b.seconds).toBe(seconds);
  expect(b.maxW).toBe(maxW);
}

function expectBucketsEqual(actual: PowerBucket[], expected: PowerBucket[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    expectPowerBucket(actual[i], e.hour, e.node, e.wh, e.seconds, e.maxW);
  }
}

describe("PowerStore", () => {
  it("a single reading creates a bucket for its hour with maxW set", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    expect(store.buckets()).toEqual([{ hour: T0, node: "n1", wh: 0, seconds: 0, maxW: 36 }]);
  });

  it("credits watts × seconds ÷ 3600 to the previous reading's hour", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    // 5 s pushes for an hour: 720 intervals of 5 s = 3600 s, all at 36 W → 36 Wh.
    for (let k = 0; k <= 720; k++) store.push(T0 + k * 5000, [figures({ gpuPowerW: 36 })]);
    const t0 = store.buckets().filter((b) => b.hour === T0);
    expect(t0).toHaveLength(1);
    expectPowerBucket(t0[0], T0, "n1", 36, 3600, 36);
  });

  it("splits a gap crossing a UTC hour boundary between the two hours by time", () => {
    const store = new PowerStore(null, () => T0, 100);
    store.push(T0 - 1000, [figures({ gpuPowerW: 36 })]); // last second of the previous hour
    store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]); // two seconds into the next hour
    const buckets = store.buckets();
    expect(buckets).toHaveLength(2);
    expectPowerBucket(buckets[0], T0 - HOUR, "n1", (36 * 1) / 3600, 1, 36);
    expectPowerBucket(buckets[1], T0, "n1", (36 * 2) / 3600, 2, 36);
  });

  it("caps a gap at maxGapSeconds so long downtime is never counted", () => {
    const store = new PowerStore(null, () => T0, 30);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 1000 + 100_000, [figures({ gpuPowerW: 36 })]); // a 100 s gap
    expect(store.buckets()).toHaveLength(1);
    expectPowerBucket(store.buckets()[0], T0, "n1", (36 * 30) / 3600, 30, 36);
  });

  it("a reading that is not ok is a gap that adds nothing", () => {
    const store = new PowerStore(null, () => T0, 60);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 11_000, [figures({ status: "unreachable" })]);
    store.push(T0 + 21_000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 31_000, [figures({ gpuPowerW: 36 })]);
    expect(store.buckets()).toHaveLength(1);
    expectPowerBucket(store.buckets()[0], T0, "n1", (36 * 10) / 3600, 10, 36);
  });

  it("a reading with status ok but gpuPowerW null is a gap that adds nothing", () => {
    const store = new PowerStore(null, () => T0, 60);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 11_000, [figures({ gpuPowerW: null })]);
    store.push(T0 + 21_000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 31_000, [figures({ gpuPowerW: 36 })]);
    expect(store.buckets()).toHaveLength(1);
    expectPowerBucket(store.buckets()[0], T0, "n1", (36 * 10) / 3600, 10, 36);
  });

  it("keeps two nodes apart, one bucket per hour per node", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    store.push(T0 + 1000, [
      figures({ name: "n1", gpuPowerW: 36 }),
      figures({ name: "n2", gpuPowerW: 20 }),
    ]);
    store.push(T0 + 5000, [
      figures({ name: "n1", gpuPowerW: 36 }),
      figures({ name: "n2", gpuPowerW: 20 }),
    ]);
    const buckets = store.buckets();
    expect(buckets).toHaveLength(2);
    expectPowerBucket(buckets[0], T0, "n1", (36 * 4) / 3600, 4, 36);
    expectPowerBucket(buckets[1], T0, "n2", (20 * 4) / 3600, 4, 20);
  });

  it("a node missing from a push keeps its previous reading", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    store.push(T0 + 1000, [
      figures({ name: "n1", gpuPowerW: 36 }),
      figures({ name: "n2", gpuPowerW: 20 }),
    ]);
    store.push(T0 + 5000, [figures({ name: "n1", gpuPowerW: 36 })]); // n2 is absent
    store.push(T0 + 9000, [figures({ name: "n2", gpuPowerW: 20 })]); // n2 returns
    const buckets = store.buckets();
    expect(buckets).toHaveLength(2);
    expectPowerBucket(buckets[0], T0, "n1", (36 * 4) / 3600, 4, 36);
    expectPowerBucket(buckets[1], T0, "n2", (20 * 8) / 3600, 8, 20);
  });

  it("drops buckets older than KEEP_DAYS on push", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    const oldHour = hourOf(T0 - (KEEP_DAYS + 1) * DAY);
    store.push(oldHour + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(oldHour + 2000, [figures({ gpuPowerW: 36 })]);
    expect(store.buckets()).toEqual([]);
  });

  it("drops buckets older than KEEP_DAYS on load", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");
    const oldHour = hourOf(T0 - (KEEP_DAYS + 1) * DAY);
    writeFileSync(file, JSON.stringify({ version: 1, buckets: [goodBucket(oldHour), goodBucket(T0)] }));
    const store = new PowerStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([goodBucket(T0)]);
  });

  it("saves the buckets so a second store loading the file sees the same", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");
    let nowMs = T0;
    const store = new PowerStore(file, () => nowMs, 100_000);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 3000, [figures({ gpuPowerW: 36 })]);
    nowMs = T0 + 61_000;
    store.push(T0 + 4000, [figures({ gpuPowerW: 36 })]);
    expect(store.writeError()).toBeNull();
    const expected = store.buckets();
    expect(expected).toHaveLength(1);
    expectPowerBucket(expected[0], T0, "n1", (36 * 3) / 3600, 3, 36);
    // Only power.json is written; the temp file is renamed away.
    expect(readdirSync(dir)).toEqual(["power.json"]);
    const store2 = new PowerStore(file, () => nowMs, 100_000);
    store2.load();
    expectBucketsEqual(store2.buckets(), expected);
  });

  it("drops a bucket of the wrong shape on load and keeps the good ones", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");
    const good = goodBucket(T0);
    const bad = [
      { ...good, hour: "x" },
      { ...good, node: 5 },
      { ...good, wh: "many" },
      { ...good, seconds: null },
      { ...good, maxW: "many" },
      null,
      "x",
      {},
    ];
    writeFileSync(file, JSON.stringify({ version: 1, buckets: [good, ...bad] }));
    const store = new PowerStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([good]);
  });

  it("ignores a corrupt or other-version power file", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");

    writeFileSync(file, "not json");
    let store = new PowerStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([]);
    expect(store.writeError()).toBeNull();

    writeFileSync(file, JSON.stringify({ version: 2, buckets: [goodBucket(T0)] }));
    store = new PowerStore(file, () => T0, 60);
    store.load();
    expect(store.buckets()).toEqual([]);
  });

  it("file null keeps buckets in memory", () => {
    const store = new PowerStore(null, () => T0, 100_000);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]);
    expect(store.buckets()).toHaveLength(1);
    expect(store.writeError()).toBeNull();
  });

  it("saves at most once per 60 s, so same-hour pushes do not rewrite the file", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");
    let nowMs = T0;
    const store = new PowerStore(file, () => nowMs, 60);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]);
    const first = JSON.parse(readFileSync(file, "utf8")) as { buckets: PowerBucket[] };
    expect(first.buckets).toHaveLength(1);
    expect(first.buckets[0].seconds).toBe(1);
    expect(first.buckets[0].maxW).toBe(36);

    store.push(T0 + 3000, [figures({ gpuPowerW: 36 })]); // same hour, < 60 s: no save
    const second = JSON.parse(readFileSync(file, "utf8")) as { buckets: PowerBucket[] };
    expect(second.buckets).toEqual(first.buckets);

    nowMs = T0 + 61_000; // now more than 60 s since the last save
    store.push(T0 + 4000, [figures({ gpuPowerW: 36 })]);
    const third = JSON.parse(readFileSync(file, "utf8")) as { buckets: PowerBucket[] };
    expect(third.buckets[0].seconds).toBe(3);
  });

  it("saves as soon as a push starts a new hour, even before 60 s", () => {
    const dir = makeDir();
    const file = join(dir, "power.json");
    // The clock never advances, so only a new hour can explain the write at the third push.
    const store = new PowerStore(file, () => T0, 100_000);
    store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]);
    store.push(T0 + HOUR + 1000, [figures({ gpuPowerW: 36 })]); // crosses into T0 + HOUR
    const saved = JSON.parse(readFileSync(file, "utf8")) as { buckets: PowerBucket[] };
    expect(saved.buckets.find((b) => b.hour === T0)?.seconds).toBeGreaterThan(1);
  });

  it("an unwritable dataDir sets writeError and does not throw", () => {
    const dir = makeDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x"); // an existing FILE, so mkdir of its child fails
    const store = new PowerStore(join(blocker, "power.json"), () => T0, 60);
    expect(() => {
      store.push(T0 + 1000, [figures({ gpuPowerW: 36 })]);
      store.push(T0 + 2000, [figures({ gpuPowerW: 36 })]); // triggers a save
    }).not.toThrow();
    expect(store.writeError()).not.toBeNull();
  });
});
