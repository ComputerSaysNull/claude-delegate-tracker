// One test per rule in handoff/spec-33-backend.md, for the run records kept on disk.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore, summariseRun, type RunRecord } from "../../src/server/runs.ts";

const NOW = new Date("2026-10-01T13:00:00.000Z");
// A well-formed record, as the store writes it.
const GOOD = {
  name: "20261001T120000.000-a.jsonl", size: 100, startedAt: Date.parse("2026-10-01T12:00:00Z"), outcome: "ok", reason: null,
  repo: "web-shop", model: "flash", elapsedSeconds: 3, inputTokens: 10, outputTokens: 2, cachedTokens: 5,
};
const START_AT = "2026-10-01T12:00:00.000000+00:00";
const END_AT = "2026-10-01T12:01:00.000000+00:00";
const START_MS = Date.parse("2026-10-01T12:00:00.000Z");

const toLine = (v: unknown): string => JSON.stringify(v);
const lines = (events: unknown[]): string[] => events.map(toLine);

function startEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: "start", at: START_AT, format: "1.1", tool: "delegate", task: "Do the thing",
    model_key: "flash", workspace: "C:\\proj", ...over,
  };
}

function endEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: "end", at: END_AT, ok: true, turns: 1, max_turns: 4, elapsed_seconds: 60,
    input_tokens: 100, output_tokens: 50, cached_tokens: 20, finish_reason: "stop", ...over,
  };
}

function writeStream(dir: string, name: string, events: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, events.map(toLine).join("\n") + "\n");
  return path;
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "runs-"));
}

function okRecord(name: string, size: number): RunRecord {
  return {
    name, size, startedAt: START_MS, outcome: "ok", reason: null, repo: "C:\\proj",
    model: "flash", elapsedSeconds: 60, inputTokens: 100, outputTokens: 50, cachedTokens: 20,
  };
}

function recordOf(events: unknown[]): RunRecord {
  const record = summariseRun("x.jsonl", 10, lines(events), NOW);
  expect(record).not.toBeNull();
  return record!;
}

describe("summariseRun", () => {
  it("summarises an ok run with a null reason", () => {
    expect(summariseRun("a.jsonl", 1200, lines([startEvent(), endEvent({ ended: "finished" })]), NOW)).toEqual({
      name: "a.jsonl", size: 1200, startedAt: START_MS, outcome: "ok", reason: null, repo: "C:\\proj",
      model: "flash", elapsedSeconds: 60, inputTokens: 100, outputTokens: 50, cachedTokens: 20,
    });
  });

  it("a failed run's reason is the first line before its first colon", () => {
    const r = recordOf([startEvent(), endEvent({ ok: false, error: "backend unreachable: the endpoint refused the connection" })]);
    expect([r.outcome, r.reason]).toEqual(["failed", "backend unreachable"]);
    const multi = recordOf([startEvent(), endEvent({ ok: false, error: "backend unreachable: the endpoint refused\nsecond line" })]);
    expect(multi.reason).toBe("backend unreachable");
  });

  it("a failed run with no error text has reason 'failed'", () => {
    const r = recordOf([startEvent(), endEvent({ ok: false })]);
    expect([r.outcome, r.reason]).toEqual(["failed", "failed"]);
  });

  it("a stopped run has reason 'stopped by the caller'", () => {
    const r = recordOf([startEvent(), endEvent({ ok: false, ended: "stopped", error: "cancelled" })]);
    expect([r.outcome, r.reason]).toEqual(["stopped", "stopped by the caller"]);
  });

  it("a timed out run's reason names the deadline that ended it", () => {
    expect(recordOf([startEvent(), endEvent({ ok: false, ended: "queue_timeout" })]).reason).toBe("waited too long in the queue");
    expect(recordOf([startEvent(), endEvent({ ok: false, ended: "deadline" })]).reason).toBe("ran past its deadline");
    expect(recordOf([startEvent(), endEvent({ ok: false, ended: "stalled" })]).reason).toBe("stalled: the backend went quiet");
  });

  it("a cut off run's reason names what stopped it", () => {
    const len = recordOf([startEvent(), endEvent({ ok: true, finish_reason: "length" })]);
    expect([len.outcome, len.reason]).toEqual(["cut off", "hit the token limit"]);
    const cf = recordOf([startEvent(), endEvent({ ok: true, finish_reason: "content_filter" })]);
    expect([cf.outcome, cf.reason]).toEqual(["cut off", "the endpoint stopped it"]);
  });

  it("a stream without an end event is not a record", () => {
    expect(summariseRun("a.jsonl", 10, lines([startEvent()]), NOW)).toBeNull();
    expect(summariseRun("a.jsonl", 10, lines([startEvent(), { t: "priced", at: END_AT, turn: 1 }]), NOW)).toBeNull();
  });

  it("absent figures stay null, never 0", () => {
    const r = recordOf([
      startEvent({ at: undefined, workspace: undefined, model_key: undefined }),
      endEvent({ elapsed_seconds: undefined, input_tokens: undefined, output_tokens: undefined, cached_tokens: undefined }),
    ]);
    expect(r.startedAt).toBeNull();
    expect(r.repo).toBeNull();
    expect(r.model).toBeNull();
    expect(r.elapsedSeconds).toBeNull();
    expect(r.inputTokens).toBeNull();
    expect(r.outputTokens).toBeNull();
    expect(r.cachedTokens).toBeNull();
  });
});

describe("RunStore", () => {
  it("checkAll adds records, saves the file, and a second store loading it has the same records", () => {
    const dir = makeDir();
    const path = writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent(), endEvent()]);
    const store = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    expect(store.status().records).toBe(0);
    expect(store.status().checkedAt).toBeNull();
    store.checkAll();
    expect(store.records()).toEqual([okRecord("20261001T120000.000-a.jsonl", statSync(path).size)]);
    expect(store.status().records).toBe(1);
    expect(store.status().checkedAt).toBe(NOW.getTime());

    const store2 = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    store2.load();
    expect(store2.records()).toEqual([okRecord("20261001T120000.000-a.jsonl", statSync(path).size)]);
  });

  it("records come back newest first by startedAt", () => {
    const dir = makeDir();
    // The names sort the other way round, so only the start times can give this order.
    writeStream(dir, "20261001T130000.000-a.jsonl", [startEvent(), endEvent()]);
    writeStream(dir, "20261001T120000.000-b.jsonl", [startEvent({ at: "2026-10-01T13:00:00.000000+00:00" }), endEvent()]);
    const store = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    store.checkAll();
    expect(store.records().map((r) => r.name)).toEqual(["20261001T120000.000-b.jsonl", "20261001T130000.000-a.jsonl"]);
  });

  it("a record edited in the file is counted as disagreed and rebuilt from the stream", () => {
    const dir = makeDir();
    writeStream(dir, "a.jsonl", [startEvent(), endEvent()]);
    const file = join(dir, "runs.json");
    const store = new RunStore(file, dir, () => NOW);
    store.checkAll();
    expect(store.records()[0].outputTokens).toBe(50);

    const edited = readFileSync(file, "utf8").replace(/"outputTokens":\s*50/, '"outputTokens":999');
    writeFileSync(file, edited);

    const store2 = new RunStore(file, dir, () => NOW);
    store2.load();
    expect(store2.records()[0].outputTokens).toBe(999);
    store2.checkAll();
    expect(store2.status().disagreed).toBe(1);
    expect(store2.records()[0].outputTokens).toBe(50);
  });

  it("a record whose stream was deleted is kept and counted missing", () => {
    const dir = makeDir();
    writeStream(dir, "a.jsonl", [startEvent(), endEvent()]);
    const store = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    store.checkAll();
    expect(store.records()).toHaveLength(1);

    rmSync(join(dir, "a.jsonl"));
    store.checkAll();
    expect(store.records()).toHaveLength(1);
    expect(store.status().missing).toBe(1);
  });

  it("scan picks up a stream that ended after the check and leaves unchanged ones alone", () => {
    const dir = makeDir();
    const a = writeStream(dir, "a.jsonl", [startEvent(), endEvent()]);
    writeStream(dir, "b.jsonl", [startEvent()]); // unfinished: no record yet
    const store = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    store.checkAll();
    expect(store.records().map((r) => r.name)).toEqual(["a.jsonl"]);

    writeStream(dir, "b.jsonl", [startEvent(), endEvent()]); // b ends after the check
    store.scan();
    expect(store.records().map((r) => r.name).sort()).toEqual(["a.jsonl", "b.jsonl"]);
    expect(store.records().find((r) => r.name === "a.jsonl")).toEqual(okRecord("a.jsonl", statSync(a).size));

    // Same size, different content: a scan does not re-read it (the full check at start does).
    writeStream(dir, "a.jsonl", [startEvent(), endEvent({ output_tokens: 59 })]);
    store.scan();
    expect(store.records().find((r) => r.name === "a.jsonl")!.outputTokens).toBe(50);
  });

  it("a corrupt or wrong-version runs file is ignored", () => {
    const dir = makeDir();
    const file = join(dir, "runs.json");

    writeFileSync(file, "not json");
    let store = new RunStore(file, dir, () => NOW);
    store.load();
    expect(store.records()).toEqual([]);
    expect(store.status().records).toBe(0);
    expect(store.status().writeError).toBeNull();

    writeFileSync(file, JSON.stringify({ version: 2, runs: [GOOD] }));
    store = new RunStore(file, dir, () => NOW);
    store.load();
    expect(store.records()).toEqual([]);

    writeFileSync(file, JSON.stringify({ version: 1, runs: {} }));
    store = new RunStore(file, dir, () => NOW);
    store.load();
    expect(store.records()).toEqual([]);
  });

  it("drops a record of the wrong shape and keeps the good ones", () => {
    const dir = makeDir();
    const file = join(dir, "runs.json");
    const bad = [{ ...GOOD, name: 7 }, { ...GOOD, outcome: "exploded" }, { ...GOOD, inputTokens: "many" }, null, "x"];
    writeFileSync(file, JSON.stringify({ version: 1, runs: [GOOD, ...bad] }));
    const store = new RunStore(file, null, () => NOW);
    store.load();
    expect(store.records()).toEqual([GOOD]);
  });

  it("an unwritable dataDir sets writeError and does not throw", () => {
    const dir = makeDir();
    const streams = join(dir, "streams");
    mkdirSync(streams);
    writeStream(streams, "a.jsonl", [startEvent(), endEvent()]);
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x"); // an existing FILE, so mkdir of its child fails
    const store = new RunStore(join(blocker, "runs.json"), streams, () => NOW);
    expect(() => store.checkAll()).not.toThrow();
    expect(store.status().writeError).not.toBeNull();
  });
});
