// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import type { ModelFigures } from "../../src/server/metrics.ts";

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
    expect(screen.getByText(`${(80.5).toLocaleString()} tokens/s over ${(10).toLocaleString()}s`)).toBeTruthy();
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
    expect(screen.getByText(`as of ${new Date(readAt).toLocaleTimeString()}`)).toBeTruthy();
  });

  it("shows the unreachable line with the last reading time", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<ModelPanel model={figures({ status: "unreachable", readAt })} />);
    expect(
      screen.getByText(`Unreachable; no figures since ${new Date(readAt).toLocaleTimeString()}`)
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
});
