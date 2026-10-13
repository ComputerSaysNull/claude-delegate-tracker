// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
    memUsedPercent: null,
    memAvailableBytes: null,
    gpuPowerW: null,
    diskUsedPercent: null,
    diskReadBps: null,
    diskWriteBps: null,
    netRxBps: null,
    netTxBps: null,
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
    for (const label of ["CPU use unknown", "GPU use unknown"]) {
      expect(screen.getByRole("img", { name: label }).textContent).toContain("—");
    }
    for (const caption of ["CPU", "GPU"]) {
      expect(screen.getByLabelText(`node-1 ${caption} temperature`).textContent).toContain("—");
    }
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

  // Like the donuts: the figure inside a ring, its caption small below it.
  it("puts each temperature inside a full ring, above its caption", () => {
    render(<NodePanel nodes={[figures({ name: "n1", cpuTempC: 52, gpuTempC: 74 })]} />);
    for (const [caption, text] of [["CPU", "52°C"], ["GPU", "74°C"]]) {
      const value = screen.getByLabelText(`n1 ${caption} temperature`);
      expect(value.textContent).toBe(text);
      expect(value.querySelector("svg circle[data-ring]")).not.toBeNull();
      expect(value.nextElementSibling?.textContent).toBe(`${caption} temp`);
    }
  });

  // A temperature ring and a use ring's filled part are one colour at one strength; only the
  // use ring's track is light.
  it("draws a temperature's ring in the full colour of a use ring's filled part", () => {
    render(<NodePanel nodes={[figures({ name: "n1", gpuPercent: 30, gpuTempC: 52 })]} limits={LIMITS} />);
    const fill = screen.getByRole("img", { name: "GPU use 30 percent" }).querySelector("[data-ring]")!;
    const temp = screen.getByLabelText("n1 GPU temperature");
    const ring = temp.querySelector("[data-ring]")!;
    expect(fill.getAttribute("class")).toMatch(/\btext-state-ok\b/);
    expect(temp.className).toMatch(/\btext-state-ok\b/);
    for (const circle of [fill, ring]) {
      expect(circle.getAttribute("class") ?? "").not.toMatch(/\bopacity-/);
    }
  });

  it("colours a temperature's ring green below the warning threshold, and leaves it empty without a figure", () => {
    render(<NodePanel nodes={[figures({ name: "n1", cpuTempC: 52, gpuTempC: null })]} limits={{ loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 }} />);
    expect(screen.getByLabelText("n1 CPU temperature").className).toMatch(/\btext-state-ok\b/);
    const none = screen.getByLabelText("n1 GPU temperature");
    expect(none.textContent).toBe("—");
    expect(none.querySelector("svg circle[data-ring]")).toBeNull();
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

  it("shows CPU use without a line naming its window", () => {
    render(<NodePanel nodes={[figures({ cpuPercent: 61.5, cpuWindowSeconds: 5 })]} />);
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.queryByText(/over/)).toBeNull();
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

  describe("the figures list", () => {
    it("lists memory, GPU power, disk and network figures under each node", () => {
      render(<NodePanel nodes={[figures({
        name: "node-1",
        memUsedPercent: 95.3,
        memAvailableBytes: 5.7 * 1024 ** 3,
        gpuPowerW: 36.43,
        diskUsedPercent: 10.6,
        diskReadBps: 0,
        diskWriteBps: 1.2 * 1024 ** 2,
        netRxBps: 12 * 1024 ** 2,
        netTxBps: 3.4 * 1024 ** 2,
      })]} />);
      const dl = screen.getByLabelText("node-1 figures");
      // Memory, GPU power, Disk, Network — in that order, label then value.
      const order = ["Memory", "GPU power", "Disk", "Network"].map((label) =>
        within(dl).getByText(label)
      );
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      const value = (label: string) => within(dl).getByText(label).nextElementSibling!;
      expect(value("Memory").textContent).toBe("95% used · 5.7 GB free");
      expect(value("GPU power").textContent).toBe("36 W");
      expect(value("Disk").textContent).toBe("11% used · read 0 B/s · write 1.2 MB/s");
      expect(value("Network").textContent).toBe("in 12.0 MB/s · out 3.4 MB/s");
    });

    it("shows a measured zero rate as 0 B/s, not a dash", () => {
      render(<NodePanel nodes={[figures({ diskReadBps: 0 })]} />);
      const dl = screen.getByLabelText("node-1 figures");
      const disk = within(dl).getByText("Disk").nextElementSibling!;
      expect(disk.textContent).toMatch(/read 0 B\/s/);
      expect(disk.textContent).not.toMatch(/read —/);
    });

    it("shows a dash for every null new figure, never a digit", () => {
      render(<NodePanel nodes={[figures()]} />);
      const dl = screen.getByLabelText("node-1 figures");
      const text = dl.textContent!;
      expect(text).toContain("—");
      expect(text.match(/—/g)!.length).toBeGreaterThanOrEqual(4);
      expect(text).not.toMatch(/\d/);
    });
  });
});
