// The History tab's figures: the pure helpers the page turns the run records into. All the
// dates are local, so a fixed `now` and local-time constructors keep these green in any zone.
import { describe, expect, it } from "vitest";
import { askedMoreThanOnce, dayMonthYear, groupBy, inRange, median, perDay, reasons, spanOf, totals } from "../../src/web/historyData.ts";
import type { RunRecord } from "../../src/server/runs.ts";

const DAY = 86_400_000;

// A finished run with every field set; override the ones a test cares about.
function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    name: "stream.jsonl",
    size: 100,
    repoFromPaths: false,
    startedAt: new Date(2026, 9, 4, 12).getTime(),
    outcome: "ok",
    reason: null,
    repo: "web-shop",
    model: "claude-code",
    elapsedSeconds: 60,
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 600,
    rebuiltTurns: null,
    asks: 0,
    questions: 0,
    mcpTask: null,
    messages: null,
    undelivered: null,
    messageWaits: null,
    ...overrides,
  };
}

describe("inRange", () => {
  const now = new Date(2026, 9, 4, 12);

  it("keeps the runs on the last `days` local days, today included", () => {
    const today = run({ name: "today", startedAt: new Date(2026, 9, 4, 8).getTime() });
    const first = run({ name: "first", startedAt: new Date(2026, 8, 28, 12).getTime() });
    const before = run({ name: "before", startedAt: new Date(2026, 8, 27, 12).getTime() });
    const runs = [today, first, before];
    expect(inRange(runs, spanOf(7, runs, now)).map((r) => r.name)).toEqual(["today", "first"]);
  });

  it("leaves out a run with no startedAt", () => {
    const runs = [run({ name: "nostart", startedAt: null })];
    expect(inRange(runs, spanOf(7, runs, now))).toEqual([]);
  });

  it("counts days-1 back from today for a 30-day range", () => {
    const first = run({ name: "first", startedAt: new Date(2026, 8, 5, 12).getTime() });
    const before = run({ name: "before", startedAt: new Date(2026, 8, 4, 12).getTime() });
    const runs = [first, before];
    expect(inRange(runs, spanOf(30, runs, now)).map((r) => r.name)).toEqual(["first"]);
  });
});

describe("perDay", () => {
  const now = new Date(2026, 9, 4, 12);

  it("returns exactly `days` entries, oldest first, labelled day + short month", () => {
    const days = perDay([], spanOf(7, [], now));
    expect(days.length).toBe(7);
    expect(days[0].label).toBe("28 Sep");
    expect(days[6].label).toBe("4 Oct");
  });

  it("adds each run to its local day", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), outcome: "ok", inputTokens: 1000, outputTokens: 200, cachedTokens: 600 }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), outcome: "failed", inputTokens: 500, outputTokens: 100, cachedTokens: null }),
      run({ name: "c", startedAt: new Date(2026, 9, 3, 9).getTime(), outcome: "timed out", inputTokens: 300, outputTokens: 50, cachedTokens: 250 }),
      run({ name: "d", startedAt: new Date(2026, 9, 3, 10).getTime(), outcome: "stopped", inputTokens: null, outputTokens: null, cachedTokens: null }),
      run({ name: "e", startedAt: new Date(2026, 9, 1, 9).getTime(), outcome: "cut off", inputTokens: null, outputTokens: null, cachedTokens: null }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const byLabel = new Map(days.map((d) => [d.label, d]));
    expect(byLabel.get("4 Oct")).toEqual({ label: "4 Oct", ok: 1, stopped: 0, limits: 0, failed: 1, cached: 600, fresh: 900, output: 300, rebuilt: null, questions: 0, asks: 0, asked: 0, messaged: 0, both: 0, messages: null, undelivered: null, waits: [], inline: 0, said: 0 });
    expect(byLabel.get("3 Oct")).toEqual({ label: "3 Oct", ok: 0, stopped: 1, limits: 1, failed: 0, cached: 250, fresh: 50, output: 50, rebuilt: null, questions: 0, asks: 0, asked: 0, messaged: 0, both: 0, messages: null, undelivered: null, waits: [], inline: 0, said: 0 });
    expect(byLabel.get("1 Oct")).toEqual({ label: "1 Oct", ok: 0, stopped: 0, limits: 1, failed: 0, cached: 0, fresh: 0, output: 0, rebuilt: null, questions: 0, asks: 0, asked: 0, messaged: 0, both: 0, messages: null, undelivered: null, waits: [], inline: 0, said: 0 });
    expect(byLabel.get("28 Sep")).toEqual({ label: "28 Sep", ok: 0, stopped: 0, limits: 0, failed: 0, cached: 0, fresh: 0, output: 0, rebuilt: null, questions: null, asks: null, asked: 0, messaged: 0, both: 0, messages: null, undelivered: null, waits: [], inline: 0, said: 0 });
  });

  it("never lets a day's fresh figure go below zero", () => {
    const runs = [run({ name: "x", startedAt: new Date(2026, 9, 4, 9).getTime(), inputTokens: 100, outputTokens: 0, cachedTokens: 200 })];
    const days = perDay(runs, spanOf(7, runs, now));
    expect(days[6].fresh).toBe(0);
  });

  it("counts how many ran inline and how many said how they were called", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), mcpTask: false }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), mcpTask: true }),
      run({ name: "c", startedAt: new Date(2026, 9, 4, 11).getTime(), mcpTask: null }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect([day.inline, day.said]).toEqual([1, 2]);
  });

  it("a day's rebuilt prompts are the sum of its runs' rebuilt turns", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), cachedTokens: 600, rebuiltTurns: 20 }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), cachedTokens: 400, rebuiltTurns: 29 }),
      run({ name: "c", startedAt: new Date(2026, 9, 4, 11).getTime(), cachedTokens: null, rebuiltTurns: null }),
      run({ name: "d", startedAt: new Date(2026, 9, 3, 9).getTime(), cachedTokens: 250, rebuiltTurns: 5 }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const byLabel = new Map(days.map((d) => [d.label, d]));
    expect(byLabel.get("4 Oct")!.rebuilt).toBe(49);
    expect(byLabel.get("3 Oct")!.rebuilt).toBe(5);
    expect(byLabel.get("2 Oct")!.rebuilt).toBeNull();
  });

  it("a day with no run that reported cached tokens has no rebuilt figure, not 0", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), cachedTokens: null, rebuiltTurns: null })];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect(day.rebuilt).toBeNull();
  });

  it("a day whose runs rebuilt nothing shows 0", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), cachedTokens: 500, rebuiltTurns: 0 }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), cachedTokens: 300, rebuiltTurns: 0 }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect(day.rebuilt).toBe(0);
  });
});

describe("spanOf", () => {
  const now = new Date(2026, 9, 4, 12);

  it("a number range gives that many daily buckets ending today", () => {
    const span = spanOf(7, [], now);
    expect(span.weekly).toBe(false);
    expect(span.startMs).toBe(new Date(2026, 8, 28).getTime());
    expect(span.endMs).toBe(now.getTime());
    expect(span.buckets).toHaveLength(7);
    expect(span.buckets.map((b) => b.label)).toEqual(["28 Sep", "29 Sep", "30 Sep", "1 Oct", "2 Oct", "3 Oct", "4 Oct"]);
    expect(span.buckets[0]).toEqual({ label: "28 Sep", startMs: new Date(2026, 8, 28).getTime(), endMs: new Date(2026, 8, 29).getTime() });
    expect(span.buckets[6]).toEqual({ label: "4 Oct", startMs: new Date(2026, 9, 4).getTime(), endMs: new Date(2026, 9, 5).getTime() });
  });

  it("all time with a run 60 days back is daily, one bucket per day", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 7, 6, 10).getTime() })];
    const span = spanOf("all", runs, now);
    expect(span.weekly).toBe(false);
    expect(span.startMs).toBe(new Date(2026, 7, 6).getTime());
    expect(span.buckets).toHaveLength(60);
    expect(span.buckets[0].label).toBe("6 Aug");
    expect(span.buckets[0].startMs).toBe(new Date(2026, 7, 6).getTime());
    expect(span.buckets[59].label).toBe("4 Oct");
    expect(span.buckets[59].endMs).toBe(new Date(2026, 9, 5).getTime());
  });

  it("all time with a run 120 days back is weekly, 7 days a bucket", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 5, 6, 10).getTime() })];
    const span = spanOf("all", runs, now);
    expect(span.weekly).toBe(true);
    expect(span.startMs).toBe(new Date(2026, 5, 6).getTime());
    expect(span.buckets).toHaveLength(18);
    expect(span.buckets[0].label).toBe("week of 6 Jun");
    expect(span.buckets[0].startMs).toBe(new Date(2026, 5, 6).getTime());
    // Each bucket is 7 days and contiguous, except the last, cut short at the end of today.
    for (let i = 1; i < span.buckets.length; i++) {
      expect(span.buckets[i].startMs).toBe(span.buckets[i - 1].endMs);
      expect(span.buckets[i].startMs - span.buckets[i - 1].startMs).toBe(7 * DAY);
    }
    expect(span.buckets[17].label).toBe("week of 3 Oct");
    expect(span.buckets[17].endMs).toBe(new Date(2026, 9, 5).getTime());
  });

  it("all time with no runs is a single today bucket", () => {
    const span = spanOf("all", [], now);
    expect(span.weekly).toBe(false);
    expect(span.startMs).toBe(new Date(2026, 9, 4).getTime());
    expect(span.buckets).toHaveLength(1);
    expect(span.buckets[0]).toEqual({ label: "4 Oct", startMs: new Date(2026, 9, 4).getTime(), endMs: new Date(2026, 9, 5).getTime() });
  });

  it("perDay over a weekly span sums the runs of one week into one bucket", () => {
    const a = run({ name: "a", startedAt: new Date(2026, 5, 6, 10).getTime(), outcome: "ok", inputTokens: 1000, outputTokens: 200, cachedTokens: 600, rebuiltTurns: 3 });
    const b = run({ name: "b", startedAt: new Date(2026, 5, 8, 10).getTime(), outcome: "failed", inputTokens: 500, outputTokens: 100, cachedTokens: null, rebuiltTurns: null });
    const runs = [a, b];
    const span = spanOf("all", runs, now);
    expect(span.weekly).toBe(true);
    const days = perDay(runs, span);
    expect(days).toHaveLength(18);
    expect(days[0].label).toBe("week of 6 Jun");
    expect(days[0].ok).toBe(1);
    expect(days[0].failed).toBe(1);
    expect(days[0].cached).toBe(600);
    expect(days[0].fresh).toBe(900);
    expect(days[0].output).toBe(300);
    expect(days[0].rebuilt).toBe(3);
    // The next week's bucket stays empty.
    expect(days[1].ok).toBe(0);
    expect(days[1].failed).toBe(0);
    expect(days[1].rebuilt).toBeNull();
  });

  it("counts a run that starts exactly at local midnight on that day, not the one before", () => {
    const midnight = run({ name: "m", startedAt: new Date(2026, 9, 3).getTime(), outcome: "ok" });
    const days = perDay([midnight], spanOf(7, [midnight], now));
    expect(days.find((d) => d.label === "3 Oct")!.ok).toBe(1);
    expect(days.find((d) => d.label === "2 Oct")!.ok).toBe(0);
  });

  it("inRange over a 30-day span drops a run 40 days back", () => {
    const keep = run({ name: "keep", startedAt: new Date(2026, 9, 4, 8).getTime() });
    const old = run({ name: "old", startedAt: new Date(2026, 7, 25, 12).getTime() });
    const runs = [keep, old];
    const span = spanOf(30, runs, now);
    expect(inRange(runs, span).map((r) => r.name)).toEqual(["keep"]);
  });
});

describe("reasons", () => {
  it("groups the runs that did not finish by reason, most first then by reason", () => {
    expect(
      reasons([
        run({ name: "a", outcome: "stopped", reason: "stopped by the caller" }),
        run({ name: "b", outcome: "stopped", reason: "stopped by the caller" }),
        run({ name: "c", outcome: "timed out", reason: "ran past its deadline" }),
        run({ name: "d", outcome: "failed", reason: "backend unreachable" }),
        run({ name: "e", outcome: "cut off", reason: "hit the token limit" }),
        run({ name: "f", outcome: "ok", reason: null }),
      ]),
    ).toEqual([
      { reason: "stopped by the caller", outcome: "stopped", count: 2 },
      { reason: "backend unreachable", outcome: "failed", count: 1 },
      { reason: "hit the token limit", outcome: "cut off", count: 1 },
      { reason: "ran past its deadline", outcome: "timed out", count: 1 },
    ]);
  });

  it("is empty when every run finished", () => {
    expect(reasons([run({ name: "a", outcome: "ok" }), run({ name: "b", outcome: "ok" })])).toEqual([]);
  });
});

describe("groupBy", () => {
  it("gives the median time, which one slow run does not drag up", () => {
    const times = [10, 20, 900].map((s, i) => run({ name: `t${i}`, elapsedSeconds: s }));
    expect(groupBy(times, "repo")[0].medianSeconds).toBe(20);
  });

  const runs = [
    run({ name: "a", repo: "web-shop", model: "claude-code", outcome: "ok", elapsedSeconds: 120, inputTokens: 1000, outputTokens: 200, cachedTokens: 500, startedAt: new Date(2026, 9, 4, 10).getTime() }),
    run({ name: "b", repo: "web-shop", model: "claude-code", outcome: "failed", elapsedSeconds: 60, inputTokens: null, outputTokens: null, cachedTokens: null, startedAt: new Date(2026, 9, 3, 10).getTime() }),
    run({ name: "c", repo: "infra-scripts", model: "flash", outcome: "ok", elapsedSeconds: 30, inputTokens: 500, outputTokens: 100, cachedTokens: 400, startedAt: new Date(2026, 9, 2, 10).getTime() }),
    run({ name: "d", repo: null, model: "flash", outcome: "stopped", reason: "stopped by the caller", elapsedSeconds: null, inputTokens: null, outputTokens: null, cachedTokens: null, startedAt: new Date(2026, 9, 1, 10).getTime() }),
  ];

  it("groups by repo, most delegations first, and a null repo as a dash", () => {
    const groups = groupBy(runs, "repo");
    expect(groups[0].key).toBe("web-shop");
    const byKey = new Map(groups.map((g) => [g.key, g]));
    expect(byKey.get("web-shop")).toEqual({ key: "web-shop", delegations: 2, donePercent: 50, tokens: 1200, cacheReusePercent: 50, medianSeconds: 90, last: new Date(2026, 9, 4, 10).getTime() });
    expect(byKey.get("infra-scripts")).toEqual({ key: "infra-scripts", delegations: 1, donePercent: 100, tokens: 600, cacheReusePercent: 80, medianSeconds: 30, last: new Date(2026, 9, 2, 10).getTime() });
    expect(byKey.get("—")).toEqual({ key: "—", delegations: 1, donePercent: 0, tokens: null, cacheReusePercent: null, medianSeconds: null, last: new Date(2026, 9, 1, 10).getTime() });
  });

  it("groups by model the same way", () => {
    const groups = groupBy(runs, "model");
    const byKey = new Map(groups.map((g) => [g.key, g]));
    expect(byKey.get("claude-code")!.delegations).toBe(2);
    expect(byKey.get("flash")!.delegations).toBe(2);
  });
});

describe("dayMonthYear", () => {
  it("formats a local day-month-year, zero-padded", () => {
    expect(dayMonthYear(new Date(2026, 9, 4, 12).getTime())).toBe("04-Oct-2026");
    expect(dayMonthYear(new Date(2026, 0, 5, 9).getTime())).toBe("05-Jan-2026");
  });
});

describe("questions to the caller", () => {
  const now = new Date(2026, 9, 4, 12);

  it("totals questions and asks, and counts the runs that asked", () => {
    const result = totals([
      run({ name: "a", asks: 2, questions: 4 }),
      run({ name: "b", asks: 1, questions: 1 }),
      run({ name: "c", asks: 0, questions: 0 }),
      run({ name: "d", asks: null, questions: null }),
    ]);
    expect(result.asks).toBe(3);
    expect(result.questions).toBe(5);
    expect(result.asked).toBe(2);
    expect(result.askedMoreThanOnce).toBe(1);
  });

  it("leaves asks and questions null when no run reports them", () => {
    const result = totals([
      run({ name: "a", asks: null, questions: null }),
      run({ name: "b", asks: null, questions: null }),
    ]);
    expect(result.asks).toBeNull();
    expect(result.questions).toBeNull();
    expect(result.asked).toBe(0);
    expect(result.askedMoreThanOnce).toBe(0);
  });

  it("adds each run's asks and questions to its day, null when none", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), asks: 2, questions: 4 }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), asks: null, questions: null }),
      run({ name: "c", startedAt: new Date(2026, 9, 3, 9).getTime(), asks: 1, questions: 2 }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const byLabel = new Map(days.map((d) => [d.label, d]));
    expect(byLabel.get("4 Oct")!.asks).toBe(2);
    expect(byLabel.get("4 Oct")!.questions).toBe(4);
    expect(byLabel.get("3 Oct")!.asks).toBe(1);
    expect(byLabel.get("3 Oct")!.questions).toBe(2);
    expect(byLabel.get("2 Oct")!.asks).toBeNull();
    expect(byLabel.get("2 Oct")!.questions).toBeNull();
  });

  it("leaves a day null when its only runs have no figure", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), asks: null, questions: null })];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect([day.asks, day.questions]).toEqual([null, null]);
  });

  it("keeps a day's asks at a measured zero, not null", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), asks: 0, questions: 0 })];
    const days = perDay(runs, spanOf(7, runs, now));
    expect(days[6].asks).toBe(0);
    expect(days[6].questions).toBe(0);
  });

  it("lists the runs that asked more than once, newest first", () => {
    const a = run({ name: "a", asks: 3, startedAt: new Date(2026, 9, 1).getTime() });
    const b = run({ name: "b", asks: 2, startedAt: new Date(2026, 9, 3).getTime() });
    const c = run({ name: "c", asks: 1, startedAt: new Date(2026, 9, 2).getTime() });
    const d = run({ name: "d", asks: 0, startedAt: new Date(2026, 9, 4).getTime() });
    expect(askedMoreThanOnce([a, b, c, d]).map((r) => r.name)).toEqual(["b", "a"]);
  });
});

describe("caller involvement", () => {
  const now = new Date(2026, 9, 4, 12);

  it("counts the runs that asked, were messaged, or both on a day", () => {
    const runs = [
      run({ name: "asked", startedAt: new Date(2026, 9, 4, 9).getTime(), asks: 1, messages: 0 }),
      run({ name: "messaged", startedAt: new Date(2026, 9, 4, 10).getTime(), asks: 0, messages: 2 }),
      run({ name: "both", startedAt: new Date(2026, 9, 4, 11).getTime(), asks: 1, messages: 3 }),
      run({ name: "neither", startedAt: new Date(2026, 9, 4, 12).getTime(), asks: 0, messages: 0 }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect([day.asked, day.messaged, day.both]).toEqual([1, 1, 1]);
  });

  it("counts a run with messages null in none of the three, even when it asked", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), asks: 2, messages: null })];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect([day.asked, day.messaged, day.both]).toEqual([0, 0, 0]);
  });

  it("sums the day's messages and undelivered and collects its delivered waits", () => {
    const runs = [
      run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), messages: 2, undelivered: 1, messageWaits: [2, 4] }),
      run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), messages: 1, undelivered: 0, messageWaits: [3] }),
      run({ name: "c", startedAt: new Date(2026, 9, 3, 9).getTime(), messages: 1, undelivered: 0, messageWaits: [1] }),
    ];
    const days = perDay(runs, spanOf(7, runs, now));
    const byLabel = new Map(days.map((d) => [d.label, d]));
    expect([byLabel.get("4 Oct")!.messages, byLabel.get("4 Oct")!.undelivered]).toEqual([3, 1]);
    expect(byLabel.get("4 Oct")!.waits).toEqual([2, 4, 3]);
    expect([byLabel.get("3 Oct")!.messages, byLabel.get("3 Oct")!.undelivered]).toEqual([1, 0]);
    expect(byLabel.get("3 Oct")!.waits).toEqual([1]);
  });

  it("leaves a day's messages and undelivered null when its runs do not report them", () => {
    const runs = [run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), messages: null })];
    const days = perDay(runs, spanOf(7, runs, now));
    const day = days.find((d) => d.label === "4 Oct")!;
    expect([day.messages, day.undelivered, day.waits]).toEqual([null, null, []]);
  });

  it("totals the runs that were messaged and the messages they held", () => {
    const result = totals([
      run({ name: "a", messages: 0, undelivered: 0 }),
      run({ name: "b", messages: 2, undelivered: 1, messageWaits: [2] }),
      run({ name: "c", messages: null, undelivered: null }),
    ]);
    expect(result.messaged).toBe(1);
    expect(result.messages).toBe(2);
    expect(result.undelivered).toBe(1);
  });

  it("leaves totals.messages and totals.undelivered null when no run reports them", () => {
    const result = totals([run({ name: "a", messages: null, undelivered: null }), run({ name: "b", messages: null, undelivered: null })]);
    expect(result.messaged).toBe(0);
    expect(result.messages).toBeNull();
    expect(result.undelivered).toBeNull();
  });

  it("medians the middle of an even count and null for empty", () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([1, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });
});
