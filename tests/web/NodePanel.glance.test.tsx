// @vitest-environment jsdom
// The cluster at a glance: CPU and GPU use as donuts coloured by load, temperatures as
// numbers coloured by heat, against thresholds the backend sends from its settings.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NodePanel } from "../../src/web/NodePanel.tsx";
import type { NodeFigures } from "../../src/server/nodes.ts";

const LIMITS = { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 };

function figures(overrides: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name: "node-a", status: "ok", cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null,
    gpuPercent: null, gpuTempC: null, readAt: null, ...overrides,
  };
}

const ring = (label: string) => screen.getByRole("img", { name: label }).querySelector("[data-ring]")!;

afterEach(cleanup);

describe("node figures at a glance", () => {
  it("draws CPU and GPU use as donuts with the number in the middle", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 12, gpuPercent: 86 })]} limits={LIMITS} />);
    expect(screen.getByRole("img", { name: "CPU use 12 percent" }).textContent).toContain("12%");
    expect(screen.getByRole("img", { name: "GPU use 86 percent" }).textContent).toContain("86%");
  });

  it("colours a donut's ring by load: green under the warning line, amber from it, red from the hot one", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 49, gpuPercent: 50 }), figures({ name: "node-b", cpuPercent: 79, gpuPercent: 80 })]} limits={LIMITS} />);
    expect(ring("CPU use 49 percent").getAttribute("class")).toMatch(/\btext-state-ok\b/);
    expect(ring("GPU use 50 percent").getAttribute("class")).toMatch(/\btext-warn\b/);
    expect(ring("CPU use 79 percent").getAttribute("class")).toMatch(/\btext-warn\b/);
    expect(ring("GPU use 80 percent").getAttribute("class")).toMatch(/\btext-hot\b/);
  });

  it("fills the ring in proportion to the load", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 25 })]} limits={LIMITS} />);
    const [filled, total] = ring("CPU use 25 percent").getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(filled / (filled + total - filled)).toBeCloseTo(0.25, 2);
  });

  it("colours a temperature by heat", () => {
    render(<NodePanel nodes={[figures({ cpuTempC: 69, gpuTempC: 70 }), figures({ name: "node-b", cpuTempC: 84, gpuTempC: 85 })]} limits={LIMITS} />);
    expect(screen.getByLabelText("node-a CPU temperature").className).not.toMatch(/\btext-(warn|hot)\b/);
    expect(screen.getByLabelText("node-a GPU temperature").className).toMatch(/\btext-warn\b/);
    expect(screen.getByLabelText("node-b CPU temperature").className).toMatch(/\btext-warn\b/);
    expect(screen.getByLabelText("node-b GPU temperature").className).toMatch(/\btext-hot\b/);
  });

  it("draws an empty ring with a dash for a missing figure, never 0", () => {
    render(<NodePanel nodes={[figures()]} limits={LIMITS} />);
    const donut = screen.getByRole("img", { name: "CPU use unknown" });
    expect(donut.textContent).toContain("—");
    expect(donut.querySelector("[data-ring]")).toBeNull();
  });
});
