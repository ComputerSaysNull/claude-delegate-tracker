// One test per rule in handoff/spec-33-backend.md, for the run records kept on disk.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore, absolutePaths, learnParents, repoFromPaths, summariseRun, type RunRecord } from "../../src/server/runs.ts";

const NOW = new Date("2026-10-01T13:00:00.000Z");
// A well-formed record, as the store writes it.
const GOOD = {
  name: "20261001T120000.000-a.jsonl", size: 100, startedAt: Date.parse("2026-10-01T12:00:00Z"), outcome: "ok", reason: null,
  repo: "web-shop", repoFromPaths: false, model: "flash", elapsedSeconds: 3, inputTokens: 10, outputTokens: 2, cachedTokens: 5,
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

// A tool call as the contract's turn/tools events carry it: name, outcome, arguments.path.
function toolCall(name: string, path: string, outcome = "ran"): Record<string, unknown> {
  return { name, outcome, arguments: { path } };
}

function toolEvent(t: "turn" | "tools", calls: Record<string, unknown>[]): Record<string, unknown> {
  return { t, at: END_AT, turn: 1, tool_calls: calls };
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
    name, size, startedAt: START_MS, outcome: "ok", reason: null, repo: "C:\\proj", repoFromPaths: false,
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
      name: "a.jsonl", size: 1200, startedAt: START_MS, outcome: "ok", reason: null, repo: "C:\\proj", repoFromPaths: false,
      model: "flash", elapsedSeconds: 60, inputTokens: 100, outputTokens: 50, cachedTokens: 20,
    });
  });

  it("a failed run's reason is the first line before its first colon", () => {
    const r = recordOf([startEvent(), endEvent({ ok: false, error: "backend unreachable: the endpoint refused the connection" })]);
    expect([r.outcome, r.reason]).toEqual(["failed", "backend unreachable"]);
    const multi = recordOf([startEvent(), endEvent({ ok: false, error: "backend unreachable: the endpoint refused\nsecond line" })]);
    expect(multi.reason).toBe("backend unreachable");
  });

  it("a failed run's reason groups the same cause: numbers and ids read N, cut to eight words", () => {
    const reasonOf = (error: string) => recordOf([startEvent(), endEvent({ ok: false, error })]).reason;
    const stall = (s: string) => `Delegation abandoned after ${s}s, past the DELEGATE_STALL_TIMEOUT of ${s}s, with no turn completed. Progress at that point`;
    expect(reasonOf(stall("2100.0"))).toBe(reasonOf(stall("900.0")));
    expect(reasonOf(stall("2100.0"))).toBe("Delegation abandoned after N past the DELEGATE_STALL_TIMEOUT of…");
    const cancel = (id: string) => `Cancelled via cancel scope ${id} by <Task pending name='loop' coro=<run() running at /x/y.py:12>>`;
    expect(reasonOf(cancel("75db9c1249b0"))).toBe(reasonOf(cancel("7d2a26decff0")));
    expect(reasonOf("Layer 3 cannot run")).toBe("Layer N cannot run");
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

describe("absolutePaths", () => {
  it("picks the four sources: files_read, files_skipped, and turn/tools tool calls", () => {
    const ev = [
      startEvent({
        files_read: [{ path: "C:/r/a.py", given: "C:/r/a-g.py", bytes: 1, est_tokens: 1 }],
        files_skipped: [{ path: "C:/s/b.py", given: "C:/s/b-g.py", reason: "nope", kind: "refused" }],
      }),
      toolEvent("turn", [toolCall("read_file", "C:/t/c.py")]),
      toolEvent("tools", [toolCall("run_bash", "C:/u/d.py")]),
    ];
    expect(absolutePaths(lines(ev))).toEqual(["C:/r/a.py", "C:/r/a-g.py", "C:/s/b.py", "C:/s/b-g.py", "C:/t/c.py", "C:/u/d.py"]);
  });

  it("keeps a path with a lower-case drive letter, upper-casing it", () => {
    expect(absolutePaths(lines([startEvent({ files_read: [{ path: "c:\\only\\one.py", given: "c:\\only\\one.py", bytes: 1, est_tokens: 1 }] })]))).toEqual(["C:/only/one.py"]);
  });

  it("drops relative and non-string paths and normalises the absolute forms", () => {
    const ev = [
      startEvent({
        files_read: [{ path: "C:\\x\\y", given: "relative/g.py", bytes: 1, est_tokens: 1 }],
        files_skipped: [{ path: "c:/x/y", given: "c:/x/y", reason: "nope", kind: "refused" }],
      }),
      toolEvent("turn", [toolCall("read_file", "/mnt/c/x/y")]),
      toolEvent("tools", [
        toolCall("read_file", "C:/x/y/"),
        toolCall("read_file", "C:/x/y"),
        { name: "read_file", arguments: { path: 42 } },
      ]),
    ];
    expect(absolutePaths(lines(ev))).toEqual(["C:/x/y"]);
  });
});

describe("learnParents", () => {
  it("marks the joined segments before a path segment equal to the repo", () => {
    expect(learnParents([{ repo: "web-shop", paths: ["C:/u/proj/web-shop/a.py"] }])).toEqual(["C:/u/proj"]);
  });

  it("returns distinct parents and ignores runs whose paths never name the repo", () => {
    expect(learnParents([
      { repo: "web-shop", paths: ["C:/u/proj/web-shop/a.py", "C:/u/proj/web-shop/b.py"] },
      { repo: "web-shop", paths: ["C:/u/proj/web-shop/c.py"] },
      { repo: "other", paths: ["C:/x/y"] },
    ])).toEqual(["C:/u/proj"]);
  });
});

describe("a repo for runs that name none", () => {
  it("is taken from the paths they read, under the folder a named run sits in", () => {
    const dir = makeDir();
    writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent({ workspace: "web-shop" }), toolEvent("turn", [toolCall("read_file", "/mnt/c/u/proj/web-shop/a.py")]), endEvent()]);
    writeStream(dir, "20261001T110000.000-b.jsonl", [startEvent({ workspace: undefined }), toolEvent("turn", [toolCall("read_file", "C:\\u\\proj\\web-shop\\b.py")]), endEvent()]);
    writeStream(dir, "20261001T100000.000-c.jsonl", [startEvent({ workspace: undefined }), toolEvent("turn", [toolCall("read_file", "C:/u/proj/web-shop/c.py"), toolCall("read_file", "C:/u/proj/infra/d.py")]), endEvent()]);
    const store = new RunStore(join(dir, "runs.json"), dir, () => NOW);
    store.checkAll();
    const byName = new Map(store.records().map((r) => [r.name.slice(-7), [r.repo, r.repoFromPaths]]));
    expect(byName.get("a.jsonl")).toEqual(["web-shop", false]);
    expect(byName.get("b.jsonl")).toEqual(["web-shop", true]);
    expect(byName.get("c.jsonl")).toEqual([null, false]);
    expect(JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")).runs.every((r: Record<string, unknown>) => !("paths" in r))).toBe(true);
  });
});

describe("repoFromPaths", () => {
  it("names the folder under a learned parent", () => {
    expect(repoFromPaths(["C:/u/proj/web-shop/a.py"], ["C:/u/proj"])).toBe("web-shop");
  });

  it("names a sibling folder no stream named, beside a learned one", () => {
    expect(repoFromPaths(["C:/u/proj/other/z.py"], ["C:/u/proj"])).toBe("other");
  });

  it("is null when the paths sit under two repos", () => {
    expect(repoFromPaths(["C:/u/proj/web-shop/a.py", "C:/u/proj/other/z.py"], ["C:/u/proj"])).toBeNull();
  });

  it("is null when no path is under a parent", () => {
    expect(repoFromPaths(["D:/elsewhere/t.py"], ["C:/u/proj"])).toBeNull();
  });

  it("picks the longest parent when parents nest", () => {
    expect(repoFromPaths(["C:/u/proj/web-shop/a.py"], ["C:/u", "C:/u/proj"])).toBe("web-shop");
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
    const bad = [{ ...GOOD, name: 7 }, { ...GOOD, outcome: "exploded" }, { ...GOOD, inputTokens: "many" }, { ...GOOD, repoFromPaths: "yes" }, null, "x"];
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
