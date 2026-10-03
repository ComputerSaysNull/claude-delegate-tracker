// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Sparkline } from "../../src/web/Sparkline.tsx";

interface RecordedChart {
  options: unknown;
  setDataCalls: unknown[];
  destroyed: boolean;
}

const { MockUPlot, charts } = vi.hoisted(() => {
  const charts: RecordedChart[] = [];
  class MockUPlot {
    options: unknown;
    setDataCalls: unknown[] = [];
    destroyed = false;
    constructor(opts: unknown) {
      this.options = opts;
      charts.push(this);
    }
    setData(data: unknown): void {
      this.setDataCalls.push(data);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { MockUPlot, charts };
});

vi.mock("uplot", () => ({ default: MockUPlot }));

function lineSeries(opts: unknown): { spanGaps?: boolean }[] {
  const series = (opts as { series: { spanGaps?: boolean }[] }).series;
  return series;
}

describe("Sparkline", () => {
  beforeEach(() => {
    charts.length = 0;
  });

  afterEach(cleanup);

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
