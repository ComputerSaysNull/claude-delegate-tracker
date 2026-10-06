// @vitest-environment jsdom
// The cluster band as the design canvas draws it: the model server's four figures side by side
// with a small chart under each that has one, and the nodes side by side without charts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import { NodePanel } from "../../src/web/NodePanel.tsx";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

afterEach(cleanup);

// uPlot reads matchMedia as it loads, which jsdom lacks; draw each chart as the element it renders.
vi.mock("../../src/web/Sparkline.tsx", () => ({
  Sparkline: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  windowLabel: (s: number) => (s >= 3600 ? "last hour" : `last ${Math.round(s / 60)} minutes`),
}));

const MODEL: ModelFigures = {
  status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, decodeTokensPerSecond: 41.2,
  decodeWindowSeconds: 10, prefixHitPercent: 91.8, preemptions: null, readAt: "2026-10-04T17:42:01.000Z",
};
const SERIES = { at: [1, 2, 3], values: { running: [1, 2, 2], kvCachePercent: [5, 6, 7], decodeTokensPerSecond: [30, 40, 41] } };
const LIMITS = { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 };

function node(name: string, overrides: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name, status: "ok", cpuPercent: 12, cpuWindowSeconds: 5, cpuTempC: 52, gpuPercent: 86, gpuTempC: 74,
    readAt: null, ...overrides,
  };
}

describe("the model server card", () => {
  it("lays its four figures out side by side, each under its own label", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const grid = screen.getByRole("list", { name: "Model server figures" });
    expect(grid.className).toMatch(/\bgrid-cols-2\b/);
    expect(grid.className).toMatch(/\bmd:grid-cols-4\b/);
    const labels = within(grid).getAllByRole("listitem").map((cell) => cell.firstElementChild!.textContent);
    expect(labels).toEqual(["Decode speed", "Requests", "KV-cache use", "Prefix-cache hits"]);
  });

  it("writes each figure large in Plex Mono, with its unit beside it", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const value = screen.getByText((41.2).toLocaleString());
    expect(value.className).toMatch(/\bfont-mono\b/);
    expect(value.className).toMatch(/\btext-2xl\b/);
    expect(value.parentElement!.textContent).toContain("tok/s");
  });

  it("counts the requests running large and those waiting small", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const cell = screen.getByText("Requests").parentElement!;
    expect(cell.textContent).toContain("2running");
    expect(cell.textContent).toContain("0 waiting");
  });

  it("draws a small chart under decode speed, requests and KV-cache use, and none under prefix hits", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const charts = screen.getAllByRole("img").map((c) => c.getAttribute("aria-label"));
    expect(charts).toHaveLength(3);
    expect(charts.join(" ")).toMatch(/Decode speed/);
    expect(charts.join(" ")).not.toMatch(/Prefix/);
  });

  it("names itself in small capitals with the time of its newest reading", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const heading = screen.getByRole("heading", { name: "Model server" });
    expect(heading.className).toMatch(/\buppercase\b/);
  });
});

describe("the nodes card", () => {
  it("puts the nodes side by side", () => {
    render(<NodePanel nodes={[node("node-a"), node("node-b")]} limits={LIMITS} />);
    const nodes = screen.getByRole("list", { name: "Nodes" });
    expect(nodes.className).toMatch(/\bsm:grid-cols-2\b/);
    expect(within(nodes).getAllByRole("listitem")).toHaveLength(2);
  });

  it("draws no charts for the nodes, only donuts and temperatures", () => {
    render(<NodePanel nodes={[node("node-a")]} limits={LIMITS} />);
    expect(screen.queryByRole("img", { name: /over the/ })).toBeNull();
    expect(screen.getAllByRole("img", { name: /use \d+ percent/ })).toHaveLength(2);
  });

  it("labels each temperature CPU temp or GPU temp under its number", () => {
    render(<NodePanel nodes={[node("node-a")]} limits={LIMITS} />);
    expect(screen.getByLabelText("node-a GPU temperature").parentElement!.textContent).toMatch(/GPU temp$/);
  });
});
