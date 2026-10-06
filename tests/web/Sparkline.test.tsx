// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Sparkline, sparkRange } from "../../src/web/Sparkline.tsx";

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

// The y range a sparkline's uPlot is given: a zero-only series is lifted off the canvas's
// bottom edge, a non-negative one is padded by 10% on each side, a fixed range is widened by
// 5% of its span, and a range crossing zero is padded by 10% of its own span.
describe("y range", () => {
  it("pads a zero-only range up to a positive floor", () => {
    expect(sparkRange(0, 0)).toEqual([-0.1, 1.1]);
  });

  it("pads a non-negative range by 10% on each side", () => {
    const [lo, hi] = sparkRange(0, 45);
    expect(lo).toBeCloseTo(-4.5);
    expect(hi).toBeCloseTo(49.5);
  });

  it("pads a null range to the positive floor", () => {
    expect(sparkRange(null, null)).toEqual([-0.1, 1.1]);
  });

  it("widens a fixed range by 5% of its span on both sides", () => {
    expect(sparkRange(3, 7, [0, 100])).toEqual([-5, 105]);
  });

  it("pads a range that crosses zero by 10% of its span", () => {
    expect(sparkRange(-2, 8)).toEqual([-3, 9]);
  });
});

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

  it("passes a y range function that pads a zero-only series", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" />);
    await waitFor(() => expect(charts.length).toBe(1));
    const range = (charts[0].options as { scales: { y: { range: (u: unknown, min: number, max: number) => [number, number] } } }).scales.y.range;
    expect(range(null, 0, 0)).toEqual([-0.1, 1.1]);
  });

  it("uses a fixed y range when one is given", async () => {
    render(<Sparkline data={[[0, 1], [10, 20]]} label="x" fixed={[0, 100]} />);
    await waitFor(() => expect(charts.length).toBe(1));
    const range = (charts[0].options as { scales: { y: { range: (u: unknown, min: number, max: number) => [number, number] } } }).scales.y.range;
    expect(range(null, 0, 0)).toEqual([-5, 105]);
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
