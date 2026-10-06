// @vitest-environment jsdom
// A turn whose reply or thinking repeats an earlier line stands out as a possible loop: its
// heading carries an amber status per repeating part, and the details bar shows a Repeats row
// with the highest share and the turn it came from.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

// jsdom has no matchMedia; this stub is re-read at each render, so a test can set
// `mediaMatches` right before rendering to choose the viewport the component sees.
let mediaMatches = true;

beforeEach(() => {
  localStorage.clear();
  mediaMatches = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: mediaMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1", state: "live", why: null, age: null, kind: "read_file", model: "flash", effort: null,
    title: "Find every caller of load_config", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, ...overrides,
  };
}

function turn(n: number, overrides: Partial<TurnView> = {}): TurnView {
  return {
    n, heading: `turn ${n}`, budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null,
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, retries: [], tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, question: null, answer: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: "Find every place that calls load_config()", files: [], waiting: null, turns: [], summary: null, ...overrides };
}

describe("a turn's looping markers", () => {
  it("marks a turn whose thinking repeats", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { thinkingRepeated: "31%" })] })} />);
    const status = screen.getByRole("status");
    expect(status.className).toMatch(/\btext-warn\b/);
    expect(status.textContent).toBe("thinking repeats 31%");
    expect(status.getAttribute("aria-label")).toBe("Turn 1 may be looping: thinking repeats 31%");
  });

  it("marks a turn whose reply repeats", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: "22%" })] })} />);
    const status = screen.getByRole("status");
    expect(status.className).toMatch(/\btext-warn\b/);
    expect(status.textContent).toBe("reply repeats 22%");
    expect(status.getAttribute("aria-label")).toBe("Turn 1 may be looping: reply repeats 22%");
  });

  it("shows one marker per repeating part", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: "22%", thinkingRepeated: "31%" })] })} />);
    const reply = screen.getByRole("status", { name: "Turn 1 may be looping: reply repeats 22%" });
    const thinking = screen.getByRole("status", { name: "Turn 1 may be looping: thinking repeats 31%" });
    expect(reply.className).toMatch(/\btext-warn\b/);
    expect(thinking.className).toMatch(/\btext-warn\b/);
    expect(reply.textContent).toBe("reply repeats 22%");
    expect(thinking.textContent).toBe("thinking repeats 31%");
  });

  it("shows no marker when neither part repeats", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: null, thinkingRepeated: null })] })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no longer reports repeated output inside the Turn details fold", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: "22%", evicted: 0 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn details" }));
    expect(screen.queryByText(/repeated output/)).toBeNull();
  });

  // The share moved to the heading, so a turn with nothing else to fold offers no empty fold.
  it("offers no Turn details toggle when the repeated share is all a turn has", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: "22%" })] })} />);
    expect(screen.queryByRole("button", { name: "Turn details" })).toBeNull();
  });
});

describe("the details bar's Repeats row", () => {
  it("shows the highest repeating share with its part and turn", () => {
    const v = view({ turns: [turn(4, { thinkingRepeated: "31%" })] });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const dt = within(aside).getByText("Repeats");
    expect(dt.nextElementSibling?.textContent).toBe("31% thinking, turn 4");
  });

  it("picks the higher of a turn's reply and thinking shares", () => {
    const v = view({ turns: [turn(2, { repeated: "50%", thinkingRepeated: "31%" })] });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const dt = within(aside).getByText("Repeats");
    expect(dt.nextElementSibling?.textContent).toBe("50% reply, turn 2");
  });

  it("picks the highest share across turns", () => {
    const v = view({ turns: [turn(1, { repeated: "22%" }), turn(3, { thinkingRepeated: "31%" })] });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const dt = within(aside).getByText("Repeats");
    expect(dt.nextElementSibling?.textContent).toBe("31% thinking, turn 3");
  });

  it("has no Repeats row when no turn repeats", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { repeated: null, thinkingRepeated: null })] })} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).queryByText("Repeats")).toBeNull();
  });
});
