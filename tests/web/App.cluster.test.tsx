// @vitest-environment jsdom
// The cluster band: a 15 min / 1 h switch for its charts, and on a phone one tappable line
// that opens the figures in full.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const NOW = 10_000_000;
const SERIES = { at: [NOW - 3_000_000, NOW - 600_000, NOW], values: { decodeTokensPerSecond: [10, 20, 30], cpuPercent: [1, 2, 3] } };

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: null,
    connected: true,
    health: { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: true } },
    cluster: {
      model: { status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, decodeTokensPerSecond: 41.2, decodeWindowSeconds: 10, prefixHitPercent: 91.8, preemptions: null, readAt: null },
      nodes: [
        { name: "node-a", status: "ok", cpuPercent: 12, cpuWindowSeconds: 5, cpuTempC: 52, gpuPercent: 86, gpuTempC: 74, readAt: null },
        { name: "node-b", status: "ok", cpuPercent: 9, cpuWindowSeconds: 5, cpuTempC: 49, gpuPercent: 64, gpuTempC: 66, readAt: null },
      ],
      limits: { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 },
    },
  }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({
  useClusterHistory: () => ({ windowSeconds: 3600, model: SERIES, nodes: [{ name: "node-a", series: SERIES }, { name: "node-b", series: SERIES }] }),
}));
// Record what each chart is handed, instead of drawing it.
const drawn: { label: string; points: number }[] = [];
vi.mock("../../src/web/Sparkline.tsx", () => ({
  Sparkline: ({ data, label }: { data: [number[], unknown[]]; label: string }) => {
    drawn.push({ label, points: data[0].length });
    return <div role="img" aria-label={label} />;
  },
  windowLabel: (s: number) => (s >= 3600 ? "last hour" : `last ${Math.round(s / 60)} minutes`),
}));

const { default: App } = await import("../../src/web/App.tsx");

describe("the cluster band", () => {
  beforeEach(() => {
    drawn.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const lastPoints = (label: RegExp) => drawn.filter((d) => label.test(d.label)).at(-1)!.points;

  it("charts the last hour by default, and the last 15 minutes when asked", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "1 hour" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastPoints(/^Decode speed/)).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "15 min" }));
    expect(screen.getByRole("button", { name: "15 min" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastPoints(/^Decode speed/)).toBe(2);
    expect(lastPoints(/^CPU use/)).toBe(2);
  });

  it("names the range it charts", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "15 min" }));
    expect(drawn.at(-1)!.label).toMatch(/last 15 minutes/);
  });

  it("on a phone folds the band into one line that opens it in full", () => {
    render(<App />);
    const line = screen.getByRole("button", { name: /41\.2 tok\/s/ });
    expect(line.className).toMatch(/\blg:hidden\b/);
    expect(line.textContent).toContain("2 running");
    expect(line.textContent).toContain("KV 7.4%");
    expect(line.textContent).toContain("74°C");
    const band = screen.getByRole("region", { name: "Cluster" });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(band.className).toMatch(/(^|\s)hidden\b/);
    expect(band.className).toMatch(/\blg:flex\b/);
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(band.className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("hands the thresholds it was sent to the node figures", () => {
    render(<App />);
    expect(screen.getByLabelText("node-a GPU temperature").className).toMatch(/\btext-warn\b/);
    expect(screen.getByRole("img", { name: "GPU use 86 percent" }).querySelector("[data-ring]")!.getAttribute("class")).toMatch(/\btext-hot\b/);
  });

  it("colours the hottest temperature on that line by heat", () => {
    render(<App />);
    const hottest = screen.getByLabelText("Hottest temperature");
    expect(hottest.textContent).toBe("74°C");
    expect(hottest.className).toMatch(/\btext-warn\b/);
  });
});
