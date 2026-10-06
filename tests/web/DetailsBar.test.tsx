// @vitest-environment jsdom
// The delegation's details sit in a bar beside the conversation; the header keeps only the state and the title.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, TurnView, CallView, SummaryView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";
import { localTime } from "../../src/web/time.ts";

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
    name: "stream-1",
    state: "live",
    why: null,
    age: null,
    kind: "claude-code",
    model: null,
    effort: null,
    title: "Refactor the auth module",
    startedAt: null,
    elapsed: null,
    turns: null,
    unknownFormat: null,
    left: null,
    queueOf: null,
    ...overrides,
  };
}

function turn(n: number, overrides: Partial<TurnView> = {}): TurnView {
  return {
    n,
    heading: `turn ${n}`,
    budget: null,
    calls: [],
    reply: null,
    closed: false,
    heartbeat: null,
    partial: null,
    thinking: null,
    retries: [],
    toolTime: null,
    attempts: null,
    repeated: null,
    thinkingRepeated: null,
    evicted: null,
    tokensIn: null,
    tokensOut: null,
    tokS: null,
    clock: null,
    at: null,
    question: null,
    answer: null,
    ...overrides,
  };
}

function call(overrides: Partial<CallView> = {}): CallView {
  return {
    name: "read_file",
    ok: null,
    outcome: null,
    status: null,
    args: [],
    message: null,
    result: null,
    exitCode: null,
    time: null,
    ...overrides,
  };
}

function summary(overrides: Partial<SummaryView> = {}): SummaryView {
  return {
    finished: false,
    ok: null,
    elapsed: null,
    turns: null,
    cached: null,
    reuse: null,
    returned: null,
    load: null,
    failures: null,
    toolTime: null,
    finishReason: null,
    error: null,
    shellCalls: null,
    ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return {
    name: "stream-1",
    seq: 1,
    row: row(),
    task: null,
    files: [],
    waiting: null,
    turns: [],
    summary: null,
    ...overrides,
  };
}

// The aside's tool-call figure: the count of every call across view.turns, pulled out of the
// bar's text so the test does not care whether the label and the number share a node.
function toolCalls(aside: HTMLElement): number {
  const match = (aside.textContent ?? "").match(/tool calls\s*(\d+)/i);
  return match === null ? -1 : Number(match[1]);
}

describe("DetailsBar", () => {
  it("keeps the sticky header to the state badge, the title and the Details button", () => {
    const v = view({
      row: row({
        kind: "claude-code",
        model: "sonnet",
        effort: "high",
        startedAt: "2024-01-01T10:00:00Z",
        elapsed: "2m",
        turns: "1 of 3",
      }),
      turns: [turn(1, { clock: { elapsed: 20, of: 100 }, heartbeat: "beat" })],
    });
    const { container } = render(<StreamViewBody view={v} />);
    const header = container.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getByText("Running")).toBeTruthy();
    expect(within(header).getByRole("heading", { level: 2 })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Details" })).toBeTruthy();
    // The meta line, the turn bar, the time bar and the heartbeat moved out of the header.
    expect(within(header).queryByText(/claude-code/)).toBeNull();
    expect(within(header).queryByRole("progressbar")).toBeNull();
    expect(within(header).queryByText(/Time left/)).toBeNull();
    expect(within(header).queryByText(/beat/)).toBeNull();
  });

  it("holds the run's meta and turn figures in the details bar", () => {
    const started = localTime("2024-01-01T10:00:00Z");
    const v = view({
      row: row({
        kind: "claude-code",
        model: "sonnet",
        effort: "high",
        startedAt: "2024-01-01T10:00:00Z",
        elapsed: "2m",
        turns: "1 of 3",
      }),
      turns: [turn(1, { clock: { elapsed: 20, of: 100 }, heartbeat: "beat" })],
    });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).getByText(/claude-code/)).toBeTruthy();
    expect(within(aside).getByText(/sonnet/)).toBeTruthy();
    expect(within(aside).getByText("Effort").nextElementSibling?.textContent).toBe("high");
    expect(within(aside).getByText(new RegExp(started))).toBeTruthy();
    expect(within(aside).getByText(/2m/)).toBeTruthy();
    expect(within(aside).getByRole("progressbar", { name: /turn/i })).toBeTruthy();
    expect(within(aside).getByText(/Time left/)).toBeTruthy();
    expect(within(aside).getByText(/beat/)).toBeTruthy();
  });

  it("the Details button folds and unfolds the bar, remembering the choice", () => {
    render(<StreamViewBody view={view()} />);
    const button = () => screen.getByRole("button", { name: "Details" });
    expect(button().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button());
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("tracker.detailsFolded")).toBe("1");
    fireEvent.click(button());
    expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("tracker.detailsFolded")).toBe("0");
  });

  it("folds the bar on first render when the viewport is not wide", () => {
    mediaMatches = false;
    render(<StreamViewBody view={view()} />);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the bar on first render when the viewport is wide", () => {
    mediaMatches = true;
    render(<StreamViewBody view={view()} />);
    expect(screen.getByRole("complementary", { name: "Details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("a stored fold wins over a wide viewport", () => {
    mediaMatches = true;
    localStorage.setItem("tracker.detailsFolded", "1");
    render(<StreamViewBody view={view()} />);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("counts every tool call in the view, rising as more arrive", () => {
    const { rerender } = render(
      <StreamViewBody view={view({ turns: [turn(1, { closed: true, calls: [call()] }), turn(2, { calls: [call()] })] })} />,
    );
    expect(toolCalls(screen.getByRole("complementary", { name: "Details" }))).toBe(2);
    rerender(
      <StreamViewBody view={view({ turns: [turn(1, { closed: true, calls: [call()] }), turn(2, { calls: [call(), call()] })] })} />,
    );
    expect(toolCalls(screen.getByRole("complementary", { name: "Details" }))).toBe(3);
  });

  it("lists failed calls only when there is one", () => {
    const { rerender } = render(
      <StreamViewBody view={view({ turns: [turn(1, { calls: [call({ ok: false }), call()] })] })} />,
    );
    expect(within(screen.getByRole("complementary", { name: "Details" })).getByText(/failed/i)).toBeTruthy();
    rerender(<StreamViewBody view={view({ turns: [turn(1, { calls: [call(), call()] })] })} />);
    expect(
      within(screen.getByRole("complementary", { name: "Details" })).queryByText(/failed/i),
    ).toBeNull();
  });

  it("shows no summary or end note in the conversation while the run is going", () => {
    const v = view({
      turns: [turn(1, { closed: true, reply: "done" })],
      summary: summary({ finished: false, elapsed: "5s", turns: "2 of 4", cached: 10, load: 15 }),
    });
    render(<StreamViewBody view={v} />);
    const conversation = screen.getByRole("list", { name: "Conversation" });
    expect(within(conversation).queryByText("Summary")).toBeNull();
    expect(conversation.querySelector("[data-from=end]")).toBeNull();
    expect(conversation.textContent).not.toMatch(/in 5s/);
  });

  it("keeps the one-line end note in the conversation and the figures in the bar", () => {
    const v = view({
      row: row({ state: "ok" }),
      turns: [turn(1, { closed: true, reply: "answer" })],
      summary: summary({
        finished: true,
        ok: true,
        elapsed: "5s",
        turns: "1 of 2",
        cached: 10,
        reuse: "61%",
        returned: 100,
        load: 200,
        toolTime: "1m",
        finishReason: "stop",
        shellCalls: 4,
      }),
    });
    render(<StreamViewBody view={v} />);
    const conversation = screen.getByRole("list", { name: "Conversation" });
    expect(conversation.textContent).toMatch(/Finished in 5s/);
    expect(conversation.textContent).toMatch(/1 of 2 turns/);
    expect(within(conversation).queryByText(/load/i)).toBeNull();
    expect(within(conversation).queryByText(/returned/i)).toBeNull();
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).getByText(/load/i)).toBeTruthy();
    expect(within(aside).getByText(/returned/i)).toBeTruthy();
  });

  it("reaches the same details through a native details element on a phone", () => {
    const { container } = render(
      <StreamViewBody view={view({ turns: [turn(1, { calls: [call()] })] })} />,
    );
    const phone = Array.from(container.querySelectorAll("details")).find((el) =>
      el.className.includes("lg:hidden"),
    );
    expect(phone).toBeTruthy();
    expect(phone!.querySelector("summary")?.textContent).toContain("Details");
    expect(within(phone as HTMLElement).getByText(/Tool calls/i)).toBeTruthy();
  });

  // The bar shows only on a wide screen, so the button that folds it shows only there; a phone
  // has the fold under the title instead of a second, inert Details control.
  it("shows the header's Details button only where the bar can show", () => {
    render(<StreamViewBody view={view({})} />);
    const classes = screen.getByRole("button", { name: "Details" }).className.split(/\s+/);
    expect(classes).toContain("hidden");
    expect(classes).toContain("lg:inline-flex");
  });

  // A phone has room for the title only on several lines; a wide screen cuts it to one.
  it("wraps the title on a phone and cuts it to one line only on a wide screen", () => {
    render(<StreamViewBody view={view({})} />);
    const classes = screen.getByRole("heading", { level: 2 }).className.split(/\s+/);
    expect(classes).toContain("lg:truncate");
    expect(classes).not.toContain("truncate");
  });
});

describe("the bar, after review", () => {
  it("spans the Turns block across the bar's width", () => {
    const v = view({ row: row({ turns: "2 of 4" }) });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const bar = within(aside).getByRole("progressbar", { name: "Turns" });
    const wrapper = bar.parentElement as HTMLElement;
    const classes = wrapper.className.split(/\s+/);
    expect(classes).toContain("w-full");
    expect(classes).not.toContain("w-56");
    expect(within(aside).getByText("Turns")).toBeTruthy();
    expect(within(aside).getByText("2 of 4")).toBeTruthy();
  });

  it("shows a Cache hits row holding the reuse figure", () => {
    const v = view({
      row: row({ state: "ok" }),
      turns: [turn(1, { closed: true, reply: "answer" })],
      summary: summary({ finished: true, reuse: "61%" }),
    });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const dt = within(aside).getByText("Cache hits");
    expect(dt.nextElementSibling?.textContent).toBe("61%");
  });

  it("counts the extra attempts across closed turns as Retries", () => {
    const v = view({
      turns: [
        turn(1, { closed: true, attempts: 2 }),
        turn(2, { closed: true, attempts: null }),
        turn(3, { closed: true, attempts: 3 }),
      ],
    });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const dt = within(aside).getByText("Retries");
    expect(dt.nextElementSibling?.textContent).toBe("3");
  });

  it("has no Retries row when no turn is closed", () => {
    const v = view({
      turns: [turn(1, { attempts: 2 }), turn(2, { attempts: 3 })],
    });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).queryByText(/Retries/)).toBeNull();
  });

  it("is a card that sticks where it sits", () => {
    render(<StreamViewBody view={view()} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const classes = aside.className.split(/\s+/);
    expect(classes).toContain("lg:top-[73px]");
    expect(classes).toContain("bg-card");
    expect(classes).toContain("rounded-xl");
    expect(classes).toContain("border");
  });
});
