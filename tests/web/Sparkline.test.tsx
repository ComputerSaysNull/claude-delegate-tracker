// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Sparkline } from "../../src/web/Sparkline.tsx";

interface RecordedChart {
  options: unknown;
  setDataCalls: unknown[];
  setSizeCalls: { width: number; height: number }[];
  destroyed: boolean;
}

const { MockUPlot, charts } = vi.hoisted(() => {
  const charts: RecordedChart[] = [];
  class MockUPlot {
    options: unknown;
    setDataCalls: unknown[] = [];
    setSizeCalls: { width: number; height: number }[] = [];
    destroyed = false;
    constructor(opts: unknown) {
      this.options = opts;
      charts.push(this);
    }
    setData(data: unknown): void {
      this.setDataCalls.push(data);
    }
    setSize(size: { width: number; height: number }): void {
      this.setSizeCalls.push(size);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { MockUPlot, charts };
});

vi.mock("uplot", () => ({ default: MockUPlot }));

// jsdom has no ResizeObserver: record each one so a test can report a new width.
const observers: { cb: ResizeObserverCallback; disconnected: boolean }[] = [];
class FakeResizeObserver {
  entry: { cb: ResizeObserverCallback; disconnected: boolean };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, disconnected: false };
    observers.push(this.entry);
  }
  observe(): void {}
  disconnect(): void {
    this.entry.disconnected = true;
  }
}

function resizeTo(width: number): void {
  for (const o of observers.filter((o) => !o.disconnected)) {
    o.cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
  }
}

function lineSeries(opts: unknown): { spanGaps?: boolean }[] {
  const series = (opts as { series: { spanGaps?: boolean }[] }).series;
  return series;
}

describe("Sparkline", () => {
  beforeEach(() => {
    charts.length = 0;
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("draws no axes: uPlot fills an empty list with its default x and y axes", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    const axes = (charts[0].options as { axes: { show?: boolean }[] }).axes;
    expect(axes).toHaveLength(2);
    expect(axes.every((a) => a.show === false)).toBe(true);
  });

  it("redraws at the container's width when it changes", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    resizeTo(321);
    expect(charts[0].setSizeCalls).toEqual([{ width: 321, height: 32 }]);
  });

  it("keeps its size while hidden, when the container reports no width", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    resizeTo(0);
    expect(charts[0].setSizeCalls).toEqual([]);
  });

  it("stops watching the width once it is gone", async () => {
    const { unmount } = render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    expect(observers.length).toBeGreaterThan(0);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("renders an accessible div, labelled by its aria-label", () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="Decode speed over the last hour" />);
    expect(screen.getByRole("img", { name: "Decode speed over the last hour" })).toBeTruthy();
  });

  it("creates a uPlot with spanGaps false on the series", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    expect(lineSeries(charts[0].options).some((s) => s.spanGaps === false)).toBe(true);
  });

  it("creates no chart for fewer than two points, but still renders the div", async () => {
    render(<Sparkline data={[[0], [10]]} label="x" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(charts.length).toBe(0);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("updates via setData when the data changes", async () => {
    const { rerender } = render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    rerender(<Sparkline data={[[0, 1, 2], [10, 20, 30]]} label="x" />);
    expect(charts[0].setDataCalls).toEqual([[[0, 1, 2], [10, 20, 30]]]);
  });

  it("destroys the chart on unmount", async () => {
    const { unmount } = render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    expect(charts[0].destroyed).toBe(false);
    unmount();
    expect(charts[0].destroyed).toBe(true);
  });
});
