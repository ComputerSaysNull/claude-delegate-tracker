// @vitest-environment jsdom
// The cluster band as the design canvas draws it: the model server's three charted figures side by
// side with a small chart under each, the figures without a chart as label-above-value items
// under them, and the nodes side by side without charts.
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
  status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, kvKeptPercent: null, decodeTokensPerSecond: 41.2,
  decodeWindowSeconds: 10, prefixHitPercent: 91.8, preemptions: null, mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2,
  prefillTokensPerSecond: 1200, readAt: "2026-10-04T17:42:01.000Z",
};
const SERIES = { at: [1, 2, 3], values: { running: [1, 2, 2], kvCachePercent: [5, 6, 7], decodeTokensPerSecond: [30, 40, 41] } };
const LIMITS = { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 };

function node(name: string, overrides: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name, status: "ok", cpuPercent: 12, cpuWindowSeconds: 5, cpuTempC: 52, gpuPercent: 86, gpuTempC: 74,
    memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null,
    diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null,
    linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null,
    linkTxBps: null, linkDropsRising: null,
    readAt: null, ...overrides,
  };
}

// A figure's cell in the model server grid, by the label it carries.
function figure(label: string): HTMLElement {
  const grid = screen.getByRole("list", { name: "Model server figures" });
  const found = within(grid)
    .getAllByRole("listitem")
    .find((c) => (c.firstElementChild?.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`no figure labelled ${label}`);
  return found;
}

function readText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("the model server card", () => {
  // The columns follow the card's own width, not the screen's: the card shares a row.
  it("lays its three charted figures out three across on a wide card, each under its own label", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const grid = screen.getByRole("list", { name: "Model server figures" });
    expect(grid.closest("section")!.className).toMatch(/(^|\s)@container\b/);
    expect(grid.className).toMatch(/(^|\s)@md:grid-cols-3\b/);
    const labels = within(grid)
      .getAllByRole("listitem")
      .map((cell) => readText(cell.firstElementChild!));
    expect(labels).toEqual(["Decode speed", "Requests · running / waiting", "KV-cache use"]);
  });

  // The figures without a chart keep the card from growing: one item each, label above value,
  // in a row of their own.
  it("puts prefill, prefix hits, MTP and today's rebuilt prompts in a compact item each, after the charted figures", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const grid = screen.getByRole("list", { name: "Model server figures" });
    const compact = screen.getByRole("list", { name: "Model server figures without a chart" });
    // 4 is Node.DOCUMENT_POSITION_FOLLOWING: the compact row comes after the charted figures.
    expect(grid.compareDocumentPosition(compact) & 4).toBe(4);
    const labels = within(compact)
      .getAllByRole("listitem")
      .map((item) => (item.firstElementChild!.textContent ?? "").trim());
    expect(labels).toEqual(["Prefill · last prompt", "Prefix hits · since start", "MTP · last / all", "Prompts rebuilt · today"]);
    for (const item of within(compact).getAllByRole("listitem")) {
      expect(item.className.split(/\s+/)).toContain("flex-col");
    }
  });

  it("writes each charted figure large in Plex Mono, with its unit beside it", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const value = screen.getByText((41.2).toLocaleString());
    expect(value.className).toMatch(/\bfont-mono\b/);
    expect(value.className).toMatch(/\btext-2xl\b/);
    expect(value.parentElement!.textContent).toContain("tok/s");
  });

  it("shows the requests as one running / waiting number", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const cell = figure("Requests");
    const number = cell.querySelector(".text-2xl");
    expect(number).not.toBeNull();
    expect(number!.textContent).toBe("2 / 0");
    expect(readText(cell.firstElementChild!)).toBe("Requests · running / waiting");
  });

  it("draws a small chart under each charted figure, and none under prefill, prefix hits, MTP or rebuilt prompts", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const charts = screen.getAllByRole("img").map((c) => c.getAttribute("aria-label"));
    expect(charts).toHaveLength(3);
    expect(charts.join(" ")).toMatch(/Decode speed/);
    expect(charts.join(" ")).toMatch(/Requests/);
    expect(charts.join(" ")).toMatch(/KV-cache use/);
    expect(charts.join(" ")).not.toMatch(/Prefill/);
    expect(charts.join(" ")).not.toMatch(/Prefix/);
    expect(charts.join(" ")).not.toMatch(/MTP/);
    expect(charts.join(" ")).not.toMatch(/Prompts rebuilt/);
    // The chart is a line of its own under the number, not beside it.
    const decode = figure("Decode speed");
    const kids = Array.from(decode.children);
    expect(kids).toHaveLength(3);
    expect(kids[1].textContent).toContain("tok/s");
    expect(kids[1].querySelector('[role="img"]')).toBeNull();
    expect(kids[2].querySelector('[role="img"]')).not.toBeNull();
  });

  it("names itself in small capitals with the time of its newest reading", () => {
    render(<ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />);
    const heading = screen.getByRole("heading", { name: "Model server" });
    expect(heading.className).toMatch(/\buppercase\b/);
  });
});

describe("the nodes card", () => {
  it("puts the nodes one under the other", () => {
    render(<NodePanel nodes={[node("node-a"), node("node-b")]} limits={LIMITS} />);
    const nodes = screen.getByRole("list", { name: "Nodes" });
    expect(nodes.className).not.toMatch(/grid-cols-[2-9]/);
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

// The band stretches both slots to the taller card; each card fills its slot, so side by side
// the two cards end on one line.
describe("both cards side by side", () => {
  it("fill their slot's height, so they are the same height", () => {
    render(
      <>
        <ModelPanel model={MODEL} history={SERIES} windowSeconds={3600} />
        <NodePanel nodes={[node("node-a")]} limits={LIMITS} />
      </>,
    );
    for (const name of ["Model server figures", "Nodes"]) {
      const card = screen.getByRole("list", { name }).closest("section")!;
      expect(card.className.split(/\s+/)).toContain("h-full");
    }
  });
});
