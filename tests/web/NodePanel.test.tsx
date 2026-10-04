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
    expect(screen.getByText(`${(61.5).toLocaleString()}%`)).toBeTruthy();
    expect(screen.getByText(`${(7).toLocaleString()}%`)).toBeTruthy();
  });

  it("carries °C on both temperatures", () => {
    render(<NodePanel nodes={[figures({ cpuTempC: 51.5, gpuTempC: 57 })]} />);
    expect(screen.getByText(`${(51.5).toLocaleString()} °C`)).toBeTruthy();
    expect(screen.getByText(`${(57).toLocaleString()} °C`)).toBeTruthy();
  });

  it("names the window on the CPU use line", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 61.5, cpuWindowSeconds: 5 })]} />);
    expect(screen.getByText(`${(61.5).toLocaleString()}%`)).toBeTruthy();
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

  it("shows the waiting line for a null nodes value", () => {
    render(<NodePanel nodes={null} />);
    expect(screen.getByText("Waiting for figures…")).toBeTruthy();
  });

  it("shows the no-nodes line for an empty array", () => {
    render(<NodePanel nodes={[]} />);
    expect(screen.getByText("No nodes configured (NODES is not set)")).toBeTruthy();
  });
});
