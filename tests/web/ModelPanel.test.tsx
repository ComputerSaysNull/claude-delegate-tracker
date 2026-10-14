// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import { localTime } from "../../src/web/time.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { Series } from "../../src/server/history.ts";

// The chart itself is Sparkline's to test; here only the range each chart is given matters.
vi.mock("../../src/web/Sparkline.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/Sparkline.tsx")>()),
  Sparkline: ({ label, fixed, dots }: { label: string; fixed?: [number, number]; dots?: boolean }) => (
    <div
      role="img"
      aria-label={label}
      data-fixed={fixed === undefined ? "" : fixed.join(",")}
      data-dots={dots === undefined ? "" : String(dots)}
    />
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
    mtpAcceptancePercent: null,
    mtpAcceptanceSinceStartPercent: null,
    prefillTokensPerSecond: null,
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

  it("shows decode speed without a line naming its window", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} />);
    const decodeCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Decode speed")!;
    expect(decodeCell.textContent).toContain((80.5).toLocaleString());
    expect(decodeCell.textContent).toContain("tok/s");
    expect(decodeCell.textContent).not.toMatch(/over/);
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
        prefillTokensPerSecond: [0, 0],
      },
    };
    render(<ModelPanel model={figures()} history={history} windowSeconds={3600} />);
    expect(screen.getByRole("img", { name: /^KV-cache use over/ }).getAttribute("data-fixed")).toBe("0,100");
    expect(screen.getByRole("img", { name: /^Decode speed over/ }).getAttribute("data-fixed")).toBe("");
    expect(screen.getByRole("img", { name: /^Prefill speed over/ }).getAttribute("data-fixed")).toBe("");
    expect(screen.getByRole("img", { name: /^Requests over/ }).getAttribute("data-fixed")).toBe("");
  });

  // The chart sits beside its number rather than under it, so a figure takes one line.
  it("puts each chart on the same line as its number", () => {
    const history: Series = {
      at: [0, 1000],
      values: { running: [0, 0], waiting: [0, 0], kvCachePercent: [0, 0], decodeTokensPerSecond: [0, 0], prefillTokensPerSecond: [0, 0] },
    };
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 80.5, prefillTokensPerSecond: 120.5, running: 3, kvCachePercent: 7.4 })}
        history={history}
        windowSeconds={3600}
      />,
    );
    const cases: [RegExp, string][] = [
      [/^Decode speed over/, (80.5).toLocaleString()],
      [/^Prefill speed over/, (120.5).toLocaleString()],
      [/^Requests over/, (3).toLocaleString()],
      [/^KV-cache use over/, `${(7.4).toLocaleString()}%`],
    ];
    for (const [name, value] of cases) {
      const line = screen.getByRole("img", { name }).parentElement!.parentElement!;
      const classes = line.className.split(/\s+/);
      expect(classes).toContain("flex");
      expect(classes).not.toContain("flex-col");
      expect(within(line).getByText(value)).toBeTruthy();
    }
  });

  it("shows Prefill speed right after Decode speed, with its tok/s unit", () => {
    render(<ModelPanel model={figures({ prefillTokensPerSecond: 120.5 })} />);
    const cells = screen.getAllByRole("listitem");
    const prefillCell = cells.find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    expect(prefillCell.textContent).toContain((120.5).toLocaleString());
    expect(prefillCell.textContent).toContain("tok/s");
    const labels = cells.map((cell) => cell.firstElementChild!.textContent);
    expect(labels).toEqual([
      "Decode speed", "Prefill speed · last prompt", "Requests", "KV-cache use", "Prefix-cache hits", "MTP acceptance",
    ]);
  });

  it("shows MTP acceptance as a percent with its caption", () => {
    render(<ModelPanel model={figures({ mtpAcceptancePercent: 47.5 })} />);
    const mtpCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "MTP acceptance")!;
    expect(mtpCell.textContent).toContain(`${(47.5).toLocaleString()}%`);
    expect(mtpCell.textContent).toContain("now");
  });

  it("shows the MTP acceptance now figure then the since-start figure", () => {
    render(<ModelPanel model={figures({ mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 47 })} />);
    const mtpCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "MTP acceptance")!;
    const text = mtpCell.textContent!;
    const nowPct = `${(52).toLocaleString()}%`;
    const sincePct = `${(47).toLocaleString()}%`;
    expect(text).toContain(nowPct);
    expect(text).toContain("now");
    expect(text).toContain(sincePct);
    expect(text).toContain("since start");
    expect(text.indexOf(nowPct)).toBeLessThan(text.indexOf("now"));
    expect(text.indexOf("now")).toBeLessThan(text.indexOf(sincePct));
    expect(text.indexOf(sincePct)).toBeLessThan(text.indexOf("since start"));
  });

  it("shows a dash for the MTP now figure before the since-start figure when it is null", () => {
    render(<ModelPanel model={figures({ mtpAcceptanceSinceStartPercent: 47 })} />);
    const mtpCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "MTP acceptance")!;
    const text = mtpCell.textContent!;
    const sincePct = `${(47).toLocaleString()}%`;
    expect(text).toContain("—");
    expect(text).toContain("now");
    expect(text).toContain(sincePct);
    expect(text).toContain("since start");
    expect(text.indexOf("—")).toBeLessThan(text.indexOf("now"));
  });

  it("shows a dash for the MTP since-start figure after the now figure when it is null", () => {
    render(<ModelPanel model={figures({ mtpAcceptancePercent: 52 })} />);
    const mtpCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "MTP acceptance")!;
    const text = mtpCell.textContent!;
    const nowPct = `${(52).toLocaleString()}%`;
    expect(text).toContain(nowPct);
    expect(text).toContain("—");
    expect(text).toContain("since start");
    expect(text.indexOf("now")).toBeLessThan(text.indexOf("—"));
    expect(text.indexOf("—")).toBeLessThan(text.indexOf("since start"));
  });

  it("shows a dash for Prefill speed and MTP acceptance when null", () => {
    render(<ModelPanel model={figures()} />);
    const cells = screen.getAllByRole("listitem");
    const prefillCell = cells.find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    expect(prefillCell.textContent).toContain("—");
    const mtpCell = cells.find((c) => c.firstElementChild!.textContent === "MTP acceptance")!;
    expect(mtpCell.textContent).toContain("—");
  });

  it("shows the live prefill speed from the decode event, with last prompt in its title", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: null })}
        decode={{ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: 1453.3 }}
      />,
    );
    const prefillCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    // "last prompt" sits in the title, so only the unit stands beside the number and the chart
    // keeps the same width as Decode speed's.
    expect(prefillCell.textContent).toBe(`Prefill speed · last prompt${(1453.3).toLocaleString()}tok/s`);
  });

  it("shows the model's own prefill figure when no decode event has arrived", () => {
    render(<ModelPanel model={figures({ prefillTokensPerSecond: 1200 })} />);
    const prefillCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    expect(prefillCell.textContent).toContain((1200).toLocaleString());
  });

  it("shows the model's own prefill figure when the model status is not ok, even with a decode event", () => {
    render(
      <ModelPanel
        model={figures({ status: "unreachable", readAt: "2026-10-03T12:00:00.000Z", prefillTokensPerSecond: 1200 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: 1453.3 }}
      />,
    );
    const prefillCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    expect(prefillCell.textContent).toContain((1200).toLocaleString());
    expect(prefillCell.textContent).not.toContain((1453.3).toLocaleString());
  });

  it("shows a dash for prefill when both the model and the live decode have none", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: null })}
        decode={{ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    const prefillCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Prefill speed · last prompt")!;
    expect(prefillCell.textContent).toContain("—");
  });

  it("passes dots only to the Prefill speed chart", () => {
    const history: Series = {
      at: [0, 1000],
      values: {
        running: [0, 0],
        waiting: [0, 0],
        kvCachePercent: [0, 0],
        decodeTokensPerSecond: [0, 0],
        prefillTokensPerSecond: [0, 0],
      },
    };
    render(<ModelPanel model={figures()} history={history} windowSeconds={3600} />);
    expect(screen.getByRole("img", { name: /^Prefill speed over/ }).getAttribute("data-dots")).toBe("true");
    expect(screen.getByRole("img", { name: /^Decode speed over/ }).getAttribute("data-dots")).toBe("");
    expect(screen.getByRole("img", { name: /^Requests over/ }).getAttribute("data-dots")).toBe("");
    expect(screen.getByRole("img", { name: /^KV-cache use over/ }).getAttribute("data-dots")).toBe("");
  });

  it("shows the live decode value once a decode event has arrived, over the model's own", () => {
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    const decodeCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Decode speed")!;
    expect(decodeCell.textContent).toContain((61.4).toLocaleString());
    expect(decodeCell.textContent).toContain("tok/s");
    expect(decodeCell.textContent).not.toContain((80.5).toLocaleString());
  });

  it("shows the model's own decode figure when no decode event has arrived", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} decode={null} />);
    const decodeCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Decode speed")!;
    expect(decodeCell.textContent).toContain((80.5).toLocaleString());
  });

  it("shows the model's own decode figure when the model status is not ok, even with a decode event", () => {
    render(
      <ModelPanel
        model={figures({ status: "unreachable", readAt: "2026-10-03T12:00:00.000Z", decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    const decodeCell = screen.getAllByRole("listitem").find((c) => c.firstElementChild!.textContent === "Decode speed")!;
    expect(decodeCell.textContent).toContain((80.5).toLocaleString());
    expect(decodeCell.textContent).not.toContain((61.4).toLocaleString());
  });
});
