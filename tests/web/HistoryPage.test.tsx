// @vitest-environment jsdom
// The History tab: the range switch, the five tiles, the two day charts' legends, the
// "why runs did not finish" list, the by-repo and by-model tables and the status line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HistoryPage } from "../../src/web/HistoryPage.tsx";
import { dayMonthYear } from "../../src/web/historyData.ts";
import { localTime } from "../../src/web/time.ts";
import type { RunsStatus, RunRecord } from "../../src/server/runs.ts";
import type { HourBucket } from "../../src/server/busy.ts";

const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const CHECKED_AT = Date.parse("2026-10-04T12:00:00.000Z");

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    name: "s.jsonl",
    size: 100,
    repoFromPaths: false,
    startedAt: NOW - DAY,
    outcome: "ok",
    reason: null,
    repo: "web-shop",
    model: "claude-code",
    elapsedSeconds: 120,
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 500,
    ...overrides,
  };
}

// Three runs: two in the last week, one 20 days ago (inside 30 days, outside 7).
const RUNS = [
  run({ name: "r1", startedAt: NOW - DAY }),
  run({ name: "r2", startedAt: NOW - 3 * DAY, outcome: "failed", reason: "backend unreachable", elapsedSeconds: 60, inputTokens: 500, outputTokens: 100, cachedTokens: null }),
  run({ name: "r3", startedAt: NOW - 20 * DAY, outcome: "stopped", reason: "stopped by the caller", repo: "infra-scripts", model: "flash", elapsedSeconds: 30, inputTokens: 200, outputTokens: 50, cachedTokens: 100 }),
];

function api(runs: RunRecord[], status: Partial<RunsStatus> = {}): { status: RunsStatus; runs: RunRecord[] } {
  return {
    status: {
      records: runs.length,
      checkedAt: CHECKED_AT,
      checked: runs.length,
      disagreed: 0,
      missing: 0,
      writeError: null,
      ...status,
    },
    runs,
  };
}

interface BusyResponse {
  buckets: HourBucket[];
  writeError: string | null;
}

function mockFetch(data: { status: RunsStatus; runs: RunRecord[] }, busy?: BusyResponse): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/busy") {
        return new Response(JSON.stringify(busy ?? { buckets: [], writeError: null }), { status: 200 });
      }
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
}

// A bucket at a local wall-clock time; `hour` round-trips to the same local day and hour.
function bucket(hour: Date, overrides: Partial<HourBucket> = {}): HourBucket {
  return {
    hour: hour.getTime(),
    seconds: 3600,
    busySeconds: 1800,
    kvSum: 0,
    kvSeconds: 0,
    kvMax: null,
    ...overrides,
  };
}

// Buckets on 29-30 Sep 2026 (a Tuesday and a Wednesday, both inside the default 30-day range):
// 10800 s total, 7200 s busy, and Tuesday 10:00-11:00 the busiest cell.
function busyBuckets(): HourBucket[] {
  return [
    bucket(new Date(2026, 8, 29, 10), { seconds: 3600, busySeconds: 3600, kvSum: 3000, kvSeconds: 1000, kvMax: 80 }),
    bucket(new Date(2026, 8, 29, 11), { seconds: 3600, busySeconds: 1800, kvSum: 2000, kvSeconds: 1000, kvMax: 90 }),
    bucket(new Date(2026, 8, 30, 11), { seconds: 3600, busySeconds: 1800, kvSum: 1500, kvSeconds: 1000, kvMax: 70 }),
  ];
}

// The card holding the "Delegations per day" chart: the heading's container.
function delegationsCard(): HTMLElement {
  return screen.getByRole("heading", { name: "Delegations per day" }).closest("div")!;
}

// The hit target of a day column in the delegations chart, found by its aria-label.
function dayColumn(label: string): HTMLElement {
  return within(delegationsCard()).getByRole("button", { name: new RegExp(label) });
}

// The legend swatch beside the given label.
function legendSwatch(label: string): HTMLElement {
  return screen.getByText(label).querySelector("span")!;
}

// The tile label's container, read back whole ("Delegations3"), excluding the table column
// headers that share a label ("Done", "Cache reuse", "Delegations").
function tileText(label: string): string {
  const el = screen.getAllByText(label).find((n) => n.tagName !== "TH");
  return el?.parentElement?.textContent ?? "";
}

describe("HistoryPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the five tiles with their figures for the default 30-day range", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("3"));
    expect(tileText("Done")).toContain("33%");
    expect(tileText("Did not finish")).toContain("2");
    expect(tileText("Did not finish")).toContain("1 stopped · 0 limits · 1 failed");
    expect(tileText("Tokens processed")).toContain("2k");
    expect(tileText("Cache reuse")).toContain("50%");
  });

  it("defaults to 30 days and switching the range changes the tiles", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("3"));
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    const seven = screen.getByRole("button", { name: "7 days" });
    expect(seven.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(seven);
    expect(seven.getAttribute("aria-pressed")).toBe("true");
    expect(tileText("Delegations")).toContain("2");
    expect(tileText("Done")).toContain("50%");
  });

  it("shows a dash for a null figure", async () => {
    mockFetch(api([]));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("0"));
    expect(tileText("Done")).toContain("—");
    expect(tileText("Tokens processed")).toContain("—");
    expect(tileText("Cache reuse")).toContain("—");
  });

  it("names the chart legends", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getAllByText("done").length).toBeGreaterThan(0));
    expect(screen.getAllByText("stopped").length).toBeGreaterThan(0);
    expect(screen.getAllByText("timed out or cut off").length).toBeGreaterThan(0);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("input, from cache").length).toBeGreaterThan(0);
    expect(screen.getAllByText("input, new").length).toBeGreaterThan(0);
    expect(screen.getAllByText("output").length).toBeGreaterThan(0);
  });

  it("says every run finished when there is nothing to explain", async () => {
    mockFetch(api([run({ name: "a" }), run({ name: "b", outcome: "ok" })]));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("Every run finished.")).toBeTruthy());
  });

  it("lists the by-repo and by-model table headers and a row", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("By repo")).toBeTruthy());
    expect(screen.getByText("By model")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent!.trim());
    for (const name of ["Repo", "Model", "Delegations", "Done", "Tokens", "Cache reuse", "Median time", "Last"]) {
      expect(headers).toContain(name);
    }
    const repoRow = screen.getByText("web-shop").closest("tr")!;
    expect(repoRow.textContent).toContain("2");
    expect(repoRow.textContent).toContain("50%");
    expect(repoRow.textContent).toContain("1.8k");
    expect(repoRow.textContent).toContain("1m30s");
    expect(repoRow.textContent).toContain(dayMonthYear(NOW - DAY));
    const modelRow = screen.getByText("claude-code").closest("tr")!;
    expect(modelRow.textContent).toContain("2");
    expect(modelRow.textContent).toContain("50%");
  });

  it("shows the not-yet-checked status line before the first check", async () => {
    mockFetch(api(RUNS, { checkedAt: null }));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/not yet checked against the folder/)).toBeTruthy());
    expect(screen.getByText(/3 runs kept/)).toBeTruthy();
  });

  it("shows the checked status line with disagreements and missing runs", async () => {
    mockFetch(api(RUNS, { disagreed: 1, missing: 2 }));
    render(<HistoryPage />);
    const clock = localTime(new Date(CHECKED_AT).toISOString());
    await waitFor(() => expect(screen.getByText(new RegExp(`checked against the folder at ${clock}`))).toBeTruthy());
    expect(screen.getByText(/1 disagreed/)).toBeTruthy();
    expect(screen.getByText(/2 no longer in the folder/)).toBeTruthy();
  });

  it("reports a write error in the status line", async () => {
    mockFetch(api(RUNS, { writeError: "disk full" }));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/Could not save: disk full/)).toBeTruthy());
  });

  describe("the day charts", () => {
    it("uses the chart colour tokens for the delegations legend swatches", async () => {
      mockFetch(api(RUNS));
      render(<HistoryPage />);
      await waitFor(() => expect(screen.getByText("done")).toBeTruthy());
      expect(legendSwatch("done").className).toMatch(/\bbg-chart-done\b/);
      expect(legendSwatch("stopped").className).toMatch(/\bbg-chart-stopped\b/);
      expect(legendSwatch("timed out or cut off").className).toMatch(/\bbg-chart-limits\b/);
      expect(legendSwatch("failed").className).toMatch(/\bbg-chart-failed\b/);
    });

    it("draws no stopped segment for a day with none stopped", async () => {
      mockFetch(
        api([
          run({ name: "a", startedAt: NOW - 2 * DAY, outcome: "ok" }),
          run({ name: "b", startedAt: NOW - 2 * DAY, outcome: "failed", reason: "boom" }),
        ]),
      );
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      const column = dayColumn("2 Oct");
      expect(column.querySelector(".bg-chart-stopped")).toBeNull();
      expect(column.querySelector(".bg-chart-limits")).toBeNull();
      expect(column.querySelector(".bg-chart-done")).not.toBeNull();
      expect(column.querySelector(".bg-chart-failed")).not.toBeNull();
    });

    it("shows the day's tooltip on hover and hides it on leave", async () => {
      mockFetch(
        api([
          run({ name: "a", startedAt: NOW - 2 * DAY, outcome: "ok" }),
          run({ name: "b", startedAt: NOW - 2 * DAY, outcome: "stopped", reason: "r" }),
          run({ name: "c", startedAt: NOW - 2 * DAY, outcome: "timed out", reason: "t" }),
          run({ name: "d", startedAt: NOW - 2 * DAY, outcome: "failed", reason: "f" }),
        ]),
      );
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      const column = dayColumn("2 Oct");
      expect(screen.queryByRole("tooltip")).toBeNull();

      fireEvent.mouseOver(column);
      const tooltip = screen.getByRole("tooltip");
      expect(within(tooltip).getByText("2 Oct")).toBeTruthy();
      expect(within(tooltip).getByText("done")).toBeTruthy();
      expect(within(tooltip).getByText("stopped")).toBeTruthy();
      expect(within(tooltip).getByText("timed out or cut off")).toBeTruthy();
      expect(within(tooltip).getByText("failed")).toBeTruthy();
      expect(within(tooltip).getAllByText("1")).toHaveLength(4);
      expect(within(tooltip).getByText("Delegations")).toBeTruthy();
      expect(within(tooltip).getByText("4")).toBeTruthy();

      fireEvent.mouseOut(column);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows the day's tooltip on keyboard focus and hides it on blur", async () => {
      mockFetch(api([run({ name: "a", startedAt: NOW - 2 * DAY, outcome: "ok" })]));
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      const column = dayColumn("2 Oct");
      expect(screen.queryByRole("tooltip")).toBeNull();

      fireEvent.focus(column);
      expect(screen.getByRole("tooltip")).toBeTruthy();

      fireEvent.blur(column);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("leaves no title attribute on a day column", async () => {
      mockFetch(api(RUNS));
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      for (const column of within(delegationsCard()).getAllByRole("button")) {
        expect(column.getAttribute("title")).toBeNull();
      }
    });
  });

  it("adds the KV-cache, busy, and cluster-busy sections with the KV legend", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("KV-cache use")).toBeTruthy());
    expect(screen.getByText("Busy and idle")).toBeTruthy();
    expect(screen.getByText("When the cluster is busy")).toBeTruthy();
    expect(screen.getByText("90%: amber from here")).toBeTruthy();
  });

  it("shows the busy percent, the running-time caption, and the busy/idle hours", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("Busy and idle")).toBeTruthy());
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("of the time a request was running")).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "busy 2h · idle 1h")).toBeTruthy();
    expect(screen.getByText(/Busiest: Tuesdays 10:00–11:00/)).toBeTruthy();
  });

  it("shows the no-figures message when no buckets are in range", async () => {
    mockFetch(api(RUNS), { buckets: [], writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getAllByText("No figures from the model server in this range.").length).toBeGreaterThan(0));
  });

  it("labels the cluster-busy grid rows, hour ticks, and legend", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("When the cluster is busy")).toBeTruthy());
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
    for (const tick of ["00:00", "06:00", "12:00", "18:00"]) {
      expect(screen.getAllByText(tick).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("quiet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("busy").length).toBeGreaterThan(0);
  });

  it("joins a busy write error into the status line", async () => {
    mockFetch(api(RUNS), { buckets: [], writeError: "busy disk full" });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/Could not save: busy disk full/)).toBeTruthy());
  });
});
