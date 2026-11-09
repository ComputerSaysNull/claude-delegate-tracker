// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import { localTime } from "../../src/web/time.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { Series } from "../../src/server/history.ts";

// The chart itself is Sparkline's to test; here only the range each chart is given matters.
vi.mock("../../src/web/Sparkline.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/Sparkline.tsx")>()),
  Sparkline: ({ label, fixed, span }: { label: string; fixed?: [number, number]; span?: number }) => (
    <div
      role="img"
      aria-label={label}
      data-fixed={fixed === undefined ? "" : fixed.join(",")}
      data-span={span === undefined ? "" : String(span)}
    />
  ),
}));

function figures(overrides: Partial<ModelFigures> = {}): ModelFigures {
  return {
    status: "ok",
    running: null,
    waiting: null,
    kvCachePercent: null,
    kvKeptPercent: null,
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

// A figure's cell. Its label may carry a help button beside it (before or after the label text,
// and possibly with an icon glyph), so match on the label text being in the label element rather
// than on the cell's first child being exactly the label.
function cell(label: string): HTMLElement {
  const found = screen
    .getAllByRole("listitem")
    .find((c) => (c.firstElementChild?.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`no figure cell labelled ${label}`);
  return found;
}

// The span holding a figure's big number.
function valueOf(label: string): HTMLElement {
  const value = cell(label).querySelector(".text-2xl");
  if (value === null) throw new Error(`no number in ${label}`);
  return value as HTMLElement;
}

// The row holding the number and its unit: captions must stay outside it.
function numberRow(label: string): HTMLElement {
  return valueOf(label).parentElement!.parentElement as HTMLElement;
}

// The innermost element holding `needle`. A descendant always follows its ancestors in document
// order, so the last match is the innermost one: that is the element holding the text itself,
// not a wrapper around it.
function innermost(root: HTMLElement, needle: string): HTMLElement {
  const matches = [...root.querySelectorAll<HTMLElement>("*")].filter((el) => (el.textContent ?? "").includes(needle));
  if (matches.length === 0) throw new Error(`no element holds ${needle}`);
  return matches[matches.length - 1];
}

// Whether some element inside `root` holds both a row's label and its figure: the row itself.
function hasRow(root: HTMLElement, label: string, value: string): boolean {
  return [...root.querySelectorAll<HTMLElement>("*")].some(
    (el) => (el.textContent ?? "").includes(label) && (el.textContent ?? "").includes(value),
  );
}

// What reserved and kept leave of the pool, as one decimal, the way the panel writes it.
function freeText(reserved: number, kept: number): string {
  return (100 - reserved - kept).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// A speed as the panel writes it: one decimal, so a whole number is as wide as any other.
function speed(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// The compact row that follows the charted figures: one line per figure, a label and a value.
const COMPACT = "Model server figures without a chart";

function compactList(): HTMLElement {
  return screen.getByRole("list", { name: COMPACT });
}

function compactItem(label: string): HTMLElement {
  const found = within(compactList())
    .getAllByRole("listitem")
    .find((c) => (c.firstElementChild?.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`no compact item labelled ${label}`);
  return found;
}

// The span holding a compact item's value: the item's second child, after its label.
function compactValue(label: string): HTMLElement {
  const value = compactItem(label).children[1];
  if (value === undefined) throw new Error(`no value in ${label}`);
  return value as HTMLElement;
}

// React derives mouseenter/mouseleave from mouseover/mouseout, and a plain mouseenter does not
// bubble, so a handler on a wrapper above the button only sees the bubbling pair. Fire both, so
// the test does not depend on where the handler sits.
function hoverIn(el: HTMLElement) {
  fireEvent.mouseOver(el, { relatedTarget: document.body });
  fireEvent.mouseEnter(el);
}

function hoverOut(el: HTMLElement) {
  fireEvent.mouseOut(el, { relatedTarget: document.body });
  fireEvent.mouseLeave(el);
}

const HELP = "About KV-cache use";

// The history the server keeps: only the figures the charts draw.
const SERIES: Series = {
  at: [0, 1000],
  values: { running: [0, 0], waiting: [0, 0], kvCachePercent: [0, 0], decodeTokensPerSecond: [0, 0] },
};

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
    expect(compactValue("Prefix hits · since start").textContent).toBe(`${(92).toLocaleString()}%`);
  });

  // The card stops growing at six figures: the three that have a chart stay in the grid, the
  // other three drop to one compact line each in a row of their own under it.
  it("puts only the charted figures in the main grid, in order: Decode speed, Requests, KV-cache use", () => {
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 41.2, running: 2, waiting: 0, kvCachePercent: 58.4, kvKeptPercent: 23.1, prefixHitPercent: 92, mtpAcceptancePercent: 52, prefillTokensPerSecond: 1200 })}
        history={SERIES}
        windowSeconds={3600}
        rebuiltToday={3}
      />,
    );
    const grid = screen.getByRole("list", { name: "Model server figures" });
    const cells = within(grid).getAllByRole("listitem");
    expect(cells).toHaveLength(3);
    const labels = cells.map((c) => c.firstElementChild!.textContent ?? "");
    expect(labels[0]).toContain("Decode speed");
    expect(labels[1]).toContain("Requests");
    expect(labels[2]).toContain("KV-cache use");
    // Each is a charted figure still: its number large, with its chart beside it.
    for (const c of cells) {
      expect(c.querySelector(".text-2xl")).not.toBeNull();
      expect(within(c).getByRole("img")).toBeTruthy();
    }
    // The KV figure keeps its help mark and its note lines.
    expect(within(cells[2]).getByRole("button", { name: HELP })).toBeTruthy();
    expect(cells[2].textContent).toContain("reserved / kept prompts");
    expect(grid.textContent).not.toContain("Prefill");
    expect(grid.textContent).not.toContain("Prefix");
    expect(grid.textContent).not.toContain("MTP");
  });

  it("puts Prefill, Prefix hits and MTP in one compact row after the main grid, in that order", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: 1200, prefixHitPercent: 92, mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2 })}
      />,
    );
    const grid = screen.getByRole("list", { name: "Model server figures" });
    const compact = compactList();
    // 4 is Node.DOCUMENT_POSITION_FOLLOWING: the compact row comes after the main grid.
    expect(grid.compareDocumentPosition(compact) & 4).toBe(4);
    const labels = within(compact).getAllByRole("listitem").map((c) => c.firstElementChild!.textContent);
    expect(labels).toEqual(["Prefill · last prompt", "Prefix hits · since start", "MTP · last / all"]);
  });

  it("each compact item is one line: its label and its value, not a large number", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: 1200, prefixHitPercent: 92, mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2 })}
      />,
    );
    const cases: [string, string][] = [
      ["Prefill · last prompt", speed(1200)],
      ["Prefix hits · since start", `${(92).toLocaleString()}%`],
      ["MTP · last / all", `${(52).toLocaleString()}% / ${(67.2).toLocaleString()}%`],
    ];
    for (const [label, value] of cases) {
      const item = compactItem(label);
      // The item is its label and its value, side by side: nothing else, and nothing stacked.
      expect(item.children).toHaveLength(2);
      const labelSpan = item.children[0] as HTMLElement;
      const valueSpan = item.children[1] as HTMLElement;
      expect(labelSpan.textContent).toBe(label);
      expect(valueSpan.textContent).toContain(value);
      expect(valueSpan.className).not.toMatch(/\btext-2xl\b/);
      expect(item.className.split(/\s+/)).not.toContain("flex-col");
    }
  });

  it("the compact MTP item shows last / since start, with a dash for a missing part", () => {
    const { rerender } = render(
      <ModelPanel model={figures({ mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2 })} />,
    );
    const both = `${(52).toLocaleString()}% / ${(67.2).toLocaleString()}%`;
    expect(compactValue("MTP · last / all").textContent).toBe(both);
    // The visible text is the label and then the two figures: no caption like the old one.
    const text = compactItem("MTP · last / all").textContent!;
    expect(text).toContain("MTP · last / all");
    expect(text.indexOf(both)).toBeGreaterThan(text.indexOf("MTP · last / all"));
    rerender(<ModelPanel model={figures({ mtpAcceptanceSinceStartPercent: 67.2 })} />);
    expect(compactValue("MTP · last / all").textContent).toBe(`— / ${(67.2).toLocaleString()}%`);
    rerender(<ModelPanel model={figures({ mtpAcceptancePercent: 52 })} />);
    expect(compactValue("MTP · last / all").textContent).toBe(`${(52).toLocaleString()}% / —`);
  });

  it("the compact MTP item explains its two numbers in its title", () => {
    render(<ModelPanel model={figures({ mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2 })} />);
    const item = compactItem("MTP · last / all");
    expect(item.getAttribute("title")).toBe("MTP acceptance: the last requests to finish / since the engine started");
  });

  // The prefill speed is a single event between gaps, not a series: it gets no chart.
  it("Prefill has no chart", () => {
    render(<ModelPanel model={figures({ prefillTokensPerSecond: 1200 })} history={SERIES} windowSeconds={3600} />);
    expect(screen.queryByRole("img", { name: /Prefill/ })).toBeNull();
    expect(within(compactItem("Prefill · last prompt")).queryByRole("img")).toBeNull();
    const charts = screen.getAllByRole("img").map((c) => c.getAttribute("aria-label"));
    expect(charts).toHaveLength(3);
  });

  // TensorFold gives both a reserved and a kept share; they sit in one number, reserved first.
  it("shows reserved and kept as one big number, reserved first", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} />);
    expect(valueOf("KV-cache use").textContent).toBe(`${(58.4).toLocaleString()}% / ${(23.1).toLocaleString()}%`);
  });

  it("labels the two numbers and the free room on the line under them", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} />);
    const kvCell = cell("KV-cache use");
    expect(valueOf("KV-cache use").textContent).toBe(`${(58.4).toLocaleString()}% / ${(23.1).toLocaleString()}%`);
    const labelLine = innermost(kvCell, "reserved / kept prompts");
    expect(labelLine.textContent).toContain("reserved / kept prompts");
    expect(labelLine.textContent).toContain(`${freeText(58.4, 23.1)}% free`);
    expect(labelLine.textContent!.indexOf("reserved / kept prompts")).toBeLessThan(labelLine.textContent!.indexOf("% free"));
    const row = numberRow("KV-cache use");
    expect(row.textContent).not.toContain("reserved");
    expect(row.textContent).not.toContain("free");
    expect(row.contains(labelLine)).toBe(false);
    // jsdom does no layout: the line is its own line because it displays as a block.
    expect(labelLine.classList.contains("block")).toBe(true);
    const freeNumber = [...labelLine.querySelectorAll<HTMLElement>("span")].find((el) =>
      (el.textContent ?? "").includes(freeText(58.4, 23.1)),
    );
    expect(freeNumber).toBeDefined();
    expect(freeNumber!.className).toMatch(/\bfont-mono\b/);
  });

  it("free room is what reserved and kept leave of the pool, one decimal", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 60, kvKeptPercent: 25 })} />);
    const kvCell = cell("KV-cache use");
    expect(valueOf("KV-cache use").textContent).toBe(`${(60).toLocaleString()}% / ${(25).toLocaleString()}%`);
    expect(kvCell.textContent).toContain(`${freeText(60, 25)}% free`);
  });

  it("today's rebuilt prompts get their own line under the label line", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const kvCell = cell("KV-cache use");
    const labelLine = innermost(kvCell, "reserved / kept prompts");
    const rebuiltLine = innermost(kvCell, "rebuilt today");
    expect(rebuiltLine.textContent).toBe("3 prompts rebuilt today");
    expect(rebuiltLine).not.toBe(labelLine);
    expect(labelLine.contains(rebuiltLine)).toBe(false);
    expect(rebuiltLine.contains(labelLine)).toBe(false);
    // 4 is Node.DOCUMENT_POSITION_FOLLOWING: the rebuilt line comes after the label line.
    expect(labelLine.compareDocumentPosition(rebuiltLine) & 4).toBe(4);
    expect(labelLine.classList.contains("block")).toBe(true);
    expect(rebuiltLine.classList.contains("block")).toBe(true);
    expect(numberRow("KV-cache use").textContent).not.toContain("rebuilt");
    const count = [...rebuiltLine.querySelectorAll<HTMLElement>("span")].find((el) => (el.textContent ?? "").includes("3"));
    expect(count).toBeDefined();
    expect(count!.className).toMatch(/\bfont-mono\b/);
  });

  it("one rebuilt prompt is singular", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={1} />);
    const line = innermost(cell("KV-cache use"), "rebuilt today");
    expect(line.textContent).toBe("1 prompt rebuilt today");
  });

  it("0 rebuilt prompts today shows 0", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={0} />);
    const line = innermost(cell("KV-cache use"), "rebuilt today");
    expect(line.textContent).toBe("0 prompts rebuilt today");
    expect(line.textContent).not.toContain("—");
  });

  // vLLM has neither a kept share nor a free-room line, so its cell carries only the number and
  // today's rebuilt prompts; there is no help card to open.
  it("a vLLM model shows only today's rebuilt prompts under its number, with no help button", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 7.4 })} rebuiltToday={2} />);
    const kvCell = cell("KV-cache use");
    expect(valueOf("KV-cache use").textContent).toBe(`${(7.4).toLocaleString()}%`);
    const line = innermost(kvCell, "rebuilt today");
    expect(line.textContent).toBe("2 prompts rebuilt today");
    expect(line.classList.contains("block")).toBe(true);
    expect(kvCell.textContent).not.toContain("reserved");
    expect(kvCell.textContent).not.toContain("free");
    expect(numberRow("KV-cache use").textContent).not.toContain("rebuilt");
    expect(screen.queryByRole("button", { name: HELP })).toBeNull();
  });

  it("a vLLM model shows the plain number with no lines under it and no help button", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 7.4 })} />);
    const kvCell = cell("KV-cache use");
    expect(valueOf("KV-cache use").textContent).toBe(`${(7.4).toLocaleString()}%`);
    expect(kvCell.textContent).not.toContain("reserved");
    expect(kvCell.textContent).not.toContain("free");
    expect(kvCell.textContent).not.toContain("rebuilt");
    expect(screen.queryByRole("button", { name: HELP })).toBeNull();
  });

  it("nothing about rebuilt prompts when the count is unknown", () => {
    const { rerender } = render(
      <ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={null} />,
    );
    const kvCell = cell("KV-cache use");
    expect(kvCell.textContent).toContain("reserved / kept prompts");
    expect(kvCell.textContent).not.toContain("rebuilt");
    rerender(<ModelPanel model={figures({ kvCachePercent: 7.4 })} />);
    expect(cell("KV-cache use").textContent).not.toContain("rebuilt");
  });

  it("the help card opens on hover and closes on leave", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const button = screen.getByRole("button", { name: HELP });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tooltip")).toBeNull();
    hoverIn(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const card = screen.getByRole("tooltip");
    expect(hasRow(card, "Reserved by running requests", `${(58.4).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Kept prompts", `${(23.1).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Free", `${freeText(58.4, 23.1)}%`)).toBe(true);
    expect(hasRow(card, "Rebuilt today", (3).toLocaleString())).toBe(true);
    expect(card.textContent).toContain("reply budget");
    expect(card.textContent!.toLowerCase()).toContain("free");
    expect(card.textContent).toContain("rebuild");
    hoverOut(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  // A phone has no hover: a tap opens the card and leaves it open until another tap.
  it("a click keeps the help card open after the mouse leaves, and a second click closes it", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const button = screen.getByRole("button", { name: HELP });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tooltip")).toBeTruthy();
    hoverOut(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // The KV figure sits near the top of the page, so a card opening upward ran off the window.
  // Opening downward, it lies over the delegation list, whose search box painted over it.
  it("the help card opens below its button, above the page under it", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    hoverIn(screen.getByRole("button", { name: HELP }));
    const placed = screen.getByRole("tooltip").parentElement!;
    expect(placed.className).toContain("top-full");
    expect(placed.className).not.toContain("bottom-full");
    expect(placed.className).toMatch(/(^|\s)z-\d+/);
  });

  it("Escape closes the help card", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const button = screen.getByRole("button", { name: HELP });
    hoverIn(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(button, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("the help card shows only the rows whose figures exist", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={null} />);
    const button = screen.getByRole("button", { name: HELP });
    hoverIn(button);
    const card = screen.getByRole("tooltip");
    expect(hasRow(card, "Reserved by running requests", `${(58.4).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Kept prompts", `${(23.1).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Free", `${freeText(58.4, 23.1)}%`)).toBe(true);
    expect(card.textContent).not.toContain("Rebuilt today");
  });

  // The number's row cannot shrink, so a caption inside it cannot wrap and runs over the next
  // cells. The KV-cache lines sit on their own line under the number instead, and the compact
  // MTP item carries no caption at all: its explanation is its title.
  it("puts the KV-cache caption on its own line, outside the number's row, and gives MTP no caption", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1, mtpAcceptancePercent: 52 })} rebuiltToday={3} />);
    const kvCell = cell("KV-cache use");
    expect(valueOf("KV-cache use").textContent).toBe(`${(58.4).toLocaleString()}% / ${(23.1).toLocaleString()}%`);
    expect(kvCell.textContent).toContain("reserved / kept prompts");
    expect(kvCell.textContent).toContain("rebuilt today");
    const kvRow = numberRow("KV-cache use");
    expect(kvRow.textContent).not.toContain("reserved");
    expect(kvRow.textContent).not.toContain("rebuilt");
    const mtpItem = compactItem("MTP · last / all");
    const mtpText = mtpItem.textContent!;
    expect(mtpText).toContain("MTP · last / all");
    expect(mtpText).toContain(`${(52).toLocaleString()}% / —`);
    expect(mtpText.indexOf(`${(52).toLocaleString()}% / —`)).toBeGreaterThan(mtpText.indexOf("MTP · last / all"));
    expect(mtpText).not.toContain("last requests to finish");
  });

  it("shows decode speed without a line naming its window", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} />);
    const decodeCell = cell("Decode speed");
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

  it("shows the no-known-figures line", () => {
    render(<ModelPanel model={figures({ status: "no known figures" })} />);
    expect(screen.getByText("/metrics has no figures this tracker reads").className).toContain("text-warn");
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
    render(<ModelPanel model={figures()} history={SERIES} windowSeconds={3600} />);
    expect(screen.getByRole("img", { name: /^KV-cache use over/ }).getAttribute("data-fixed")).toBe("0,100");
    expect(screen.getByRole("img", { name: /^Decode speed over/ }).getAttribute("data-fixed")).toBe("");
    expect(screen.getByRole("img", { name: /^Requests over/ }).getAttribute("data-fixed")).toBe("");
  });

  // The chart sits beside its number rather than under it, so a figure takes one line.
  it("puts each chart on the same line as its number", () => {
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 80.5, running: 3, kvCachePercent: 7.4 })}
        history={SERIES}
        windowSeconds={3600}
      />,
    );
    const cases: [RegExp, string][] = [
      [/^Decode speed over/, (80.5).toLocaleString()],
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

  it("shows a dash for Prefill and MTP in the compact row when null", () => {
    render(<ModelPanel model={figures()} />);
    expect(compactValue("Prefill · last prompt").textContent).toContain("—");
    expect(compactValue("MTP · last / all").textContent).toBe("— / —");
  });

  it("shows the live prefill speed from the decode event in the compact item", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: null })}
        decode={{ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: 1453.3 }}
      />,
    );
    const value = compactValue("Prefill · last prompt");
    expect(value.textContent).toContain(speed(1453.3));
    expect(value.textContent).toContain("tok/s");
    expect(value.textContent).not.toContain("—");
  });

  it("shows the model's own prefill figure when no decode event has arrived", () => {
    render(<ModelPanel model={figures({ prefillTokensPerSecond: 1200 })} />);
    expect(compactValue("Prefill · last prompt").textContent).toContain(speed(1200));
  });

  it("shows the model's own prefill figure when the model status is not ok, even with a decode event", () => {
    render(
      <ModelPanel
        model={figures({ status: "unreachable", readAt: "2026-10-03T12:00:00.000Z", prefillTokensPerSecond: 1200 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: 1453.3 }}
      />,
    );
    const value = compactValue("Prefill · last prompt");
    expect(value.textContent).toContain(speed(1200));
    expect(value.textContent).not.toContain(speed(1453.3));
  });

  it("shows a dash for prefill when both the model and the live decode have none", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: null })}
        decode={{ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    expect(compactValue("Prefill · last prompt").textContent).toContain("—");
  });

  it("shows the live decode value once a decode event has arrived, over the model's own", () => {
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    const decodeCell = cell("Decode speed");
    expect(decodeCell.textContent).toContain((61.4).toLocaleString());
    expect(decodeCell.textContent).toContain("tok/s");
    expect(decodeCell.textContent).not.toContain((80.5).toLocaleString());
  });

  it("shows the model's own decode figure when no decode event has arrived", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} decode={null} />);
    expect(cell("Decode speed").textContent).toContain((80.5).toLocaleString());
  });

  it("shows the model's own decode figure when the model status is not ok, even with a decode event", () => {
    render(
      <ModelPanel
        model={figures({ status: "unreachable", readAt: "2026-10-03T12:00:00.000Z", decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })}
        decode={{ tokensPerSecond: 61.4, windowSeconds: 1, prefillTokensPerSecond: null }}
      />,
    );
    const decodeCell = cell("Decode speed");
    expect(decodeCell.textContent).toContain((80.5).toLocaleString());
    expect(decodeCell.textContent).not.toContain((61.4).toLocaleString());
  });
});

// A chart beside a number must not move when the number does, its time axis must follow the
// range switch, and the card's rows spread over the height the Nodes card gives it.
describe("ModelPanel steady charts", () => {
  afterEach(cleanup);
  const twoPoints: Series = {
    at: [0, 10_000],
    values: { running: [0, 0], waiting: [0, 0], kvCachePercent: [0, 0], decodeTokensPerSecond: [0, 0] },
  };

  it("shows decode and prefill speeds with one decimal, even on a whole number", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 41, prefillTokensPerSecond: 1465 })} />);
    expect(valueOf("Decode speed").textContent).toBe(speed(41));
    expect(compactValue("Prefill · last prompt").textContent).toContain(speed(1465));
  });

  it("gives the decode number a minimum width in digits", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 9.5 })} />);
    expect(valueOf("Decode speed").style.minWidth).toBe("4ch");
  });

  it("hands every chart the chosen range as its time span", () => {
    render(<ModelPanel model={figures()} history={twoPoints} windowSeconds={900} />);
    const charts = screen.getAllByRole("img");
    expect(charts).toHaveLength(3);
    for (const img of charts) expect(img.getAttribute("data-span")).toBe("900");
  });

  it("spreads the figure rows over the card's height", () => {
    render(<ModelPanel model={figures()} />);
    const list = screen.getByRole("list", { name: "Model server figures" });
    expect(list.className).toMatch(/\bflex-1\b/);
    expect(list.className).toMatch(/\bcontent-evenly\b/);
    expect(list.closest("section")!.className).toMatch(/\bflex\b.*\bflex-col\b|\bflex-col\b.*\bflex\b/);
  });
});
