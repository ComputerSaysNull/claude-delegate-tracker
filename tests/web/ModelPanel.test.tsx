// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModelPanel } from "../../src/web/ModelPanel.tsx";
import { localTime } from "../../src/web/time.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { Series } from "../../src/server/history.ts";

// The chart itself is Sparkline's to test; here only what each chart is handed matters: its
// label, its y range, its span, its colours and how many lines it draws.
vi.mock("../../src/web/Sparkline.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/Sparkline.tsx")>()),
  Sparkline: ({
    label,
    fixed,
    span,
    colors,
    data,
  }: {
    label: string;
    fixed?: [number, number];
    span?: number;
    colors?: string[];
    data: unknown[];
  }) => (
    <div
      role="img"
      aria-label={label}
      data-fixed={fixed === undefined ? "" : fixed.join(",")}
      data-span={span === undefined ? "" : String(span)}
      data-colors={colors === undefined ? "" : colors.join(",")}
      data-lines={String(data.length - 1)}
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

// The history the server keeps: the keys the charts draw.
const SERIES: Series = {
  at: [0, 1000],
  values: {
    running: [0, 0],
    waiting: [0, 0],
    kvCachePercent: [0, 0],
    kvKeptPercent: [0, 0],
    decodeTokensPerSecond: [0, 0],
  },
};

const GRID = "Model server figures";
const COMPACT = "Model server figures without a chart";
const HELP = "About KV-cache use";

function figureList(): HTMLElement {
  return screen.getByRole("list", { name: GRID });
}

function compactList(): HTMLElement {
  return screen.getByRole("list", { name: COMPACT });
}

function listItemIn(list: HTMLElement, label: string): HTMLElement {
  const found = within(list)
    .getAllByRole("listitem")
    .find((c) => (c.firstElementChild?.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`no figure cell labelled ${label}`);
  return found;
}

// A figure's cell. Its label may carry a help mark beside it (before or after the label text,
// and possibly with an icon glyph), so match on the label text being in the label element rather
// than on the cell's first child being exactly the label.
function cell(label: string): HTMLElement {
  return listItemIn(figureList(), label);
}

function compactItem(label: string): HTMLElement {
  return listItemIn(compactList(), label);
}

// The span holding a figure's big number.
function valueOf(label: string): HTMLElement {
  const value = cell(label).querySelector(".text-2xl");
  if (value === null) throw new Error(`no number in ${label}`);
  return value as HTMLElement;
}

// The line holding a figure's number and its unit.
function numberRow(label: string): HTMLElement {
  const row = valueOf(label).parentElement;
  if (row === null) throw new Error(`no number row in ${label}`);
  return row;
}

// The figure's label line, which may carry strokes and a help mark.
function labelLine(label: string): HTMLElement {
  const line = cell(label).firstElementChild;
  if (line === null) throw new Error(`no label in ${label}`);
  return line as HTMLElement;
}

// The span holding a compact item's value: the item's second child, after its label.
function compactValue(label: string): HTMLElement {
  const value = compactItem(label).children[1];
  if (value === undefined) throw new Error(`no value in ${label}`);
  return value as HTMLElement;
}

// The text of an element as the page reads it, with runs of whitespace collapsed.
function readText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

// The coloured strokes a label uses to key its lines.
function strokesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
}

// Whether some element inside `root` holds both a row's label and its figure: the row itself.
function hasRow(root: HTMLElement, label: string, value: string): boolean {
  return [...root.querySelectorAll<HTMLElement>("*")].some(
    (el) => (el.textContent ?? "").includes(label) && (el.textContent ?? "").includes(value),
  );
}

// What reserved and kept leave of the pool, as one decimal, the way the help card writes it.
function freeText(reserved: number, kept: number): string {
  return (100 - reserved - kept).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// A speed as the panel writes it: one decimal, so a whole number is as wide as any other.
function speed(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
    expect(valueOf("Requests").textContent).toBe("0 / 0");
  });

  it("carries a percent sign on KV-cache and prefix figures", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 7.4, prefixHitPercent: 92 })} />);
    expect(screen.getByText(`${(7.4).toLocaleString()}%`)).toBeTruthy();
    expect(compactValue("Prefix hits · since start").textContent).toBe(`${(92).toLocaleString()}%`);
  });

  // The card stops growing at six figures: the three that have a chart stay in the grid, the
  // other three drop to one compact item each under it, beside the rebuilt count.
  it("puts only the charted figures in the main grid, in order: Decode speed, Requests, KV-cache", () => {
    render(
      <ModelPanel
        model={figures({ decodeTokensPerSecond: 41.2, running: 2, waiting: 1, kvCachePercent: 58.4, kvKeptPercent: 23.1, prefixHitPercent: 92, mtpAcceptancePercent: 52, prefillTokensPerSecond: 1200 })}
        history={SERIES}
        windowSeconds={3600}
        rebuiltToday={3}
      />,
    );
    const grid = figureList();
    const cells = within(grid).getAllByRole("listitem");
    expect(cells).toHaveLength(3);
    const labels = cells.map((c) => readText(c.firstElementChild!));
    expect(labels[0]).toBe("Decode speed");
    expect(labels[1]).toBe("Requests · running / waiting");
    // The TensorFold label carries its help mark after the text.
    expect(labels[2]).toContain("KV-cache · reserved / kept prompts");
    // Each is a charted figure still: its number large, with its chart.
    for (const c of cells) {
      expect(c.querySelector(".text-2xl")).not.toBeNull();
      expect(within(c).getByRole("img")).toBeTruthy();
    }
    // The TensorFold figure keeps its help mark.
    expect(within(cells[2]).getByRole("button", { name: HELP })).toBeTruthy();
    expect(grid.textContent).not.toContain("Prefill");
    expect(grid.textContent).not.toContain("Prefix");
    expect(grid.textContent).not.toContain("MTP");
    expect(grid.textContent).not.toContain("Prompts rebuilt");
  });

  // The rows used to be spread over the height the Nodes card gives the model card, leaving a
  // gap under the header; they start right under it now.
  it("the figure grid starts under the header instead of spreading over the card's height", () => {
    render(<ModelPanel model={figures()} />);
    const grid = figureList();
    const classes = grid.className.split(/\s+/);
    expect(classes).not.toContain("content-evenly");
    expect(classes).not.toContain("flex-1");
    expect(classes).toContain("grid");
    expect(classes).toContain("grid-cols-1");
    expect(classes).toContain("@md:grid-cols-3");
    expect(grid.className).toMatch(/(^|\s)mt-\S+/);
    expect(grid.closest("section")!.className).toMatch(/\bflex-col\b/);
  });

  // A charted figure is its label, its number, and under them its chart across the column.
  it("a charted figure puts its chart under its number, across the column", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 41.2 })} history={SERIES} windowSeconds={3600} />);
    const figure = cell("Decode speed");
    expect(figure.className.split(/\s+/)).toContain("flex-col");
    const kids = Array.from(figure.children);
    expect(kids).toHaveLength(3);
    const number = kids[1] as HTMLElement;
    expect(numberRow("Decode speed")).toBe(number);
    expect(readText(number)).toContain("tok/s");
    const img = within(figure).getByRole("img");
    expect(kids[2].contains(img)).toBe(true);
    expect(number.contains(img)).toBe(false);
    expect(kids[0].contains(img)).toBe(false);
  });

  it("Decode speed draws one line in the default colour", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 41.2 })} history={SERIES} windowSeconds={3600} />);
    const drawn = screen.getByRole("img", { name: /^Decode speed over/ });
    expect(drawn.getAttribute("data-lines")).toBe("1");
    // The default colour, whether left to Sparkline or named as the muted token.
    expect(["", "--muted"]).toContain(drawn.getAttribute("data-colors"));
    expect(drawn.getAttribute("data-fixed")).toBe("");
  });

  // Both request lines in one chart, each keyed by a stroke beside its word in the label.
  it("Requests shows running / waiting as one number and draws both in one chart", () => {
    render(<ModelPanel model={figures({ running: 2, waiting: 1 })} history={SERIES} windowSeconds={3600} />);
    expect(valueOf("Requests").textContent).toBe("2 / 1");
    expect(readText(labelLine("Requests"))).toBe("Requests · running / waiting");
    const strokes = strokesIn(cell("Requests"));
    expect(strokes).toHaveLength(2);
    expect(strokes[0].className.split(/\s+/)).toContain("bg-chart-pair-a");
    expect(strokes[1].className.split(/\s+/)).toContain("bg-chart-pair-b");
    const drawn = screen.getByRole("img", { name: /^Requests over/ });
    expect(drawn.getAttribute("data-lines")).toBe("2");
    expect(drawn.getAttribute("data-colors")).toBe("--chart-pair-a,--chart-pair-b");
    expect(drawn.getAttribute("data-fixed")).toBe("");
  });

  // TensorFold gives both a reserved and a kept share; they sit in one number, reserved first.
  // At 1440 px the model card shares the row with the nodes card, and the full KV label did not
  // fit its column: as flex items its words broke mid-word ("reserve / d"). The label is plain
  // text whose stroke-and-word units never break inside, and " prompts" is left out on a
  // mid-width card (still shown on a phone, where the column is the card's full width).
  it("the KV label wraps only between its legend units, and drops 'prompts' on a mid-width card", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} />);
    const label = labelLine("KV-cache · reserved / kept prompts");
    expect(label.className).not.toContain("inline-flex");
    const units = Array.from(label.querySelectorAll("span.whitespace-nowrap"));
    expect(units.map((u) => u.textContent)).toEqual(["reserved /", "kept prompts"]);
    const prompts = Array.from(label.querySelectorAll("span")).find((s) => s.textContent === " prompts")!;
    expect(prompts.className.split(" ")).toEqual(expect.arrayContaining(["@md:hidden", "@3xl:inline"]));
  });

  it("KV-cache on TensorFold shows reserved / kept and draws both in one chart, on 0–100", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} history={SERIES} windowSeconds={3600} />);
    expect(valueOf("KV-cache").textContent).toBe(`${(58.4).toLocaleString()}% / ${(23.1).toLocaleString()}%`);
    // The help mark follows the label text in the same line.
    expect(readText(labelLine("KV-cache"))).toContain("KV-cache · reserved / kept prompts");
    expect(within(cell("KV-cache")).getByRole("button", { name: HELP })).toBeTruthy();
    const strokes = strokesIn(cell("KV-cache"));
    expect(strokes).toHaveLength(2);
    expect(strokes[0].className.split(/\s+/)).toContain("bg-chart-pair-a");
    expect(strokes[1].className.split(/\s+/)).toContain("bg-chart-pair-b");
    const drawn = screen.getByRole("img", { name: /^KV-cache/ });
    expect(drawn.getAttribute("data-lines")).toBe("2");
    expect(drawn.getAttribute("data-colors")).toBe("--chart-pair-a,--chart-pair-b");
    expect(drawn.getAttribute("data-fixed")).toBe("0,100");
  });

  // The pool is close to full at 90% booked and nearly exhausted at 97%: the number warns, then
  // reads as a failure, in the same colours the state badges use.
  it("the KV numbers turn amber from 90% together and red from 97%", () => {
    const { rerender } = render(<ModelPanel model={figures({ kvCachePercent: 44.9, kvKeptPercent: 45 })} />);
    const classes = () => valueOf("KV-cache").className.split(/\s+/);
    expect(classes()).not.toContain("text-state-queued");
    expect(classes()).not.toContain("text-state-failed");
    rerender(<ModelPanel model={figures({ kvCachePercent: 45, kvKeptPercent: 45 })} />);
    expect(classes()).toContain("text-state-queued");
    expect(classes()).not.toContain("text-state-failed");
    expect(valueOf("KV-cache").textContent).toBe(`${(45).toLocaleString()}% / ${(45).toLocaleString()}%`);
    rerender(<ModelPanel model={figures({ kvCachePercent: 48.5, kvKeptPercent: 48.5 })} />);
    expect(classes()).toContain("text-state-failed");
    expect(valueOf("KV-cache").textContent).toBe(`${(48.5).toLocaleString()}% / ${(48.5).toLocaleString()}%`);
  });

  // vLLM has neither a kept share nor a help card: one number, one line, no strokes.
  it("KV-cache on vLLM keeps one number, one line, and no help mark", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 7.4 })} history={SERIES} windowSeconds={3600} />);
    expect(valueOf("KV-cache").textContent).toBe(`${(7.4).toLocaleString()}%`);
    expect(readText(labelLine("KV-cache"))).toBe("KV-cache use");
    expect(strokesIn(cell("KV-cache"))).toHaveLength(0);
    expect(screen.queryByRole("button", { name: HELP })).toBeNull();
    const classes = valueOf("KV-cache").className.split(/\s+/);
    expect(classes).not.toContain("text-state-queued");
    expect(classes).not.toContain("text-state-failed");
    const drawn = screen.getByRole("img", { name: /^KV-cache/ });
    expect(drawn.getAttribute("data-lines")).toBe("1");
    expect(["", "--muted"]).toContain(drawn.getAttribute("data-colors"));
    expect(drawn.getAttribute("data-fixed")).toBe("0,100");
  });

  // The free room and today's rebuilt count moved: the free room stays in the help card, the
  // rebuilt count is a compact figure of its own, and neither sits under the KV number.
  it("no free line and no rebuilt line under the KV number", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const kv = cell("KV-cache");
    expect(kv.textContent).not.toContain("free");
    expect(kv.textContent).not.toContain("rebuilt");
    expect(Array.from(kv.children)).toHaveLength(3);
    expect(compactValue("Prompts rebuilt · today").textContent).toBe("3");
  });

  it("the help card still gives the free room", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const button = screen.getByRole("button", { name: HELP });
    hoverIn(button);
    const card = screen.getByRole("tooltip");
    expect(hasRow(card, "Reserved by running requests", `${(58.4).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Kept prompts", `${(23.1).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Free", `${freeText(58.4, 23.1)}%`)).toBe(true);
    expect(hasRow(card, "Rebuilt today", (3).toLocaleString())).toBe(true);
    expect(card.textContent).toContain("reply budget");
  });

  it("the help card shows only the rows whose figures exist", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={null} />);
    hoverIn(screen.getByRole("button", { name: HELP }));
    const card = screen.getByRole("tooltip");
    expect(hasRow(card, "Reserved by running requests", `${(58.4).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Kept prompts", `${(23.1).toLocaleString()}%`)).toBe(true);
    expect(hasRow(card, "Free", `${freeText(58.4, 23.1)}%`)).toBe(true);
    expect(card.textContent).not.toContain("Rebuilt today");
  });

  it("the help card opens on hover and closes on leave", () => {
    render(<ModelPanel model={figures({ kvCachePercent: 58.4, kvKeptPercent: 23.1 })} rebuiltToday={3} />);
    const button = screen.getByRole("button", { name: HELP });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tooltip")).toBeNull();
    hoverIn(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tooltip")).toBeTruthy();
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

  // The figures without a chart are now a label with its value under it, four across on a wide
  // card, under a divider: Prefill, Prefix hits, MTP, then today's rebuilt count.
  it("the compact row shows Prefill, Prefix hits, MTP and Prompts rebuilt, each label above its value", () => {
    render(
      <ModelPanel
        model={figures({ prefillTokensPerSecond: 1200, prefixHitPercent: 92, mtpAcceptancePercent: 52, mtpAcceptanceSinceStartPercent: 67.2 })}
        rebuiltToday={3}
      />,
    );
    const compact = compactList();
    const labels = within(compact)
      .getAllByRole("listitem")
      .map((c) => (c.firstElementChild?.textContent ?? "").trim());
    expect(labels).toEqual(["Prefill · last prompt", "Prefix hits · since start", "MTP · last / all", "Prompts rebuilt · today"]);
    const cases: [string, string][] = [
      ["Prefill · last prompt", speed(1200)],
      ["Prefix hits · since start", `${(92).toLocaleString()}%`],
      ["MTP · last / all", `${(52).toLocaleString()}% / ${(67.2).toLocaleString()}%`],
      ["Prompts rebuilt · today", "3"],
    ];
    for (const [label, value] of cases) {
      const item = compactItem(label);
      expect(item.className.split(/\s+/)).toContain("flex-col");
      // The item is its label and its value, stacked: nothing else.
      expect(Array.from(item.children)).toHaveLength(2);
      const labelSpan = item.children[0] as HTMLElement;
      const valueSpan = item.children[1] as HTMLElement;
      expect(labelSpan.textContent).toBe(label);
      expect(labelSpan.className.split(/\s+/)).toContain("text-[13px]");
      expect(labelSpan.className.split(/\s+/)).toContain("text-muted");
      expect(valueSpan.textContent).toContain(value);
      for (const cls of ["font-mono", "tabular-nums", "text-lg", "font-medium"]) {
        expect(valueSpan.className.split(/\s+/)).toContain(cls);
      }
      expect(valueSpan.className.split(/\s+/)).not.toContain("text-2xl");
      // 4 is Node.DOCUMENT_POSITION_FOLLOWING: the label comes above its value.
      expect(labelSpan.compareDocumentPosition(valueSpan) & 4).toBe(4);
    }
    // The prefill speed's unit is a small sans caption inside the value, as it was.
    const prefillValue = compactValue("Prefill · last prompt");
    const unit = [...prefillValue.querySelectorAll<HTMLElement>("span")].find((el) => (el.textContent ?? "").includes("tok/s"));
    expect(unit).toBeDefined();
    expect(unit!.className.split(/\s+/)).toContain("font-sans");
  });

  it("the compact row sits under a divider, two across, four on a wide card", () => {
    render(<ModelPanel model={figures()} />);
    const compact = compactList();
    const classes = compact.className.split(/\s+/);
    for (const cls of ["mt-3", "grid", "grid-cols-2", "gap-x-6", "gap-y-2", "border-t", "border-line", "pt-2.5", "@2xl:grid-cols-4"]) {
      expect(classes).toContain(cls);
    }
    // 4 is Node.DOCUMENT_POSITION_FOLLOWING: the compact row comes after the main grid.
    expect(figureList().compareDocumentPosition(compact) & 4).toBe(4);
  });

  it("Prompts rebuilt · today shows the count, 0 as 0, and — when unknown", () => {
    const { rerender } = render(<ModelPanel model={figures()} rebuiltToday={12} />);
    expect(compactValue("Prompts rebuilt · today").textContent).toBe((12).toLocaleString());
    rerender(<ModelPanel model={figures()} rebuiltToday={0} />);
    expect(compactValue("Prompts rebuilt · today").textContent).toBe("0");
    rerender(<ModelPanel model={figures()} rebuiltToday={null} />);
    expect(compactValue("Prompts rebuilt · today").textContent).toBe("—");
    rerender(<ModelPanel model={figures()} />);
    expect(compactValue("Prompts rebuilt · today").textContent).toBe("—");
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
    expect(screen.getAllByRole("img")).toHaveLength(3);
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

  it("shows decode speed without a line naming its window", () => {
    render(<ModelPanel model={figures({ decodeTokensPerSecond: 80.5, decodeWindowSeconds: 10 })} />);
    const decodeCell = cell("Decode speed");
    expect(decodeCell.textContent).toContain((80.5).toLocaleString());
    expect(decodeCell.textContent).toContain("tok/s");
    expect(decodeCell.textContent).not.toMatch(/over/);
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

  it("omits the preemptions row when it is null and shows it when set", () => {
    const { rerender } = render(<ModelPanel model={figures({ preemptions: null })} />);
    expect(screen.queryByText(/Preemptions/)).toBeNull();
    rerender(<ModelPanel model={figures({ preemptions: 3 })} />);
    expect(screen.getByText(/Preemptions/)).toBeTruthy();
    expect(screen.getByText((3).toLocaleString())).toBeTruthy();
  });

  it("the preemptions line stays after the compact row", () => {
    render(<ModelPanel model={figures({ preemptions: 3 })} />);
    const preemptions = screen.getByText(/Preemptions/);
    expect(compactList().compareDocumentPosition(preemptions) & 4).toBe(4);
  });

  it("shows an as-of line when the status is ok", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<ModelPanel model={figures({ status: "ok", readAt })} />);
    expect(screen.getByText(`as of ${localTime(readAt)}`)).toBeTruthy();
  });

  it("shows the unreachable line with the last reading time", () => {
    const readAt = "2024-01-15T13:45:00.000Z";
    render(<ModelPanel model={figures({ status: "unreachable", readAt })} />);
    expect(screen.getByText(`Unreachable; no figures since ${localTime(readAt)}`)).toBeTruthy();
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
});

// A chart under a number must not move when the number does, its time axis must follow the
// range switch, and the figures must not spread over the height the Nodes card gives the card.
describe("ModelPanel steady charts", () => {
  afterEach(cleanup);
  const twoPoints: Series = {
    at: [0, 10_000],
    values: { running: [0, 0], waiting: [0, 0], kvCachePercent: [0, 0], kvKeptPercent: [0, 0], decodeTokensPerSecond: [0, 0] },
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
});
