// One test per rendering rule in docs/ARCHITECTURE.md "Rendering rules".
import { describe, expect, it } from "vitest";
import {
  applyLine,
  formatAge,
  formatDuration,
  listRow,
  newStreamState,
  parseAt,
  type StreamState,
} from "../../src/server/streams.ts";

const NOW = new Date("2026-10-01T13:00:09.000Z");
const QUIET = 120;

const at = (msBefore: number): string => new Date(NOW.getTime() - msBefore).toISOString();
const toLine = (v: unknown): string => JSON.stringify(v) as string;

function build(events: unknown[]): StreamState {
  const s = newStreamState();
  for (const e of events) applyLine(s, toLine(e));
  return s;
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

describe("states", () => {
  it("failed beats cut off", () => {
    const s = build([
      start(),
      { t: "end", at: at(0), ok: false, finish_reason: "length", error: "boom\nsecond line", turns: 2, max_turns: 8, elapsed_seconds: 10 },
    ]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("failed");
    expect(row.why).toBe("boom");
  });

  it("cut off for length", () => {
    const s = build([start(), { t: "end", at: at(0), ok: true, finish_reason: "length" }]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("cut off");
    expect(row.why).toBe("hit the token limit: raise max_tokens or split the task");
  });

  it("cut off for content_filter", () => {
    const s = build([start(), { t: "end", at: at(0), ok: true, finish_reason: "content_filter" }]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("cut off");
    expect(row.why).toBe("the endpoint stopped it");
  });

  it("an old finished stream is ok, never quiet", () => {
    const s = build([
      start({ at: at(24 * 3600 * 1000) }),
      { t: "end", at: at(24 * 3600 * 1000), ok: true, finish_reason: "stop", elapsed_seconds: 300 },
    ]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("ok");
    expect(row.age).toBeNull();
  });

  it("no event for quietAfterSeconds -> quiet with age", () => {
    const s = build([start({ at: at(200 * 1000) })]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("quiet");
    expect(row.age).toBe("3m");
  });

  it("a queued stream shows age from waited_seconds, not silence", () => {
    const s = build([start(), { t: "waiting", at: at(0), waited_seconds: 180 }]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("queued");
    expect(row.age).toBe("3m");
  });

  it("waited then priced is live, not queued", () => {
    const s = build([
      start(),
      { t: "waiting", at: at(0), waited_seconds: 180 },
      { t: "priced", at: at(0), turn: 1, of_turns: 8 },
    ]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("live");
  });

  it("quiet beats queued", () => {
    const s = build([
      start({ at: at(200 * 1000) }),
      { t: "waiting", at: at(200 * 1000), waited_seconds: 180 },
    ]);
    const row = listRow("x.jsonl", s, NOW, QUIET);
    expect(row.state).toBe("quiet");
    expect(row.age).toBe("3m");
  });
});

describe("the list", () => {
  it("kind ? when tools absent", () => {
    expect(listRow("x", build([start({ tools: undefined })]), NOW, QUIET).kind).toBe("?");
  });

  it("kind one-shot when tools empty", () => {
    expect(listRow("x", build([start({ tools: [] })]), NOW, QUIET).kind).toBe("one-shot");
  });

  it("kind is the tool name", () => {
    const s = build([start()]);
    expect(listRow("x", s, NOW, QUIET).kind).toBe("Read");
  });
});

describe("formatAge", () => {
  it("boundaries", () => {
    expect(formatAge(59)).toBe("59s");
    expect(formatAge(60)).toBe("1m");
    expect(formatAge(89 * 60 + 59)).toBe("89m");
    expect(formatAge(90 * 60)).toBe("1h");
  });
});

describe("formatDuration", () => {
  it("boundaries", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(171)).toBe("2m51s");
    expect(formatDuration(125)).toBe("2m05s");
    expect(formatDuration(3725)).toBe("1h02m");
  });

  it("clamps a negative value (the WSL clock a little ahead) to zero", () => {
    expect(formatDuration(-3)).toBe("0s");
    expect(formatAge(-3)).toBe("0s");
  });
});

describe("elapsed", () => {
  it("finished uses end.elapsed_seconds even when start was long ago", () => {
    const s = build([
      start({ at: at(24 * 3600 * 1000) }),
      { t: "end", at: at(0), ok: true, finish_reason: "stop", elapsed_seconds: 300 },
    ]);
    expect(listRow("x", s, NOW, QUIET).elapsed).toBe("5m00s");
  });

  it("running counts from start.at", () => {
    const s = build([start({ at: at(300 * 1000) })]);
    expect(listRow("x", s, NOW, QUIET).elapsed).toBe("5m00s");
  });
});

describe("turns", () => {
  it("2 of 8", () => {
    const s = build([
      start(),
      { t: "end", at: at(0), ok: true, finish_reason: "stop", turns: 2, max_turns: 8 },
    ]);
    expect(listRow("x", s, NOW, QUIET).turns).toBe("2 of 8");
  });

  it("1 for a one-shot with no max", () => {
    const s = build([
      start({ tools: [], max_turns: undefined }),
      { t: "end", at: at(0), ok: true, finish_reason: "stop", turns: 1 },
    ]);
    expect(listRow("x", s, NOW, QUIET).turns).toBe("1");
  });

  it("null before any turn without a budget", () => {
    const s = build([start({ max_turns: undefined })]);
    expect(listRow("x", s, NOW, QUIET).turns).toBeNull();
  });

  it("end.turns preferred when finished", () => {
    const s = build([
      start(),
      { t: "priced", at: at(0), turn: 5, of_turns: 8 },
      { t: "end", at: at(0), ok: true, finish_reason: "stop", turns: 2, max_turns: 8 },
    ]);
    expect(listRow("x", s, NOW, QUIET).turns).toBe("2 of 8");
  });
});

describe("reading streams", () => {
  it("JSON that is not an object is skipped and not a bad line", () => {
    const s = build([start()]);
    applyLine(s, "[]");
    applyLine(s, "123");
    applyLine(s, '"hi"');
    applyLine(s, "null");
    expect(s.badLines).toBe(0);
  });

  it("invalid JSON counts in badLines", () => {
    const s = newStreamState();
    applyLine(s, "{not json");
    expect(s.badLines).toBe(1);
  });

  it("unknown kind and unknown field change nothing but the at still refreshes lastAtMs", () => {
    const s = build([start({ at: at(0) })]);
    const before = s.lastAtMs;
    applyLine(s, toLine({ t: "from_the_future", at: at(-1000), x: 1 }));
    expect(s.lastAtMs).not.toBe(before);
    expect(s.lastSignal).toBeNull();
    expect(s.start).not.toBeNull();
  });
});

describe("unknownFormat", () => {
  it("2.0 gives unknownFormat 2.0", () => {
    const s = build([start({ format: "2.0" })]);
    expect(listRow("x", s, NOW, QUIET).unknownFormat).toBe("2.0");
  });

  it("missing format and 1.1 give null", () => {
    expect(listRow("x", build([start({ format: undefined })]), NOW, QUIET).unknownFormat).toBeNull();
    expect(listRow("x", build([start({ format: "1.1" })]), NOW, QUIET).unknownFormat).toBeNull();
  });
});

describe("parseAt", () => {
  it("handles 6-digit fractions and +00:00", () => {
    expect(parseAt("2026-10-01T13:00:09.000000+00:00")).toBe(Date.parse("2026-10-01T13:00:09Z"));
    expect(parseAt("2026-10-01T13:00:09.123456Z")).toBe(Date.parse("2026-10-01T13:00:09.123Z"));
    expect(parseAt("2026-10-01T13:00:09Z")).toBe(Date.parse("2026-10-01T13:00:09Z"));
    expect(parseAt(42)).toBeNull();
    expect(parseAt("not a date")).toBeNull();
  });
});
