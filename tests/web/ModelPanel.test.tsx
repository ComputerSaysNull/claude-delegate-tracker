// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import { localTime } from "../../src/web/time.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { Series } from "../../src/server/history.ts";

// The chart itself is Sparkline's to test; here only the range each chart is given matters.
vi.mock("../../src/web/Sparkline.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/Sparkline.tsx")>()),
  Sparkline: ({ label, fixed }: { label: string; fixed?: [number, number] }) => (
    <div role="img" aria-label={label} data-fixed={fixed === undefined ? "" : fixed.join(",")} />
  ),
}));

function figures(overrides: Partial<ModelFigures> = {}): ModelFigures {
  return {
    status: "ok",
    running: null,
    waiting: null,
    kvCachePercent: null,
    decodeTokensPerSecond: null,
    decodeWindowSeconds: null,
    prefixHitPercent: null,
    preemptions: null,
    readAt: null,
    ...overrides,
  };
}

describe("ModelPanel", () => {
  afterEach(cleanup);

  it("shows a dash for every null figure, and never 0 or null", () => {
    render(<ModelPanel model={figures()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("shows 0 for a zero figure", () => {
    render(<ModelPanel model={figures({ running: 0, waiting: 0 })} />);
    expect(screen.getAllByText("0").length).toBe(2);
  });

  it("carries a percent sign on KV-cache and prefix figures", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 7.4, prefixHitPercent: 92 })} />);
    expect(screen.getByText(`${(7.4).toLocaleString()}%`)).toBeTruthy();
    expect(screen.getByText(`${(92).toLocaleString()}%`)).toBeTruthy();
  });

  it("names the window on the decode line", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} />);
    expect(screen.getByText(`${(80.5).toLocaleString()}`)).toBeTruthy();
    expect(screen.getByText("tok/s")).toBeTruthy();
    expect(screen.getByText(`over ${(10).toLocaleString()}s`)).toBeTruthy();
  });

  it("omits the preemptions row when it is null and shows it when set", () => {
    const { rerender } = render(<ModelPanel model={figures({ preemptions: null })} />);
    expect(screen.queryByText(/Preemptions/)).toBeNull();
    rerender(<ModelPanel model={figures({ preemptions: 3 })} />);
    expect(screen.getByText(/Preemptions/)).toBeTruthy();
    expect(screen.getByText((3).toLocaleString())).toBeTruthy();
  });

  it("shows an as-of line when the status is ok", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<ModelPanel model={figures({ status: "ok", readAt })} />);
    expect(screen.getByText(`as of ${localTime(readAt)}`)).toBeTruthy();
  });

  it("shows the unreachable line with the last reading time", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<ModelPanel model={figures({ status: "unreachable", readAt })} />);
    expect(
      screen.getByText(`Unreachable; no figures since ${localTime(readAt)}`)
    ).toBeTruthy();
  });

  it("shows the unreachable line without a reading time", () => {
    render(<ModelPanel model={figures({ status: "unreachable", readAt: null })} />);
    expect(screen.getByText("Unreachable; no figures yet")).toBeTruthy();
  });

  it("shows the not-available line", () => {
    render(<ModelPanel model={figures({ status: "not available" })} />);
    expect(screen.getByText("/metrics is not available (404)")).toBeTruthy();
  });

  it("shows the not-configured line", () => {
    render(<ModelPanel model={figures({ status: "not configured" })} />);
    expect(screen.getByText("METRICS_URL is not set")).toBeTruthy();
  });

  it("shows the waiting line for a null model", () => {
    render(<ModelPanel model={null} />);
    expect(screen.getByText("Waiting for figures…")).toBeTruthy();
  });

  it("gives the KV-cache sparkline a fixed 0-100 y range, and the others none", () => {
    const history: Series = {
      at: [0, 1000],
      values: {
        running: [0, 0],
        waiting: [0, 0],
        kvCachePercent: [0, 0],
        decodeTokensPerSecond: [0, 0],
      },
    };
    render(<ModelPanel model={figures()} history={history} windowSeconds={3600} />);
    expect(screen.getByRole("img", { name: /^KV-cache use over/ }).getAttribute("data-fixed")).toBe("0,100");
    expect(screen.getByRole("img", { name: /^Decode speed over/ }).getAttribute("data-fixed")).toBe("");
    expect(screen.getByRole("img", { name: /^Requests over/ }).getAttribute("data-fixed")).toBe("");
  });

  // The figures above the charts differ in height (decode speed has its window line), so each
  // chart is pushed to the bottom of its column, and the charts line up.
  it("pushes every chart to the bottom of its column, so the charts line up", () => {
    const history: Series = {
      at: [0, 1000],
      values: { running: [0, 0], waiting: [0, 0], kvCachePercent: [0, 0], decodeTokensPerSecond: [0, 0] },
    };
    render(<ModelPanel model={figures({ decodeWindowSeconds: 10 })} history={history} windowSeconds={3600} />);
    for (const name of [/^Decode speed over/, /^Requests over/, /^KV-cache use over/]) {
      const holder = screen.getByRole("img", { name }).parentElement!;
      expect(holder.className.split(/\s+/)).toContain("mt-auto");
    }
  });
});
