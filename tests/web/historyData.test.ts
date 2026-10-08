// The History tab's figures: the pure helpers the page turns the run records into. All the
// dates are local, so a fixed `now` and local-time constructors keep these green in any zone.
import { describe, expect, it } from "vitest";
import { dayMonthYear, groupBy, inRange, perDay, reasons, totals } from "../../src/web/historyData.ts";
import type { RunRecord } from "../../src/server/runs.ts";

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
    ...overrides,
  };
}

describe("inRange", () => {
  const now = new Date(2026, 9, 4, 12);

  it("keeps the runs on the last `days` local days, today included", () => {
    const today = run({ name: "today", startedAt: new Date(2026, 9, 4, 8).getTime() });
    const first = run({ name: "first", startedAt: new Date(2026, 8, 28, 12).getTime() });
    const before = run({ name: "before", startedAt: new Date(2026, 8, 27, 12).getTime() });
    expect(inRange([today, first, before], 7, now).map((r) => r.name)).toEqual(["today", "first"]);
  });

  it("leaves out a run with no startedAt", () => {
    expect(inRange([run({ name: "nostart", startedAt: null })], 7, now)).toEqual([]);
  });

  it("counts days-1 back from today for a 30-day range", () => {
    const first = run({ name: "first", startedAt: new Date(2026, 8, 5, 12).getTime() });
    const before = run({ name: "before", startedAt: new Date(2026, 8, 4, 12).getTime() });
    expect(inRange([first, before], 30, now).map((r) => r.name)).toEqual(["first"]);
  });
});

describe("totals", () => {
  it("leaves cache reuse null rather than dividing by no input", () => {
    const zero = [run({ inputTokens: 0, cachedTokens: 0 })];
    expect(totals(zero).cacheReusePercent).toBeNull();
    expect(groupBy(zero, "repo")[0].cacheReusePercent).toBeNull();
  });

  it("is neutral with no runs", () => {
    expect(totals([])).toEqual({
      delegations: 0,
      donePercent: null,
      stopped: 0,
      limits: 0,
      failed: 0,
      tokens: null,
      cacheReusePercent: null,
    });
  });

  it("sums the outcomes and the tokens the runs report", () => {
    const result = totals([
      run({ name: "a", outcome: "ok", inputTokens: 1000, outputTokens: 200, cachedTokens: 500 }),
      run({ name: "b", outcome: "stopped", reason: "stopped by the caller", inputTokens: null, outputTokens: null, cachedTokens: null }),
      run({ name: "c", outcome: "timed out", reason: "ran past its deadline", inputTokens: 1000, outputTokens: 50, cachedTokens: 800 }),
      run({ name: "d", outcome: "cut off", reason: "hit the token limit", inputTokens: null, outputTokens: null, cachedTokens: null }),
      run({ name: "e", outcome: "failed", reason: "backend unreachable", inputTokens: null, outputTokens: null, cachedTokens: null }),
    ]);
    expect(result.delegations).toBe(5);
    expect(result.donePercent).toBe(20);
    expect(result.stopped).toBe(1);
    expect(result.limits).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.tokens).toBe(2250);
    expect(result.cacheReusePercent).toBe(65);
  });

  it("leaves tokens and cache reuse null when no run reports them", () => {
    const result = totals([
      run({ name: "a", outcome: "ok", inputTokens: null, outputTokens: null, cachedTokens: null }),
      run({ name: "b", outcome: "failed", inputTokens: null, outputTokens: null, cachedTokens: null }),
    ]);
    expect(result.tokens).toBeNull();
    expect(result.cacheReusePercent).toBeNull();
    expect(result.donePercent).toBe(50);
  });

  it("counts a run that reports only input in the token total", () => {
    expect(totals([run({ name: "a", inputTokens: 1000, outputTokens: null, cachedTokens: null })]).tokens).toBe(1000);
  });
});

describe("perDay", () => {
  const now = new Date(2026, 9, 4, 12);

  it("returns exactly `days` entries, oldest first, labelled day + short month", () => {
    const days = perDay([], 7, now);
    expect(days.length).toBe(7);
    expect(days[0].label).toBe("28 Sep");
    expect(days[6].label).toBe("4 Oct");
  });

  it("adds each run to its local day", () => {
    const days = perDay(
      [
        run({ name: "a", startedAt: new Date(2026, 9, 4, 9).getTime(), outcome: "ok", inputTokens: 1000, outputTokens: 200, cachedTokens: 600 }),
        run({ name: "b", startedAt: new Date(2026, 9, 4, 10).getTime(), outcome: "failed", inputTokens: 500, outputTokens: 100, cachedTokens: null }),
        run({ name: "c", startedAt: new Date(2026, 9, 3, 9).getTime(), outcome: "timed out", inputTokens: 300, outputTokens: 50, cachedTokens: 250 }),
        run({ name: "d", startedAt: new Date(2026, 9, 3, 10).getTime(), outcome: "stopped", inputTokens: null, outputTokens: null, cachedTokens: null }),
        run({ name: "e", startedAt: new Date(2026, 9, 1, 9).getTime(), outcome: "cut off", inputTokens: null, outputTokens: null, cachedTokens: null }),
      ],
      7,
      now,
    );
    const byLabel = new Map(days.map((d) => [d.label, d]));
    expect(byLabel.get("4 Oct")).toEqual({ label: "4 Oct", ok: 1, stopped: 0, limits: 0, failed: 1, cached: 600, fresh: 900, output: 300 });
    expect(byLabel.get("3 Oct")).toEqual({ label: "3 Oct", ok: 0, stopped: 1, limits: 1, failed: 0, cached: 250, fresh: 50, output: 50 });
    expect(byLabel.get("1 Oct")).toEqual({ label: "1 Oct", ok: 0, stopped: 0, limits: 1, failed: 0, cached: 0, fresh: 0, output: 0 });
    expect(byLabel.get("28 Sep")).toEqual({ label: "28 Sep", ok: 0, stopped: 0, limits: 0, failed: 0, cached: 0, fresh: 0, output: 0 });
  });

  it("never lets a day's fresh figure go below zero", () => {
    const days = perDay([run({ name: "x", startedAt: new Date(2026, 9, 4, 9).getTime(), inputTokens: 100, outputTokens: 0, cachedTokens: 200 })], 7, now);
    expect(days[6].fresh).toBe(0);
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
