// @vitest-environment jsdom
// The cluster band: a 15 min / 1 h switch for its charts, and on a phone one tappable line
// that opens the figures in full. The model panel also counts the prompts rebuilt today, which
// App reads from the runs API since the viewer's local midnight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const NOW = 10_000_000;
const SERIES = { at: [NOW - 3_000_000, NOW - 600_000, NOW], values: { decodeTokensPerSecond: [10, 20, 30], cpuPercent: [1, 2, 3] } };

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: null,
    connected: true,
    decode: { tokensPerSecond: 77.7, windowSeconds: 1, prefillTokensPerSecond: null },
    health: { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: true } },
    cluster: {
      model: { status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, kvKeptPercent: null, decodeTokensPerSecond: 41.2, decodeWindowSeconds: 10, prefixHitPercent: 91.8, preemptions: null, mtpAcceptancePercent: null, mtpAcceptanceSinceStartPercent: null, prefillTokensPerSecond: null, readAt: null },
      nodes: [
        { name: "node-a", status: "ok", cpuPercent: 12, cpuWindowSeconds: 5, cpuTempC: 52, gpuPercent: 86, gpuTempC: 74, memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null, diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null, linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null, linkTxBps: null, linkDropsRising: null, readAt: null },
        { name: "node-b", status: "ok", cpuPercent: 9, cpuWindowSeconds: 5, cpuTempC: 49, gpuPercent: 64, gpuTempC: 66, memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null, diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null, linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null, linkTxBps: null, linkDropsRising: null, readAt: null },
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

// A run as the runs API returns it: App only reads rebuiltTurns (and the start time) from these.
function run(name: string, rebuiltTurns: number | null) {
  return {
    name,
    size: 1,
    startedAt: NOW,
    outcome: "ok",
    reason: null,
    repo: null,
    repoFromPaths: false,
    model: null,
    mcpTask: null,
    elapsedSeconds: 60,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    rebuiltTurns,
    asks: null,
    questions: null,
    messages: null,
    undelivered: null,
    messageWaits: null,
  };
}

// Answer the runs API with these records, and anything else the page asks for with an empty body.
function stubRuns(runs: ReturnType<typeof run>[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/runs")) {
      return new Response(
        JSON.stringify({
          status: { records: runs.length, checkedAt: NOW, checked: runs.length, disagreed: 0, missing: 0, writeError: null },
          runs,
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const { default: App } = await import("../../src/web/App.tsx");

describe("the cluster band", () => {
  beforeEach(() => {
    drawn.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.history.replaceState(null, "", "/");
    // No runs today unless a test says otherwise.
    stubRuns([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const lastPoints = (label: RegExp) => drawn.filter((d) => label.test(d.label)).at(-1)!.points;
  const figures = () => screen.getByRole("list", { name: "Model server figures" });

  it("shows the live decode speed from the update stream, not the slower poll's", () => {
    render(<App />);
    const list = figures();
    expect(list.textContent).toContain("77.7");
    expect(list.textContent).not.toMatch(/over/);
    expect(list.textContent).not.toContain("41.2");
  });

  it("charts the last hour by default, and the last 15 minutes when asked", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "1 hour" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastPoints(/^Decode speed/)).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "15 min" }));
    expect(screen.getByRole("button", { name: "15 min" }).getAttribute("aria-pressed")).toBe("true");
    expect(lastPoints(/^Decode speed/)).toBe(2);
  });

  it("names the range it charts", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "15 min" }));
    expect(drawn.at(-1)!.label).toMatch(/last 15 minutes/);
  });

  it("on a phone folds the band into one line that links to the cluster section", () => {
    render(<App />);
    const line = screen.getByRole("link", { name: /41\.2 tok\/s/ });
    expect(line.className).toMatch(/\blg:hidden\b/);
    expect(line.textContent).toContain("2 running");
    expect(line.textContent).toContain("KV 7.4%");
    expect(line.textContent).toContain("74°C");
    expect(line.getAttribute("href")).toBe("/cluster");
    const band = screen.getByRole("region", { name: "Cluster" });
    expect(band.className).toMatch(/(^|\s)hidden\b/);
    expect(band.className).toMatch(/\blg:flex\b/);
    fireEvent.click(line);
    expect(window.location.pathname).toBe("/cluster");
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

  it("the model panel shows today's rebuilt prompts from the runs started since local midnight", async () => {
    stubRuns([run("a", 2), run("b", 1)]);
    render(<App />);
    const list = figures();
    await waitFor(() => expect(list.textContent).toContain("3 prompts rebuilt today"));
  });

  it("App asks for the runs since the viewer's local midnight", async () => {
    const fetchMock = stubRuns([]);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requested = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/runs"));
    expect(requested).toBeDefined();
    const url = new URL(requested!, "http://localhost");
    expect(url.pathname).toBe("/api/runs");
    const since = new Date(url.searchParams.get("since") ?? "");
    expect(Number.isNaN(since.getTime())).toBe(false);
    expect(since.getHours()).toBe(0);
    expect(since.getMinutes()).toBe(0);
    expect(since.getSeconds()).toBe(0);
    const today = new Date();
    expect([since.getFullYear(), since.getMonth(), since.getDate()]).toEqual([
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ]);
  });

  it("runs that report no cached tokens give no rebuilt line", async () => {
    const fetchMock = stubRuns([run("a", null), run("b", null)]);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let the answer land before asking what the panel shows.
    await act(async () => {});
    expect(figures().textContent).not.toContain("rebuilt today");
  });

  // Before the first delegation of the day finishes there are no runs: that is a measured 0,
  // not an unknown, so the line shows 0 rather than disappearing at midnight.
  it("no runs yet today shows 0 prompts rebuilt today", async () => {
    const fetchMock = stubRuns([]);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(figures().textContent).toContain("0 prompts rebuilt today"));
  });
});
