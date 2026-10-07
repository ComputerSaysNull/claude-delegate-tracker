// @vitest-environment jsdom
// The History tab: the range switch, the five tiles, the two day charts' legends, the
// "why runs did not finish" list, the by-repo and by-model tables and the status line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoryPage } from "../../src/web/HistoryPage.tsx";
import { dayMonthYear } from "../../src/web/historyData.ts";
import { localTime } from "../../src/web/time.ts";
import type { RunsStatus, RunRecord } from "../../src/server/runs.ts";

const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const CHECKED_AT = Date.parse("2026-10-04T12:00:00.000Z");

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    name: "s.jsonl",
    size: 100,
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

function mockFetch(data: { status: RunsStatus; runs: RunRecord[] }): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
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
});
