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
import type { PowerBucket } from "../../src/server/power.ts";

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
    asks: 0,
    questions: 0,
    mcpTask: null,
    ...overrides,
  };
}

// Three runs: two in the last week, one 20 days ago (inside 30 days, outside 7).
const RUNS = [
  run({ name: "r1", startedAt: NOW - DAY, asks: 2, questions: 4 }),
  run({ name: "r2", startedAt: NOW - 3 * DAY, outcome: "failed", reason: "backend unreachable", elapsedSeconds: 60, inputTokens: 500, outputTokens: 100, cachedTokens: null, asks: 1, questions: 2 }),
  run({ name: "r3", startedAt: NOW - 20 * DAY, outcome: "stopped", reason: "stopped by the caller", repo: "infra-scripts", model: "flash", elapsedSeconds: 30, inputTokens: 200, outputTokens: 50, cachedTokens: 100 }),
];

// Three runs on the current day (4 Oct 2026, a Sunday) that overlap: busy from 10:00 to 11:30
// (1.5 h), with two at once between 10:30 and 11:30.
const BUSY_RUNS = [
  run({ name: "b1", startedAt: new Date(2026, 9, 4, 10).getTime(), elapsedSeconds: 3600 }),
  run({ name: "b2", startedAt: new Date(2026, 9, 4, 10, 30).getTime(), elapsedSeconds: 3600 }),
  run({ name: "b3", startedAt: new Date(2026, 9, 4, 11).getTime(), elapsedSeconds: 1800 }),
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

interface PowerResponse {
  buckets: PowerBucket[];
  writeError: string | null;
}

function mockFetch(data: { status: RunsStatus; runs: RunRecord[] }, busy?: BusyResponse, power?: PowerResponse | "fail"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/power") {
        if (power === "fail") throw new Error("power down");
        return new Response(JSON.stringify(power ?? { buckets: [], writeError: null }), { status: 200 });
      }
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
    kvSum: 0,
    kvSeconds: 0,
    kvMax: null,
    ...overrides,
  };
}

// A power bucket at a local wall-clock time; `hour` round-trips to the same local day and hour.
function powerBucket(hour: Date, overrides: Partial<PowerBucket> = {}): PowerBucket {
  return {
    hour: hour.getTime(),
    node: "alpha",
    wh: 0,
    seconds: 0,
    maxW: null,
    ...overrides,
  };
}

// KV-cache buckets on 29-30 Sep 2026 (a Tuesday and a Wednesday, both inside the default 30-day
// range): 29 Sep peaks at 90%, 30 Sep at 70%.
function busyBuckets(): HourBucket[] {
  return [
    bucket(new Date(2026, 8, 29, 10), { kvSum: 80_000, kvSeconds: 1000, kvMax: 80 }),
    bucket(new Date(2026, 8, 29, 11), { kvSum: 90_000, kvSeconds: 1000, kvMax: 90 }),
    bucket(new Date(2026, 8, 30, 11), { kvSum: 70_000, kvSeconds: 1000, kvMax: 70 }),
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

// The card holding the "Busy and idle" figure: the heading's container.
function busyCard(): HTMLElement {
  return screen.getByRole("heading", { name: "Busy and idle" }).closest("div")!;
}

// The card holding the "KV-cache use" chart: the heading's container.
function kvCard(): HTMLElement {
  return screen.getByRole("heading", { name: "KV-cache use" }).closest(".rounded-xl")! as HTMLElement;
}

// The card holding the "GPU power" chart: the heading's container.
function powerCard(): HTMLElement {
  return screen.getByRole("heading", { name: "GPU power" }).closest(".rounded-xl")! as HTMLElement;
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

  it("shows how many ran inline under the Delegations tile", async () => {
    mockFetch(api([run({ name: "a", mcpTask: false }), run({ name: "b", mcpTask: true })]));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("2"));
    expect(tileText("Delegations")).toContain("1 ran inline");
  });

  it("shows '0 ran inline' when the runs said they were tasks and none ran inline", async () => {
    mockFetch(api([run({ name: "a", mcpTask: true }), run({ name: "b", mcpTask: true })]));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("2"));
    expect(tileText("Delegations")).toContain("0 ran inline");
  });

  it("shows no ran-inline line when every run's mcpTask is null", async () => {
    mockFetch(api([run({ name: "a", mcpTask: null }), run({ name: "b", mcpTask: null })]));
    render(<HistoryPage />);
    await waitFor(() => expect(tileText("Delegations")).toContain("2"));
    expect(tileText("Delegations")).not.toContain("ran inline");
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

  it("shows the questions card, its figures, and the asked-more-than-once list", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Questions to the caller" })).toBeTruthy());
    const card = screen.getByRole("heading", { name: "Questions to the caller" }).closest("div")!;
    expect(within(card).getByText("questions")).toBeTruthy();
    expect(within(card).getByText("ask_caller calls")).toBeTruthy();
    expect(within(card).getByText("delegations asked")).toBeTruthy();
    expect(within(card).getByText("asked more than once")).toBeTruthy();
    expect(within(card).getByText("6")).toBeTruthy(); // questions: 4 + 2 + 0
    expect(within(card).getByText("3")).toBeTruthy(); // ask_caller calls: 2 + 1 + 0
    expect(within(card).getByText("2")).toBeTruthy(); // delegations asked
    expect(within(card).getByText("1")).toBeTruthy(); // asked more than once
    const links = within(card).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/s/r1");
    expect(links[0].textContent).toContain("4 questions");
  });

  it("shows — on the questions card when no run in the range has the counts", async () => {
    mockFetch(api([run({ name: "a", asks: null, questions: null }), run({ name: "b", asks: null, questions: null })]));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Questions to the caller" })).toBeTruthy());
    const card = screen.getByRole("heading", { name: "Questions to the caller" }).closest("div")!;
    const figure = (label: string) => within(card).getByText(label).querySelector(".font-mono")!.textContent;
    expect([figure("questions"), figure("ask_caller calls")]).toEqual(["—", "—"]);
  });

  it("shows a day's questions and its ask_caller calls on hover", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Questions to the caller" })).toBeTruthy());
    const card = screen.getByRole("heading", { name: "Questions to the caller" }).closest("div")!;
    const day = within(card).getAllByRole("button").find((b) => /: [1-9]\d* questions$/.test(b.getAttribute("aria-label") ?? ""))!;
    fireEvent.mouseEnter(day);
    const tooltip = within(card).getByRole("tooltip");
    const rows = [...tooltip.querySelectorAll(".flex.items-center")].map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^questions\d+$/);
    expect(rows[1]).toMatch(/^ask_caller calls\d+$/);
    expect(tooltip.querySelector(".bg-state-asking")).not.toBeNull();
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

    it("shows 'Ran inline: n of m' in a day's hover card", async () => {
      mockFetch(api([
        run({ name: "a", startedAt: NOW - 2 * DAY, mcpTask: false }),
        run({ name: "b", startedAt: NOW - 2 * DAY, mcpTask: true }),
      ]));
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      fireEvent.mouseOver(dayColumn("2 Oct"));
      const tooltip = screen.getByRole("tooltip");
      expect(within(tooltip).getByText("Ran inline")).toBeTruthy();
      expect(within(tooltip).getByText("1 of 2")).toBeTruthy();
    });

    it("shows no Ran-inline line for a day where every run's mcpTask is null", async () => {
      mockFetch(api([run({ name: "a", startedAt: NOW - 2 * DAY, mcpTask: null })]));
      render(<HistoryPage />);
      await waitFor(() => expect(dayColumn("2 Oct")).toBeTruthy());
      fireEvent.mouseOver(dayColumn("2 Oct"));
      const tooltip = screen.getByRole("tooltip");
      expect(within(tooltip).queryByText("Ran inline")).toBeNull();
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

  it("shows the busy section's figures from the runs alone", async () => {
    mockFetch(api(BUSY_RUNS), { buckets: [], writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("of the time at least one delegation was running")).toBeTruthy());
    expect(within(busyCard()).getByText("0%")).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "busy 1.5h · idle 706.5h")).toBeTruthy();
    expect(screen.getByText(/at most 2 at once · on average 1.7 while busy/)).toBeTruthy();
    expect(screen.getByText(/Busiest: Sundays 10:00–11:00/)).toBeTruthy();
  });

  it("says there are no delegations in range for the busy sections", async () => {
    mockFetch(api([]), { buckets: [], writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getAllByText("No delegations in this range.").length).toBeGreaterThan(0));
  });

  it("labels the cluster-busy grid rows, hour ticks, and legend", async () => {
    mockFetch(api(RUNS), { buckets: [], writeError: null });
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
    expect(screen.getByText("Delegations at once, on average")).toBeTruthy();
  });

  it("shows a hover card on a cluster-busy cell", async () => {
    mockFetch(api(BUSY_RUNS), { buckets: [], writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("When the cluster is busy")).toBeTruthy());
    const card = screen.getByRole("heading", { name: "When the cluster is busy" }).closest("div")!;
    // The busiest cell is Sunday 10:00: the Sunday row's 11th cell (hour index 10).
    const sundayRow = within(card).getByText("Sun").closest("div")!;
    const cells = within(sundayRow).getAllByRole("button");
    fireEvent.mouseOver(cells[10]);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("Sunday 10:00–11:00")).toBeTruthy();
    expect(within(tooltip).getByText("on average")).toBeTruthy();
    expect(within(tooltip).getByText(/0\.3/)).toBeTruthy();
    expect(within(tooltip).getByText(/running at once/)).toBeTruthy();
  });

  it("shows the KV-cache peak note", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("peak 90% on 29 Sep")).toBeTruthy());
  });

  it("shows a hover card on a KV-cache day", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("KV-cache use")).toBeTruthy());
    const col = within(kvCard()).getByRole("button", { name: /29 Sep/ });
    fireEvent.mouseOver(col);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("29 Sep")).toBeTruthy();
    expect(within(tooltip).getByText("peak")).toBeTruthy();
    expect(within(tooltip).getByText("90%")).toBeTruthy();
    expect(within(tooltip).getByText("average")).toBeTruthy();
    expect(within(tooltip).getByText("85%")).toBeTruthy();
  });

  // jsdom cannot tell which element is under the mouse, so this checks what decides it: the
  // lines drawn after the day columns lie on top of them, and must let the mouse through.
  it("lets the mouse through the KV-cache lines to the day columns", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("KV-cache use")).toBeTruthy());
    const columns = within(kvCard()).getByRole("button", { name: /29 Sep/ }).parentElement!;
    const plot = columns.parentElement!;
    const above = [...plot.children].slice([...plot.children].indexOf(columns) + 1);
    expect(above.length).toBeGreaterThan(0);
    for (const el of above) expect(el.getAttribute("class") ?? "").toContain("pointer-events-none");
  });

  it("centres the KV y-axis labels on their lines", async () => {
    mockFetch(api(RUNS), { buckets: busyBuckets(), writeError: null });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("KV-cache use")).toBeTruthy());
    for (const label of ["100%", "50%", "0%"]) {
      expect(within(kvCard()).getByText(label).className).toContain("-translate-y-1/2");
    }
  });

  it("joins a busy write error into the status line", async () => {
    mockFetch(api(RUNS), { buckets: [], writeError: "busy disk full" });
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/Could not save: busy disk full/)).toBeTruthy());
  });

  describe("the GPU power card", () => {
    // Power on 2 Oct 2026 (a Friday): two nodes total 1250 Wh. Runs on that day give 7 500 output
    // tokens; 2 500 more on 3 Oct, a day with no power figure, must not count. So the range total is
    // 1.3 kWh and Wh per 1k tokens is 1250 ÷ 7.5 = 166.67.
    const POWER_BUCKETS = [
      powerBucket(new Date(2026, 9, 2, 10), { node: "alpha", wh: 700, seconds: 3600, maxW: 200 }),
      powerBucket(new Date(2026, 9, 2, 11), { node: "alpha", wh: 300, seconds: 1800, maxW: 220 }),
      powerBucket(new Date(2026, 9, 2, 10), { node: "beta", wh: 250, seconds: 3600, maxW: 150 }),
    ];
    const POWER_RUNS = [
      run({ name: "p1", startedAt: new Date(2026, 9, 2, 10).getTime(), outputTokens: 5000 }),
      run({ name: "p2", startedAt: new Date(2026, 9, 2, 12).getTime(), outputTokens: 2500 }),
      run({ name: "p3", startedAt: new Date(2026, 9, 3, 9).getTime(), outputTokens: 2500 }),
    ];

    it("shows the range total, Wh per 1k output tokens, and the note", async () => {
      mockFetch(api(POWER_RUNS), { buckets: [], writeError: null }, { buckets: POWER_BUCKETS, writeError: null });
      render(<HistoryPage />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "GPU power" })).toBeTruthy());
      const card = powerCard();
      expect(within(card).getByText("1.3 kWh")).toBeTruthy(); // 1250 Wh ≥ 1000
      expect(within(card).getByText("Wh per 1k output tokens")).toBeTruthy();
      expect(within(card).getByText("166.67")).toBeTruthy(); // 1250 ÷ (7500 ÷ 1000); 3 Oct has no power
      expect(within(card).getByText("GPU power only, not wall power")).toBeTruthy();
    });

    it("shows the range total in Wh below 1000", async () => {
      const buckets = [
        powerBucket(new Date(2026, 9, 2, 10), { node: "alpha", wh: 500, seconds: 3600, maxW: 200 }),
        powerBucket(new Date(2026, 9, 2, 11), { node: "beta", wh: 350, seconds: 1800, maxW: 150 }),
      ];
      mockFetch(api(POWER_RUNS), { buckets: [], writeError: null }, { buckets, writeError: null });
      render(<HistoryPage />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "GPU power" })).toBeTruthy());
      expect(within(powerCard()).getByText("850 Wh")).toBeTruthy();
    });

    it("shows a dash for the total and per-1k figure with no power buckets", async () => {
      mockFetch(api(RUNS), { buckets: [], writeError: null }, { buckets: [], writeError: null });
      render(<HistoryPage />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "GPU power" })).toBeTruthy());
      expect(within(powerCard()).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    });

    it("leaves the rest of History showing when /api/power fails", async () => {
      mockFetch(api(RUNS), { buckets: [], writeError: null }, "fail");
      render(<HistoryPage />);
      await waitFor(() => expect(tileText("Delegations")).toContain("3"));
      expect(screen.getByRole("heading", { name: "GPU power" })).toBeTruthy();
      expect(within(powerCard()).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    });

    it("joins a power write error into the status line", async () => {
      mockFetch(api(RUNS), { buckets: [], writeError: null }, { buckets: [], writeError: "power disk full" });
      render(<HistoryPage />);
      await waitFor(() => expect(screen.getByText(/Could not save: power disk full/)).toBeTruthy());
    });
  });
});
