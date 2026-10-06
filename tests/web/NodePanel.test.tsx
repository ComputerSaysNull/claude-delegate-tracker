// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NodePanel } from "../../src/web/NodePanel.tsx";
import { localTime } from "../../src/web/time.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

function figures(overrides: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name: "node-1",
    status: "ok",
    cpuPercent: null,
    cpuWindowSeconds: null,
    cpuTempC: null,
    gpuPercent: null,
    gpuTempC: null,
    readAt: null,
    ...overrides,
  };
}

const LIMITS = { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 };

describe("NodePanel", () => {
  afterEach(cleanup);

  it("shows a dash for every null figure, and never 0 or null", () => {
    render(<NodePanel nodes={[figures()]} />);
    // CPU use, CPU temperature, GPU use and GPU temperature: four figures, four dashes.
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText(/^0/)).toBeNull();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("shows 0 with its unit for a zero figure", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 0, gpuPercent: 0 })]} />);
    expect(screen.getAllByText("0%").length).toBe(2);
  });

  it("carries a percent sign on CPU and GPU use", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 61.5, gpuPercent: 7 })]} />);
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText("7%")).toBeTruthy();
  });

  it("carries °C on both temperatures", () => {
    render(<NodePanel nodes={[figures({ cpuTempC: 51.5, gpuTempC: 57 })]} />);
    expect(screen.getByText("52°C")).toBeTruthy();
    expect(screen.getByText("57°C")).toBeTruthy();
  });

  // Like the donuts: the figure large and bold on top, its caption small below it.
  it("puts each temperature above its caption, large and bold", () => {
    render(<NodePanel nodes={[figures({ name: "n1", cpuTempC: 52, gpuTempC: 74 })]} />);
    for (const [caption, text] of [["CPU", "52°C"], ["GPU", "74°C"]]) {
      const value = screen.getByLabelText(`n1 ${caption} temperature`);
      expect(value.textContent).toBe(text);
      expect(value.className.split(/\s+/)).toEqual(expect.arrayContaining(["text-2xl", "font-semibold"]));
      expect(value.nextElementSibling?.textContent).toBe(`${caption} temp`);
    }
  });

  // The GPU does the model's work, so its figures lead: use and heat, then the CPU's.
  it("orders a node's figures GPU use, GPU temp, CPU use, CPU temp", () => {
    render(<NodePanel nodes={[figures({ name: "n1", cpuPercent: 12, gpuPercent: 86, cpuTempC: 52, gpuTempC: 74 })]} />);
    const order = [
      screen.getByRole("img", { name: "GPU use 86 percent" }),
      screen.getByLabelText("n1 GPU temperature"),
      screen.getByRole("img", { name: "CPU use 12 percent" }),
      screen.getByLabelText("n1 CPU temperature"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("names the window on the CPU use line", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 61.5, cpuWindowSeconds: 5 })]} />);
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText(`over ${(5).toLocaleString()}s`)).toBeTruthy();
  });

  it("shows an as-of line when the status is ok", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<NodePanel nodes={[figures({ status: "ok", readAt })]} />);
    expect(screen.getByText(`as of ${localTime(readAt)}`)).toBeTruthy();
  });

  it("shows the unreachable line with the last reading time", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<NodePanel nodes={[figures({ status: "unreachable", readAt })]} />);
    expect(
      screen.getByText(`Unreachable; no figures since ${localTime(readAt)}`)
    ).toBeTruthy();
  });

  it("shows the unreachable line without a reading time", () => {
    render(<NodePanel nodes={[figures({ status: "unreachable", readAt: null })]} />);
    expect(screen.getByText("Unreachable; no figures yet")).toBeTruthy();
  });

  it("shows the host-key-refused line", () => {
    render(<NodePanel nodes={[figures({ status: "host key refused" })]} />);
    expect(screen.getByText("Host key does not match the pinned key; figures refused")).toBeTruthy();
  });

  it("shows each node's own name and figures", () => {
    render(
      <NodePanel
        nodes={[figures({ name: "alpha", cpuPercent: 10 }), figures({ name: "beta", gpuPercent: 20 })]}
      />
    );
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText(`${(10).toLocaleString()}%`)).toBeTruthy();
    expect(screen.getByText(`${(20).toLocaleString()}%`)).toBeTruthy();
  });

  it("rounds CPU and GPU use to whole percents in the donut and its label", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 14.5, gpuPercent: 86.5 })]} limits={LIMITS} />);
    expect(screen.getByRole("img", { name: "CPU use 15 percent" }).textContent).toContain("15%");
    expect(screen.getByRole("img", { name: "GPU use 87 percent" }).textContent).toContain("87%");
  });

  it("rounds temperatures to whole degrees with no space before °C", () => {
    render(<NodePanel nodes={[figures({ cpuTempC: 77.2, gpuTempC: 44.5 })]} />);
    expect(screen.getByText("77°C")).toBeTruthy();
    expect(screen.getByText("45°C")).toBeTruthy();
  });

  it("tints the donut's track with the fill's level colour", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 14.5 })]} limits={LIMITS} />);
    const donut = screen.getByRole("img", { name: "CPU use 15 percent" });
    const circles = donut.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    const [track, ring] = circles;
    expect(track.getAttribute("class")).toMatch(/\btext-state-ok\b/);
    expect(track.getAttribute("class")).toMatch(/\bopacity-25\b/);
    expect(ring.getAttribute("class")).toMatch(/\btext-state-ok\b/);
  });

  it("shows one as-of line for the whole panel, from the newest healthy read", () => {
    render(
      <NodePanel
        nodes={[
          figures({ name: "alpha", status: "ok", readAt: "2024-01-15T12:00:00.000Z" }),
          figures({ name: "beta", status: "ok", readAt: "2024-01-15T13:00:00.000Z" }),
        ]}
      />
    );
    expect(screen.getAllByText(/as of/).length).toBe(1);
    expect(screen.getByText(`as of ${localTime("2024-01-15T13:00:00.000Z")}`)).toBeTruthy();
  });

  it("keeps a failing node's own status line beside the panel's as-of line", () => {
    render(
      <NodePanel
        nodes={[
          figures({ name: "alpha", status: "ok", readAt: "2024-01-15T13:00:00.000Z" }),
          figures({ name: "beta", status: "unreachable", readAt: "2024-01-15T14:00:00.000Z" }),
        ]}
      />
    );
    expect(screen.getAllByText(/as of/).length).toBe(1);
    // The unreachable node read last, yet the panel's line keeps the healthy node's time.
    expect(screen.getByText(`as of ${localTime("2024-01-15T13:00:00.000Z")}`)).toBeTruthy();
    expect(
      screen.getByText(`Unreachable; no figures since ${localTime("2024-01-15T14:00:00.000Z")}`)
    ).toBeTruthy();
  });

  it("shows the waiting line for a null nodes value", () => {
    render(<NodePanel nodes={null} />);
    expect(screen.getByText("Waiting for figures…")).toBeTruthy();
  });

  it("shows the no-nodes line for an empty array", () => {
    render(<NodePanel nodes={[]} />);
    expect(screen.getByText("No nodes configured (NODES is not set)")).toBeTruthy();
  });
});
