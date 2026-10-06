// One test per rendering rule in handoff/view-spec.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyLine, listRow, newStreamState, type StreamState } from "../../src/server/streams.ts";
import { applyViewEvent, buildView, diffView, newViewState, turnThinking, type StreamView, type ViewState } from "../../src/server/view.ts";

const NOW = new Date("2026-10-01T13:00:09.000Z");
const QUIET = 120;

const at = (msBefore: number): string => new Date(NOW.getTime() - msBefore).toISOString();
const toLine = (v: unknown): string => JSON.stringify(v) as string;

function build(events: unknown[]): { state: StreamState; view: ViewState } {
  const state = newStreamState();
  const view = newViewState();
  for (const e of events) {
    applyLine(state, toLine(e));
    applyViewEvent(view, e as Record<string, unknown>);
  }
  return { state, view };
}

function viewOf(events: unknown[], name = "x.jsonl"): StreamView {
  const { state, view } = build(events);
  return buildView(name, view, state, listRow(name, state, NOW, QUIET));
}

const start = (over: Record<string, unknown> = {}) => ({
  t: "start",
  at: at(0),
  format: "1.1",
  tool: "Read",
  task: "Do the thing",
  max_turns: 8,
  tools: ["Read"],
  ...over,
});

describe("budget", () => {
  it("shows all four pieces", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4, max_tokens: 8192, budget_ceiling: 16384, requests_running: 2, rate_source: "cluster_since_boot" },
    ]);
    expect(v.turns[0].budget).toBe("turn 1 · max_tokens 8192 · cap 16384 · 2 running");
  });

  it("says no cap when the ceiling is null", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4, max_tokens: 8192, budget_ceiling: null, requests_running: 2, rate_source: "cluster_since_boot" },
    ]);
    expect(v.turns[0].budget).toBe("turn 1 · max_tokens 8192 · no cap · 2 running");
  });

  it("leaves out an absent ceiling", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4, max_tokens: 8192, requests_running: 2, rate_source: "cluster_since_boot" },
    ]);
    expect(v.turns[0].budget).toBe("turn 1 · max_tokens 8192 · 2 running");
  });

  it("says N running for cluster_since_boot", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4, requests_running: 2, rate_source: "cluster_since_boot" },
    ]);
    expect(v.turns[0].budget).toBe("turn 1 · 2 running");
  });

  it("says priced for N at observed concurrency", () => {
    const a = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4, requests_running: 2, rate_source: "observed_at_concurrency" }]);
    const b = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4, requests_running: 2, rate_source: "own_turns" }]);
    expect(a.turns[0].budget).toBe("turn 1 · priced for 2");
    expect(b.turns[0].budget).toBe("turn 1 · priced for 2");
  });

  it("says concurrency N for any other or absent rate_source", () => {
    const a = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4, requests_running: 2, rate_source: "from_the_future" }]);
    const b = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4, requests_running: 2 }]);
    expect(a.turns[0].budget).toBe("turn 1 · concurrency 2");
    expect(b.turns[0].budget).toBe("turn 1 · concurrency 2");
  });

  it("leaves out requests_running when absent", () => {
    const v = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4, max_tokens: 8192 }]);
    expect(v.turns[0].budget).toBe("turn 1 · max_tokens 8192");
  });
});

describe("heading", () => {
  it("says turn N of M when of_turns is present", () => {
    const v = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4 }]);
    expect(v.turns[0].heading).toBe("turn 1 of 4");
  });

  it("says just turn N without of_turns", () => {
    const v = viewOf([start(), { t: "priced", at: at(0), turn: 1 }]);
    expect(v.turns[0].heading).toBe("turn 1");
  });
});

describe("heartbeat", () => {
  it("shows chunks with the thinking/answering split", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340, reasoning_chunks: 300, answer_chunks: 40, since_chunk_seconds: 0.4 },
    ]);
    expect(v.turns[0].heartbeat).toBe("340 chunks (300 thinking / 40 answering)");
  });

  it("shows no split when reasoning_chunks is absent", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340, since_chunk_seconds: 0.4 },
    ]);
    expect(v.turns[0].heartbeat).toBe("340 chunks");
  });

  it("says still running at zero chunks", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 0 },
    ]);
    expect(v.turns[0].heartbeat).toBe("still running");
  });

  it("shows the seconds since the last chunk at 2s", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340, since_chunk_seconds: 2 },
    ]);
    expect(v.turns[0].heartbeat).toBe("340 chunks · 2s since the last chunk");
  });

  it("hides the seconds since the last chunk below 2s", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340, since_chunk_seconds: 1.9 },
    ]);
    expect(v.turns[0].heartbeat).toBe("340 chunks");
  });

  it("shows the countdown from ends_in_seconds", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, ends_in_seconds: 540, chunks_seen: 340, since_chunk_seconds: 0.4 },
    ]);
    expect(v.turns[0].heartbeat).toBe("340 chunks · ends in 9m00s");
  });

  it("is null once the turn is closed", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "" },
    ]);
    expect(v.turns[0].heartbeat).toBeNull();
  });
});

describe("calls", () => {
  it("lists a closed turn's calls from the turn event", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "read_file", outcome: "ran", arguments: { path: "/w/proj/backoff.py", start_line: "1" }, result_bytes: 1200, result_lines: 40, ms: 12 },
        { name: "run_bash", outcome: "ran", arguments: { command: "pytest -q tests/test_backoff.py" }, result_bytes: 310, result_lines: 4, exit_code: 1, ms: 14800 },
      ], text: "" },
    ]);
    const calls = v.turns[0].calls;
    expect(v.turns[0].closed).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].outcome).toBe("ran");
    expect(calls[0].ok).toBe(true);
    expect(calls[0].args).toEqual([["path", "/w/proj/backoff.py"], ["start_line", "1"]]);
    expect(calls[0].result).toBe("40 lines · 1.2 KB");
    expect(calls[0].time).toBe("<1s");
    expect(calls[1].name).toBe("run_bash");
    expect(calls[1].result).toBe("4 lines · 310 B");
    expect(calls[1].exitCode).toBe(1);
    expect(calls[1].time).toBe("14s");
  });

  it("lists an open announced turn's calls from tools with running statuses", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "tools", at: at(0), turn: 1, of_turns: 4, tool_calls: [
        { name: "read_file", arguments: { path: "/w/proj/backoff.py", start_line: "1" } },
        { name: "run_bash", arguments: { command: "pytest -q tests/test_backoff.py" } },
      ] },
      { t: "alive", at: at(0), elapsed_seconds: 120, chunks_seen: 360, reasoning_chunks: 310, answer_chunks: 50, since_chunk_seconds: 59, running: [
        { name: "read_file", arguments: { path: "/w/proj/backoff.py", start_line: "1" }, status: "done" },
        { name: "run_bash", arguments: { command: "pytest -q tests/test_backoff.py" }, status: "running" },
      ] },
    ]);
    const calls = v.turns[0].calls;
    expect(v.turns[0].closed).toBe(false);
    expect(calls.length).toBe(2);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].status).toBe("done");
    expect(calls[0].outcome).toBeNull();
    expect(calls[0].ok).toBeNull();
    expect(calls[1].name).toBe("run_bash");
    expect(calls[1].status).toBe("running");
  });

  it("lists an open turn with no tools event from the alive running list", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 0, running: [
        { name: "read_file", arguments: { path: "/w/a" }, status: "running" },
      ] },
    ]);
    expect(v.turns[0].calls.length).toBe(1);
    expect(v.turns[0].calls[0].name).toBe("read_file");
    expect(v.turns[0].calls[0].status).toBe("running");
    expect(v.turns[0].calls[0].ok).toBeNull();
  });

  it("gives an open call a null status when the running name does not match", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "tools", at: at(0), turn: 1, of_turns: 4, tool_calls: [
        { name: "read_file", arguments: {} },
      ] },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 0, running: [
        { name: "other", arguments: {}, status: "running" },
      ] },
    ]);
    expect(v.turns[0].calls[0].status).toBeNull();
  });

  it("is ok true for ran and repeat and false for refused", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "a", outcome: "ran", arguments: {} },
        { name: "b", outcome: "repeat", arguments: {} },
        { name: "c", outcome: "refused", arguments: {} },
      ], text: "" },
    ]);
    expect(v.turns[0].calls.map((c) => c.ok)).toEqual([true, true, false]);
  });

  it("keeps a refusal's message in full", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "read_file", outcome: "refused", arguments: { path: "/w/proj/.env" }, message: "the filename '.env' is not on the extension allowlist.\nsecond line" },
      ], text: "" },
    ]);
    expect(v.turns[0].calls[0].message).toBe("the filename '.env' is not on the extension allowlist.\nsecond line");
    expect(v.turns[0].calls[0].ok).toBe(false);
  });

  it("keeps every argument, a non-string one as JSON", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "read_file", outcome: "ran", arguments: { path: "/w/a", start_line: 1, flag: true } },
      ], text: "" },
    ]);
    expect(v.turns[0].calls[0].args).toEqual([["path", "/w/a"], ["start_line", "1"], ["flag", "true"]]);
  });

  it("shows a result from both, one or neither of lines and bytes", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "both", outcome: "ran", arguments: {}, result_lines: 40, result_bytes: 1200 },
        { name: "lines", outcome: "ran", arguments: {}, result_lines: 40 },
        { name: "bytes", outcome: "ran", arguments: {}, result_bytes: 1200 },
        { name: "neither", outcome: "ran", arguments: {} },
      ], text: "" },
    ]);
    const calls = v.turns[0].calls;
    expect(calls[0].result).toBe("40 lines · 1.2 KB");
    expect(calls[1].result).toBe("40 lines");
    expect(calls[2].result).toBe("1.2 KB");
    expect(calls[3].result).toBeNull();
  });

  it("shows call time as <1s under a second and a duration otherwise", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "a", outcome: "ran", arguments: {}, ms: 12 },
        { name: "b", outcome: "ran", arguments: {}, ms: 14800 },
        { name: "c", outcome: "ran", arguments: {} },
      ], text: "" },
    ]);
    const calls = v.turns[0].calls;
    expect(calls[0].time).toBe("<1s");
    expect(calls[1].time).toBe("14s");
    expect(calls[2].time).toBeNull();
  });
});

describe("tool time", () => {
  it("is the sum of the calls' ms", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "a", outcome: "ran", arguments: {}, ms: 12 },
        { name: "b", outcome: "ran", arguments: {}, ms: 14800 },
      ], text: "" },
    ]);
    expect(v.turns[0].toolTime).toBe("14s");
  });

  it("falls back to turn ms minus backend_ms when the calls carry no ms", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [
        { name: "a", outcome: "ran", arguments: {} },
      ], ms: 15000, backend_ms: 14900, text: "" },
    ]);
    expect(v.turns[0].toolTime).toBe("<1s");
  });

  it("is null for a turn without calls", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, tool_calls: [], ms: 15000, backend_ms: 14900, text: "" },
    ]);
    expect(v.turns[0].toolTime).toBeNull();
  });
});

describe("when a turn started", () => {
  it("is its priced event's time", () => {
    const v = viewOf([start(), { t: "priced", at: "2026-10-01T13:00:05.000Z", turn: 1 }]);
    expect(v.turns[0].at).toBe("2026-10-01T13:00:05.000Z");
  });

  it("reads a time written with six decimal places, as the server writes it", () => {
    const v = viewOf([start(), { t: "priced", at: "2026-10-01T13:00:05.123456+00:00", turn: 1 }]);
    expect(v.turns[0].at).toBe("2026-10-01T13:00:05.123Z");
  });

  it("is unknown without a priced event", () => {
    expect(viewOf([start(), { t: "turn", at: at(0), turn: 1, text: "" }]).turns[0].at).toBeNull();
  });
});

describe("a question to the caller and its answer", () => {
  it("belong to the turn that was open when the question was asked", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1 },
      { t: "question", at: "2026-10-01T13:00:00.000Z", questions: ["Which file should the summary quote?"] },
      { t: "answer", at: at(0), text: "quote CHANGELOG.md", waited_seconds: 5.4 },
      { t: "turn", at: at(0), turn: 1, text: "" },
      { t: "priced", at: at(0), turn: 2 },
    ]);
    expect(v.turns[0].question).toEqual({ questions: ["Which file should the summary quote?"] });
    expect(v.turns[0].answer).toEqual({ text: "quote CHANGELOG.md", waited: "5s", bestReading: false });
    expect([v.turns[1].question, v.turns[1].answer]).toEqual([null, null]);
  });

  it("says when the caller left the choice to the delegation", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1 },
      { t: "question", at: at(0), questions: ["A or B?"] },
      { t: "answer", at: at(0), text: "Proceed on your best reading.", waited_seconds: 61, best_reading: true },
    ]);
    expect(v.turns[0].answer).toEqual({ text: "Proceed on your best reading.", waited: "1m01s", bestReading: true });
  });

  it("leaves out a question that lists no text", () => {
    const v = viewOf([start(), { t: "priced", at: at(0), turn: 1 }, { t: "question", at: at(0), questions: [42, "Which?"] }]);
    expect(v.turns[0].question).toEqual({ questions: ["Which?"] });
  });
});

describe("a turn's figures and the run's clock", () => {
  it("a closed turn carries its tokens in and out and its decode speed", () => {
    const t = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "", input_tokens: 5100, output_tokens: 160, out_tok_s: 40.2 },
    ]).turns[0];
    expect([t.tokensIn, t.tokensOut, t.tokS]).toEqual([5100, 160, 40.2]);
  });

  it("absent figures stay absent, never 0", () => {
    const t = viewOf([start(), { t: "priced", at: at(0), turn: 1 }, { t: "turn", at: at(0), turn: 1, text: "", out_tok_s: null }]).turns[0];
    expect([t.tokensIn, t.tokensOut, t.tokS]).toEqual([null, null, null]);
  });

  it("an open turn carries the newest heartbeat's elapsed time and budget", () => {
    const t = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1 },
      { t: "alive", at: at(0), elapsed_seconds: 30, of_seconds: 600, ends_in_seconds: 570 },
      { t: "alive", at: at(0), elapsed_seconds: 45, of_seconds: 600, ends_in_seconds: 555 },
    ]).turns[0];
    expect(t.clock).toEqual({ elapsed: 45, of: 600 });
  });

  it("has no clock without a budget, or once the turn has closed", () => {
    const open = viewOf([start(), { t: "priced", at: at(0), turn: 1 }, { t: "alive", at: at(0), elapsed_seconds: 30, of_seconds: null }]);
    expect(open.turns[0].clock).toBeNull();
    const closed = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1 },
      { t: "alive", at: at(0), elapsed_seconds: 30, of_seconds: 600 },
      { t: "turn", at: at(0), turn: 1, text: "" },
    ]);
    expect(closed.turns[0].clock).toBeNull();
  });
});

describe("repeated output, evicted tool results and the shell count", () => {
  const turnWith = (over: Record<string, unknown>) =>
    viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "", ...over },
    ]).turns[0];

  it("shows the repeated share from 15%, as a percent", () => {
    expect(turnWith({ duplicate_line_share: 0.15 }).repeated).toBe("15%");
    expect(turnWith({ duplicate_line_share: 0.234 }).repeated).toBe("23%");
  });

  it("hides a repeated share under 15%, and an absent one", () => {
    expect(turnWith({ duplicate_line_share: 0.149 }).repeated).toBeNull();
    expect(turnWith({ duplicate_line_share: null }).repeated).toBeNull();
    expect(turnWith({}).repeated).toBeNull();
  });

  it("shows evicted tool results only when the field is a number, a measured 0 included", () => {
    expect(turnWith({ tool_results_evicted: 3 }).evicted).toBe(3);
    expect(turnWith({ tool_results_evicted: 0 }).evicted).toBe(0);
    expect(turnWith({ tool_results_evicted: true }).evicted).toBeNull();
    expect(turnWith({ tool_results_evicted: null }).evicted).toBeNull();
    expect(turnWith({}).evicted).toBeNull();
  });

  const summaryWith = (over: Record<string, unknown>) =>
    viewOf([start(), { t: "end", at: at(0), ok: true, turns: 1, elapsed_seconds: 10, ...over }]).summary!;

  it("shows the shell count only above 0", () => {
    expect(summaryWith({ bash_calls: 4 }).shellCalls).toBe(4);
    expect(summaryWith({ bash_calls: 0 }).shellCalls).toBeNull();
    expect(summaryWith({ bash_calls: null }).shellCalls).toBeNull();
  });
});

describe("attempts", () => {
  it("is shown only above one", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 2, text: "" },
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
      { t: "turn", at: at(0), turn: 2, of_turns: 4, attempts: 1, text: "" },
    ]);
    expect(v.turns[0].attempts).toBe(2);
    expect(v.turns[1].attempts).toBeNull();
  });
});

describe("reply", () => {
  it("is the closing turn's text", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "The loop retries until the deadline, not a fixed count; the failing test expects a count." },
    ]);
    expect(v.turns[0].reply).toBe("The loop retries until the deadline, not a fixed count; the failing test expects a count.");
  });
});

describe("waiting", () => {
  it("includes the limit when of_seconds is above 0", () => {
    const v = viewOf([start(), { t: "waiting", at: at(0), waited_seconds: 180, of_seconds: 600 }]);
    expect(v.waiting).toBe("queued 3m of 10m");
  });

  it("drops a zero or absent limit", () => {
    const zero = viewOf([start(), { t: "waiting", at: at(0), waited_seconds: 180, of_seconds: 0 }]);
    const absent = viewOf([start(), { t: "waiting", at: at(0), waited_seconds: 180 }]);
    expect(zero.waiting).toBe("queued 3m");
    expect(absent.waiting).toBe("queued 3m");
  });

  it("is null when the stream is not queued", () => {
    const v = viewOf([
      start(),
      { t: "waiting", at: at(0), waited_seconds: 180 },
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
    ]);
    expect(v.waiting).toBeNull();
  });
});

describe("summary", () => {
  it("reads finished values from end", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, input_tokens: 1800, output_tokens: 120, cached_tokens: 1024, text: "" },
      { t: "end", at: at(0), ok: true, turns: 1, max_turns: 4, elapsed_seconds: 190.1, output_tokens: 300, cached_tokens: 2816, finish_reason: "stop", tool_seconds: 14.8, failed_calls: 0 },
    ]);
    const s = v.summary!;
    expect(s.finished).toBe(true);
    expect(s.ok).toBe(true);
    expect(s.elapsed).toBe("3m10s");
    expect(s.turns).toBe("1 of 4");
    expect(s.cached).toBe(2816);
    expect(s.returned).toBe(300);
    expect(s.failures).toBe(0);
    expect(s.toolTime).toBe("14s");
    expect(s.finishReason).toBe("stop");
  });

  it("sums closed turns while running", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 40, text: "" },
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
      { t: "turn", at: at(0), turn: 2, of_turns: 4, attempts: 1, input_tokens: 200, output_tokens: 30, cached_tokens: 80, text: "" },
    ]);
    const s = v.summary!;
    expect(s.finished).toBe(false);
    expect(s.ok).toBeNull();
    expect(s.elapsed).toBeNull();
    expect(s.cached).toBe(120);
    expect(s.load).toBe(350);
    expect(s.reuse).toBe("40%");
    expect(s.returned).toBeNull();
    expect(s.failures).toBeNull();
    expect(s.toolTime).toBeNull();
  });

  it("reuse is cached over prompt tokens as a rounded percent", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, attempts: 1, input_tokens: 100, output_tokens: 50, text: "" },
      { t: "end", at: at(0), ok: true, turns: 1, max_turns: 4, elapsed_seconds: 10, cached_tokens: 61, output_tokens: 50 },
    ]);
    expect(v.summary!.reuse).toBe("61%");
  });

  it("failures falls back to tool_errors plus bash_failures", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "" },
      { t: "end", at: at(0), ok: false, turns: 1, elapsed_seconds: 10, tool_errors: 0, bash_failures: 1 },
    ]);
    expect(v.summary!.failures).toBe(1);
  });

  it("failures is null for a one-shot with null counters", () => {
    const v = viewOf([
      start({ tools: [] }),
      { t: "end", at: at(0), ok: false, turns: 1, elapsed_seconds: 9.1, failed_calls: null, tool_errors: null, bash_failures: null, error: "backend_unreachable: the endpoint refused the connection" },
    ]);
    expect(v.summary!.failures).toBeNull();
  });

  it("is null when nothing besides finished/ok is present", () => {
    const v = viewOf([start({ max_turns: undefined })]);
    expect(v.summary).toBeNull();
  });
});

describe("files", () => {
  it("lists given paths, sizes, and skip reasons", () => {
    const v = viewOf([
      start({
        files_read: [
          { path: "/w/proj/backoff.py", given: "C:\\w\\proj\\backoff.py", bytes: 1200, est_tokens: 325 },
          { path: "/w/proj/only-path.py", bytes: 310 },
          "not an object",
        ],
        files_skipped: [
          { path: "/w/proj/.env", given: "C:\\w\\proj\\.env", reason: "the filename '.env' is not on the extension allowlist.", kind: "refused" },
        ],
      }),
    ]);
    expect(v.files).toEqual([
      { path: "C:\\w\\proj\\backoff.py", size: "1.2 KB", skipped: null },
      { path: "/w/proj/only-path.py", size: "310 B", skipped: null },
      { path: "C:\\w\\proj\\.env", size: null, skipped: "the filename '.env' is not on the extension allowlist." },
    ]);
  });
});

describe("event handling", () => {
  it("an unknown event kind changes nothing and returns false", () => {
    const v = newViewState();
    expect(applyViewEvent(v, { t: "from_the_future", at: at(0), x: 1 })).toBe(false);
    expect(v.seq).toBe(0);
  });

  it("a known event with an unknown field is still used", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4, max_tokens: 8192, zzz_unknown: 1 },
    ]);
    expect(v.turns[0].budget).toBe("turn 1 · max_tokens 8192");
    expect(v.turns[0].heading).toBe("turn 1 of 4");
  });

  it("seq increases with each applied known event", () => {
    const v = newViewState();
    expect(applyViewEvent(v, { t: "priced", at: at(0), turn: 1, of_turns: 4 })).toBe(true);
    expect(v.seq).toBe(1);
    expect(applyViewEvent(v, { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340 })).toBe(true);
    expect(v.seq).toBe(2);
  });
});

describe("diffView", () => {
  it("sends every turn when there is no previous view", () => {
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "hi" },
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
    ]);
    const patch = diffView(null, next);
    expect(patch.name).toBe("x.jsonl");
    expect(patch.seq).toBe(next.seq);
    expect(patch.turns.map((t) => t.index)).toEqual([0, 1]);
    expect(patch.turns[0].turn).toEqual(next.turns[0]);
    expect(patch.turns[1].turn).toEqual(next.turns[1]);
  });

  it("leaves out an unchanged closed turn and includes the changed open turn", () => {
    const closed = [
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "hi" },
    ];
    const prev = viewOf(closed);
    const next = viewOf([
      ...closed,
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
      { t: "alive", at: at(0), elapsed_seconds: 60, chunks_seen: 340 },
    ]);
    const patch = diffView(prev, next);
    expect(patch.turns.map((t) => t.index)).toEqual([1]);
    expect(patch.turns[0].turn).toEqual(next.turns[1]);
    expect(patch.seq).toBe(next.seq);
  });
});

describe("contract samples", () => {
  const root = join(import.meta.dirname, "../..");
  const samplesDir = join(root, "contract", "samples");

  function loadSample(file: string): StreamView {
    const state = newStreamState();
    const view = newViewState();
    const lines = readFileSync(join(samplesDir, file), "utf8").split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      applyLine(state, line);
      applyViewEvent(view, JSON.parse(line) as Record<string, unknown>);
    }
    return buildView(file, view, state, listRow(file, state, NOW, QUIET));
  }

  it("renders the agentic sample and the one-shot failure sample", () => {
    const agentic = loadSample("agentic.jsonl");
    expect(agentic.turns.length).toBe(2);
    expect(agentic.turns[0].closed).toBe(true);
    expect(agentic.turns[0].calls.length).toBe(2);
    expect(agentic.turns[0].calls[0].name).toBe("read_file");
    expect(agentic.turns[0].calls[1].name).toBe("run_bash");
    expect(agentic.turns[1].reply).toBe("The loop retries until the deadline, not a fixed count; the failing test expects a count.");
    expect(agentic.summary).not.toBeNull();
    expect(agentic.summary!.finished).toBe(true);
    expect(agentic.summary!.ok).toBe(true);

    const failed = loadSample("one_shot_failed.jsonl");
    expect(failed.summary).not.toBeNull();
    expect(failed.summary!.finished).toBe(true);
    expect(failed.summary!.ok).toBe(false);
    expect(failed.summary!.error).toBe("backend_unreachable: the endpoint refused the connection");
  });
});

describe("partial reply", () => {
  it("accepts a partial event and bumps seq", () => {
    const v = newViewState();
    expect(applyViewEvent(v, { t: "partial", at: at(0), turn: 2, reasoning: "x", answer: "y" })).toBe(true);
    expect(v.seq).toBe(1);
  });

  it("appends reasoning and answer in order while the turn is open", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
      { t: "partial", at: at(0), turn: 2, reasoning: "The test counts attempts; ", answer: "" },
      { t: "partial", at: at(0), turn: 2, reasoning: "the loop counts time.", answer: "The loop retries until the deadline, " },
    ]);
    expect(v.turns[0].closed).toBe(false);
    expect(v.turns[0].partial).toEqual({
      reasoning: "The test counts attempts; the loop counts time.",
      answer: "The loop retries until the deadline, ",
    });
  });

  it("appends nothing for an absent or non-string field", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
      { t: "partial", at: at(0), turn: 1, answer: "c" },
      { t: "partial", at: at(0), turn: 1, reasoning: 5, answer: "d" },
    ]);
    expect(v.turns[0].partial).toEqual({ reasoning: "a", answer: "bcd" });
  });

  it("clears partial and uses the turn text once the turn closes", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "first try, ", answer: "first try, " },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "final answer" },
    ]);
    expect(v.turns[0].closed).toBe(true);
    expect(v.turns[0].partial).toBeNull();
    expect(v.turns[0].reply).toBe("final answer");
  });

  it("keeps partial null for an open turn with no partial events", () => {
    const v = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4 }]);
    expect(v.turns[0].closed).toBe(false);
    expect(v.turns[0].partial).toBeNull();
  });

  it("appends only the added text when a later partial follows an earlier one", () => {
    const prev = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
    ]);
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
      { t: "partial", at: at(0), turn: 1, reasoning: "c", answer: "d" },
    ]);
    const patch = diffView(prev, next);
    expect(patch.turns.length).toBe(1);
    const entry = patch.turns[0];
    expect(entry.append).toBe(true);
    expect(entry.turn.partial).toEqual({ reasoning: "c", answer: "d" });
    expect(entry.turn.n).toBe(1);
    expect(entry.turn.closed).toBe(false);
    expect(entry.turn.reply).toBeNull();
  });

  it("carries the whole turn when there is no previous view", () => {
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
    ]);
    const patch = diffView(null, next);
    expect(patch.turns.length).toBe(1);
    expect(patch.turns[0].append).toBeUndefined();
    expect(patch.turns[0].turn).toEqual(next.turns[0]);
  });

  it("carries a new turn whole when it was absent before", () => {
    const prev = viewOf([start(), { t: "priced", at: at(0), turn: 1, of_turns: 4 }]);
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "priced", at: at(0), turn: 2, of_turns: 4 },
      { t: "partial", at: at(0), turn: 2, reasoning: "a", answer: "b" },
    ]);
    const patch = diffView(prev, next);
    expect(patch.turns.map((t) => t.index)).toEqual([1]);
    expect(patch.turns[0].append).toBeUndefined();
    expect(patch.turns[0].turn).toEqual(next.turns[1]);
  });

  it("carries the whole turn when partial became null on closing", () => {
    const prev = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
    ]);
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "a", answer: "b" },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "done" },
    ]);
    const patch = diffView(prev, next);
    expect(patch.turns.length).toBe(1);
    expect(patch.turns[0].append).toBeUndefined();
    expect(patch.turns[0].turn).toEqual(next.turns[0]);
  });

  it("carries the whole turn when the old partial is not a prefix of the new (a rebuilt stream)", () => {
    const prev = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "old thoughts", answer: "old answer" },
    ]);
    const next = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "new", answer: "new answer, longer than before" },
    ]);
    const patch = diffView(prev, next);
    expect(patch.turns[0].append).toBeUndefined();
    expect(patch.turns[0].turn).toEqual(next.turns[0]);
  });

  it("builds turn 2's partial from the agentic sample up to its partial lines", () => {
    const root = join(import.meta.dirname, "../..");
    const file = join(root, "contract", "samples", "agentic.jsonl");
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    const turn2End = lines.findIndex((l) => {
      const e = JSON.parse(l) as Record<string, unknown>;
      return e.t === "turn" && e.turn === 2;
    });
    const state = newStreamState();
    const view = newViewState();
    for (const line of lines.slice(0, turn2End)) {
      applyLine(state, line);
      applyViewEvent(view, JSON.parse(line) as Record<string, unknown>);
    }
    const v = buildView("agentic.jsonl", view, state, listRow("agentic.jsonl", state, NOW, QUIET));
    expect(v.turns.length).toBe(2);
    const turn2 = v.turns[1];
    expect(turn2.closed).toBe(false);
    expect(turn2.partial).toEqual({
      reasoning: "The test counts attempts; the loop counts time.",
      answer: "The loop retries until the deadline, ",
    });
  });
});

describe("a closed turn's thinking", () => {
  it("joins a closed turn's partial reasoning in order, incomplete", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "Look at ", answer: "" },
      { t: "partial", at: at(0), turn: 1, reasoning: "the file.", answer: "" },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "" },
    ]);
    expect(v.turns[0].closed).toBe(true);
    expect(v.turns[0].thinking).toEqual({ chars: 17, complete: false });
  });

  it("is complete when a partial carried answer text", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "Look at ", answer: "" },
      { t: "partial", at: at(0), turn: 1, reasoning: "the file.", answer: "Done" },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "Done" },
    ]);
    expect(v.turns[0].thinking).toEqual({ chars: 17, complete: true });
  });

  it("is null when the partials carried only answer text", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "", answer: "The answer" },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "The answer" },
    ]);
    expect(v.turns[0].thinking).toBeNull();
  });

  it("is null for an open turn, whose partial still holds the reasoning", () => {
    const v = viewOf([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "weighing the wrappers", answer: "" },
    ]);
    expect(v.turns[0].closed).toBe(false);
    expect(v.turns[0].thinking).toBeNull();
    expect(v.turns[0].partial).toEqual({ reasoning: "weighing the wrappers", answer: "" });
  });

  it("turnThinking joins a closed turn's partial reasoning in order", () => {
    const { view } = build([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "Look at ", answer: "" },
      { t: "partial", at: at(0), turn: 1, reasoning: "the file.", answer: "" },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "" },
    ]);
    expect(turnThinking(view, 1)).toBe("Look at the file.");
  });

  it("turnThinking is null for an open turn", () => {
    const { view } = build([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "partial", at: at(0), turn: 1, reasoning: "weighing the wrappers", answer: "" },
    ]);
    expect(turnThinking(view, 1)).toBeNull();
  });

  it("turnThinking is null for a turn number that does not exist", () => {
    const { view } = build([start()]);
    expect(turnThinking(view, 1)).toBeNull();
  });

  it("turnThinking is null for a closed turn without reasoning", () => {
    const { view } = build([
      start(),
      { t: "priced", at: at(0), turn: 1, of_turns: 4 },
      { t: "turn", at: at(0), turn: 1, of_turns: 4, text: "" },
    ]);
    expect(turnThinking(view, 1)).toBeNull();
  });
});
