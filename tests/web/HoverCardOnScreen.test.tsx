// @vitest-environment jsdom
// Proves that every hover card (the ChartTooltip) the History page opens stays inside a phone
// screen for the first and last column/cell of each of the four charts. jsdom does no layout, so
// the box sizes a browser would measure are stubbed to phone values instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HistoryPage } from "../../src/web/HistoryPage.tsx";
import type { RunsStatus, RunRecord } from "../../src/server/runs.ts";
import type { HourBucket } from "../../src/server/busy.ts";
import type { PowerBucket } from "../../src/server/power.ts";

const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const CHECKED_AT = Date.parse("2026-10-04T12:00:00.000Z");

// A phone screen and the chart card (and tooltip) that must fit inside it.
const SCREEN = 360;
const BOX_LEFT = 16;
const BOX_WIDTH = 328;
const CARD = 176;
const MARGIN = 8;

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
    ...overrides,
  };
}

// Runs on eight consecutive days, so each day chart's first and last columns are far apart.
const RUNS = [
  run({ name: "d1", startedAt: NOW - 1 * DAY }),
  run({ name: "d2", startedAt: NOW - 2 * DAY }),
  run({ name: "d3", startedAt: NOW - 3 * DAY }),
  run({ name: "d4", startedAt: NOW - 4 * DAY }),
  run({ name: "d5", startedAt: NOW - 5 * DAY }),
  run({ name: "d6", startedAt: NOW - 6 * DAY }),
  run({ name: "d7", startedAt: NOW - 7 * DAY }),
  run({ name: "d8", startedAt: NOW - 8 * DAY }),
];

interface BusyResponse {
  buckets: HourBucket[];
  writeError: string | null;
}

interface PowerResponse {
  buckets: PowerBucket[];
  writeError: string | null;
}

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

function mockFetch(data: { status: RunsStatus; runs: RunRecord[] }, busy?: BusyResponse, power?: PowerResponse): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/power") {
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

// KV-cache buckets on seven consecutive days inside the 30-day range, so the KV chart shows data
// across its first and last columns.
const BUSY_BUCKETS: HourBucket[] = [
  bucket(new Date(2026, 8, 28, 10), { kvSum: 90_000, kvSeconds: 1000, kvMax: 90 }),
  bucket(new Date(2026, 8, 29, 10), { kvSum: 80_000, kvSeconds: 1000, kvMax: 80 }),
  bucket(new Date(2026, 8, 30, 11), { kvSum: 70_000, kvSeconds: 1000, kvMax: 70 }),
  bucket(new Date(2026, 9, 1, 10), { kvSum: 60_000, kvSeconds: 1000, kvMax: 60 }),
  bucket(new Date(2026, 9, 2, 11), { kvSum: 50_000, kvSeconds: 1000, kvMax: 50 }),
  bucket(new Date(2026, 9, 3, 10), { kvSum: 40_000, kvSeconds: 1000, kvMax: 40 }),
  bucket(new Date(2026, 9, 4, 9), { kvSum: 30_000, kvSeconds: 1000, kvMax: 30 }),
];

// Power buckets on seven consecutive days, again so the first and last columns differ.
const POWER_BUCKETS: PowerBucket[] = [
  powerBucket(new Date(2026, 8, 28, 10), { wh: 600, seconds: 3600, maxW: 210 }),
  powerBucket(new Date(2026, 8, 29, 10), { wh: 550, seconds: 3600, maxW: 200 }),
  powerBucket(new Date(2026, 8, 30, 10), { wh: 500, seconds: 3600, maxW: 195 }),
  powerBucket(new Date(2026, 9, 1, 10), { wh: 450, seconds: 3600, maxW: 190 }),
  powerBucket(new Date(2026, 9, 2, 10), { wh: 700, seconds: 3600, maxW: 200 }),
  powerBucket(new Date(2026, 9, 3, 10), { wh: 500, seconds: 3600, maxW: 190 }),
  powerBucket(new Date(2026, 9, 4, 10), { wh: 400, seconds: 3600, maxW: 180 }),
];

// Where the hover card sits on screen, from the tooltip wrapper's inline positioning. Reads the
// wrapper's `left` and `transform` so it works for the current clamped layout and a fixed one.
function screenLeft(tooltip: HTMLElement): number {
  const wrapper = tooltip.parentElement as HTMLElement;
  const left = wrapper.style.left;
  const px = left.endsWith("%") ? (parseFloat(left) / 100) * BOX_WIDTH : parseFloat(left || "0");
  const shift = wrapper.style.transform.includes("translateX(-50%)") ? CARD / 2 : 0;
  return BOX_LEFT + px - shift;
}

function expectInside(tooltip: HTMLElement): void {
  expect(screenLeft(tooltip)).toBeGreaterThanOrEqual(MARGIN);
  expect(screenLeft(tooltip) + CARD).toBeLessThanOrEqual(SCREEN - MARGIN);
}

let originalOffsetWidth: PropertyDescriptor | undefined;
let originalClientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: BOX_LEFT,
    right: BOX_LEFT + BOX_WIDTH,
    width: BOX_WIDTH,
    top: 0,
    bottom: 130,
    height: 130,
    x: BOX_LEFT,
    y: 0,
    toJSON() {},
  });
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => CARD });
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => SCREEN });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalOffsetWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  }
  if (originalClientWidth !== undefined) {
    Object.defineProperty(document.documentElement, "clientWidth", originalClientWidth);
  } else {
    delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  }
  originalOffsetWidth = undefined;
  originalClientWidth = undefined;
  vi.useRealTimers();
});

describe("HistoryPage hover cards on a phone screen", () => {
  it("the delegations-per-day hover card stays inside the screen at the first and last day", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    const heading = await screen.findByRole("heading", { name: "Delegations per day" });
    const card = heading.closest("div")!;
    const columns = within(card).getAllByRole("button");
    expect(columns.length).toBeGreaterThanOrEqual(7);
    const first = columns[0];
    const last = columns[columns.length - 1];

    fireEvent.mouseEnter(first);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(first);

    fireEvent.mouseEnter(last);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(last);
  });

  it("the KV-cache hover card stays inside the screen at the first and last day", async () => {
    mockFetch(api(RUNS), { buckets: BUSY_BUCKETS, writeError: null });
    render(<HistoryPage />);
    const heading = await screen.findByRole("heading", { name: "KV-cache use" });
    const card = heading.closest<HTMLElement>(".rounded-xl")!;
    const columns = within(card).getAllByRole("button");
    expect(columns.length).toBeGreaterThanOrEqual(7);
    const first = columns[0];
    const last = columns[columns.length - 1];

    fireEvent.mouseEnter(first);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(first);

    fireEvent.mouseEnter(last);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(last);
  });

  it("the GPU power hover card stays inside the screen at the first and last day", async () => {
    mockFetch(api(RUNS), { buckets: [], writeError: null }, { buckets: POWER_BUCKETS, writeError: null });
    render(<HistoryPage />);
    const heading = await screen.findByRole("heading", { name: "GPU power" });
    const card = heading.closest<HTMLElement>(".rounded-xl")!;
    const columns = within(card).getAllByRole("button");
    expect(columns.length).toBeGreaterThanOrEqual(7);
    const first = columns[0];
    const last = columns[columns.length - 1];

    fireEvent.mouseEnter(first);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(first);

    fireEvent.mouseEnter(last);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(last);
  });

  // On a wide screen History sits in a column that scrolls on its own, and a scrolling element
  // clips what it holds inside its scrollbar: the window's edge is not the edge that matters.
  it("the questions hover card on the last day stays clear of the scrolling column's scrollbar", async () => {
    const SCROLLBAR = 15;
    mockFetch(api(RUNS));
    render(
      <div data-testid="column" style={{ overflowX: "auto", overflowY: "auto" }}>
        <HistoryPage />
      </div>,
    );
    const column = screen.getByTestId("column");
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      const box = this === column ? { left: 0, width: SCREEN } : { left: BOX_LEFT, width: BOX_WIDTH };
      return { ...box, right: box.left + box.width, top: 0, bottom: 130, height: 130, x: box.left, y: 0, toJSON() {} };
    });
    Object.defineProperty(column, "clientWidth", { configurable: true, get: () => SCREEN - SCROLLBAR });
    const heading = await screen.findByRole("heading", { name: "Questions to the caller" });
    const card = heading.closest<HTMLElement>("div")!;
    const columns = within(card).getAllByRole("button");
    const last = columns[columns.length - 1];

    fireEvent.mouseEnter(last);
    const tooltip = within(card).getByRole("tooltip");
    expect(screenLeft(tooltip) + CARD).toBeLessThanOrEqual(SCREEN - SCROLLBAR - MARGIN);
    expect(screenLeft(tooltip)).toBeGreaterThanOrEqual(MARGIN);
  });

  it("the cluster-busy hover card stays inside the screen at the first and last hour", async () => {
    mockFetch(api(RUNS));
    render(<HistoryPage />);
    const heading = await screen.findByRole("heading", { name: "When the cluster is busy" });
    const card = heading.closest("div")!;
    const cells = within(card).getAllByRole("button");
    expect(cells).toHaveLength(7 * 24);
    const first = cells[0];
    const last = cells[cells.length - 1];

    fireEvent.mouseEnter(first);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(first);

    fireEvent.mouseEnter(last);
    expectInside(within(card).getByRole("tooltip"));
    fireEvent.mouseLeave(last);
  });
});
