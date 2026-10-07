// @vitest-environment jsdom
// One delegation read as a conversation: the task as the caller's message, each turn as the
// delegation's message, a header that stays on screen, and an end note. The view follows
// the growing reply unless the reader has scrolled up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { CallView, StreamView, SummaryView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";
import { localTime } from "../../src/web/time.ts";

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1", state: "live", why: null, age: null, kind: "read_file", model: "flash", effort: null,
    title: "Find every caller of load_config", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, workspace: null, ...overrides,
  };
}

function turn(n: number, overrides: Partial<TurnView> = {}): TurnView {
  return {
    n, heading: `turn ${n}`, budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null, retries: [],
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, question: null, answer: null, ...overrides,
  };
}

function call(overrides: Partial<CallView> = {}): CallView {
  return { name: "read_file", ok: true, outcome: null, status: null, args: [], message: null, result: null, exitCode: null, time: null, ...overrides };
}

function summary(overrides: Partial<SummaryView> = {}): SummaryView {
  return {
    finished: true, ok: true, elapsed: "4m02s", turns: "2 of 8", cached: null, reuse: null, returned: null,
    load: null, failures: null, toolTime: null, finishReason: null, error: null, shellCalls: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: "Find every place that calls load_config()", files: [], waiting: null, turns: [], summary: null, ...overrides };
}

const message = (from: string) => document.querySelectorAll(`[data-from="${from}"]`);

afterEach(cleanup);

describe("the conversation", () => {
  it("shows the task as the caller's message, with the files it was given or refused", () => {
    render(
      <StreamViewBody
        view={view({
          files: [
            { path: "deploy/settings.py", size: "6.8 KB", skipped: null },
            { path: "secrets/.env", size: null, skipped: "refused: not allowed" },
          ],
        })}
      />,
    );
    const [caller] = message("caller");
    expect(caller.textContent).toContain("Find every place that calls load_config()");
    expect(caller.textContent).toContain("deploy/settings.py");
    expect(caller.textContent).toContain("refused: not allowed");
  });

  it("shows each turn as the delegation's own message", () => {
    render(<StreamViewBody view={view({ turns: [turn(1), turn(2)] })} />);
    expect(message("delegation")).toHaveLength(2);
  });

  it("folds the open turn's thinking away", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { closed: false, partial: { reasoning: "weighing the wrappers", answer: "" } })] })} />);
    const fold = screen.getByText(/^Thinking · /).closest("details")!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain("weighing the wrappers");
  });

  it("shows each tool call as one compact row with its outcome", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              calls: [
                call({ name: "search_files", ok: true, result: "23 matches", args: [["pattern", "load_config("]] }),
                call({ name: "read_file", ok: false, message: "Refused: the path is outside the workspace roots" }),
              ],
            }),
          ],
        })}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByLabelText("succeeded")).toBeTruthy();
    expect(within(rows[1]).getByLabelText("failed")).toBeTruthy();
    expect(rows[1].textContent).toContain("Refused: the path is outside the workspace roots");
  });

  it("shows a turn's text above its tool calls, in the order the model wrote them", () => {
    const said = turn(1, { reply: "Let me check the schema:", calls: [call({ args: [["path", "schema.py"]] })] });
    render(<StreamViewBody view={view({ turns: [said] })} />);
    const text = screen.getByText("Let me check the schema:");
    const tools = screen.getByRole("list", { name: "Tool calls" });
    expect(text.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names a call's file and the lines it read, with the whole path on hover", () => {
    const args: [string, string][] = [["path", "/w/proj/server.py"], ["start_line", "596"], ["end_line", "630"]];
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ args })] })] })} />);
    const arg = screen.getByText("server.py · start 596 end 630");
    expect(arg.getAttribute("title")).toBe("/w/proj/server.py");
  });

  it("names a call's file alone when it gives no lines, and a call without a path by its first argument", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [
      call({ args: [["path", "C:\\w\\proj\\notes.md"]] }),
      call({ name: "run_bash", args: [["command", "npm test"], ["timeout", "60"]] }),
    ] })] })} />);
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
  });

  it("cuts a call's arguments to one line, all of them one tap away", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ args: [["path", "a/very/long/path.py"]] })] })] })} />);
    const arg = screen.getByText("path.py");
    expect(arg.className).toMatch(/\btruncate\b/);
    const toggle = screen.getByRole("button", { name: /read_file/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("path: a/very/long/path.py")).toBeTruthy();
  });

  it("closes a turn with a small line of its figures", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { tokensIn: 5100, tokensOut: 160, tokS: 40.2, toolTime: "1s" })] })} />);
    expect(screen.getByText(`5.1k in · 160 out · ${(40.2).toLocaleString()} tok/s · tool 1s`)).toBeTruthy();
  });

  it("leaves a figure it does not have out of that line, never as 0", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { tokensOut: 160 })] })} />);
    expect(screen.getByText("160 out")).toBeTruthy();
  });

  it("shows the open turn's answer as it is written", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { closed: false, partial: { reasoning: "", answer: "There are fourteen direct callers" } })] })} />);
    expect(message("delegation")[0].textContent).toContain("There are fourteen direct callers");
  });

  it("ends a finished run with a note saying so", () => {
    render(<StreamViewBody view={view({ row: row({ state: "ok" }), summary: summary() })} />);
    const [end] = message("end");
    expect(end.textContent).toMatch(/Finished/);
    expect(end.textContent).toContain("4m02s");
  });

  it("ends a failed run with a note giving the error", () => {
    render(<StreamViewBody view={view({ row: row({ state: "failed" }), summary: summary({ ok: false, error: "backend unreachable" }) })} />);
    const [end] = message("end");
    expect(end.textContent).toMatch(/Failed/);
    expect(screen.getByRole("complementary", { name: "Details" }).textContent).toContain("backend unreachable");
  });

  it("heads each turn with the model, its number and when it started", () => {
    const at = "2026-10-04T17:04:00.000Z";
    render(<StreamViewBody view={view({ turns: [turn(1, { at })] })} />);
    const [msg] = message("delegation");
    expect(msg.textContent).toContain(`flash · turn 1 · ${localTime(at)}`);
  });

  it("puts a call's main argument on the same line as its name", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ name: "read_file", args: [["path", "src/dates.py"]] })] })] })} />);
    const name = within(screen.getByRole("list", { name: "Tool calls" })).getByText("read_file");
    expect(name.parentElement!.textContent).toContain("dates.py");
  });

  it("writes large token counts short, as 4.6k", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { tokensIn: 4600, tokensOut: 1_250_000 })] })} />);
    expect(screen.getByText("4.6k in · 1.3M out")).toBeTruthy();
  });

  it("sums a finished run up on one line: how it ended, how long, its turns and its cache use", () => {
    render(<StreamViewBody view={view({ row: row({ state: "ok" }), summary: summary({ turns: "2 of 8", reuse: "71%" }) })} />);
    const [end] = message("end");
    expect(end.firstElementChild!.textContent).toBe("Finished in 4m02s · 2 of 8 turns · 71% cached");
  });

  it("offers no jump back once the run has ended, even when scrolled up", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 4000, configurable: true });
    render(<StreamViewBody view={view({ row: row({ state: "ok" }), summary: summary() })} />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    scrollTo.mockRestore();
  });

  it("ends a stopped run with a note saying it was stopped, not failed", () => {
    render(<StreamViewBody view={view({ row: row({ state: "stopped" }), summary: summary({ ok: false, error: "cancelled" }) })} />);
    const [end] = message("end");
    expect(end.textContent).toMatch(/^Stopped/);
    expect(end.textContent).not.toMatch(/Failed/);
  });

  it("ends a timed-out run with a note saying so", () => {
    render(<StreamViewBody view={view({ row: row({ state: "timed out" }), summary: summary({ ok: false }) })} />);
    expect(message("end")[0].textContent).toMatch(/^Timed out/);
  });

  it("has no copy buttons", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { reply: "done" })], summary: summary() })} />);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});

describe("a question to the caller", () => {
  const asked = turn(1, { closed: false, question: { questions: ["Should I count the vendored callers?"] } });

  it("shows the question as a highlighted message from the delegation, waiting and for how long", () => {
    render(<StreamViewBody view={view({ row: row({ state: "asking", age: "48s" }), turns: [asked] })} />);
    const note = screen.getByRole("note", { name: "Question for the caller" });
    expect(note.textContent).toContain("Should I count the vendored callers?");
    expect(note.textContent).toContain("Waiting for an answer · 48s");
    expect(note.closest('[data-from="delegation"]')).not.toBeNull();
  });

  it("shows the caller's answer as the caller's message, and stops waiting", () => {
    const answered = turn(1, { closed: false, question: asked.question, answer: { text: "Leave them out", waited: "48s", bestReading: false, by: null } });
    render(<StreamViewBody view={view({ row: row({ state: "live" }), task: null, turns: [answered] })} />);
    const [reply] = document.querySelectorAll('[data-from="caller"]');
    expect(reply.textContent).toContain("Leave them out");
    expect(reply.textContent).toContain("48s");
    expect(screen.getByRole("note", { name: "Question for the caller" }).textContent).not.toContain("Waiting for an answer");
  });

  it("says in the question how long the answer took, once it came", () => {
    const answered = turn(1, { question: asked.question, answer: { text: "Leave them out", waited: "1m12s", bestReading: false, by: null } });
    render(<StreamViewBody view={view({ task: null, turns: [answered] })} />);
    expect(screen.getByRole("note", { name: "Question for the caller" }).textContent).toContain("Answered after 1m12s");
  });

  it("marks a question still waiting with a pulsing dot", () => {
    render(<StreamViewBody view={view({ row: row({ state: "asking", age: "48s" }), turns: [asked] })} />);
    expect(screen.getByRole("note", { name: "Question for the caller" }).querySelector(".animate-pulse")).not.toBeNull();
  });

  it("says when the caller left the choice to the delegation", () => {
    const answered = turn(1, { question: asked.question, answer: { text: "Proceed on your best reading.", waited: "1m01s", bestReading: true, by: null } });
    render(<StreamViewBody view={view({ task: null, turns: [answered] })} />);
    expect(document.querySelector('[data-from="caller"]')!.textContent).toMatch(/left the choice to the delegation/);
  });

  it("does not claim to be waiting once the run has stopped", () => {
    render(<StreamViewBody view={view({ row: row({ state: "failed" }), turns: [asked] })} />);
    expect(screen.getByRole("note", { name: "Question for the caller" }).textContent).not.toContain("Waiting for an answer");
  });
});

describe("the header", () => {
  it("stays on screen and names the state and the title", () => {
    render(<StreamViewBody view={view()} />);
    const header = screen.getByRole("banner");
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.textContent).toContain("Running");
    expect(header.textContent).toContain("Find every caller of load_config");
  });

  it("draws the turns as segments, as the list does", () => {
    render(<StreamViewBody view={view({ row: row({ turns: "2 of 8" }) })} />);
    const bar = within(screen.getByRole("complementary", { name: "Details" })).getByRole("progressbar", { name: "Turns" });
    expect(bar.children).toHaveLength(8);
  });

  it("shows the turns as a bar", () => {
    render(<StreamViewBody view={view({ row: row({ turns: "2 of 8" }) })} />);
    const bar = within(screen.getByRole("complementary", { name: "Details" })).getByRole("progressbar", { name: "Turns" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["2", "8"]);
  });

  it("shows the time used as a bar, with the time left", () => {
    render(<StreamViewBody view={view({ row: row({ left: "7m10s" }), turns: [turn(1, { closed: false, clock: { elapsed: 170, of: 600 } })] })} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const bar = within(aside).getByRole("progressbar", { name: "Time" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["170", "600"]);
    expect(aside.textContent).toContain("7m10s left");
  });

  it("takes the time bar from the open turn, the last one", () => {
    render(<StreamViewBody view={view({ turns: [turn(1), turn(2, { closed: false, clock: { elapsed: 300, of: 600 } })] })} />);
    const bar = within(screen.getByRole("complementary", { name: "Details" })).getByRole("progressbar", { name: "Time" });
    expect(bar.getAttribute("aria-valuenow")).toBe("300");
  });

  it("shows the open turn's heartbeat", () => {
    render(<StreamViewBody view={view({ turns: [turn(1), turn(2, { closed: false, heartbeat: "12 chunks · ends in 9m" })] })} />);
    expect(screen.getByRole("complementary", { name: "Details" }).textContent).toContain("12 chunks · ends in 9m");
  });

  it("drops the time bar and the heartbeat once the run has ended, even mid-turn", () => {
    // A run stopped during a turn never closes it, so that turn keeps its clock and heartbeat.
    const stopped = view({
      row: row({ state: "failed" }),
      turns: [turn(1, { closed: false, clock: { elapsed: 300, of: 600 }, heartbeat: "12 chunks · ends in 5m" })],
      summary: summary({ ok: false, error: "cancelled" }),
    });
    render(<StreamViewBody view={stopped} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).queryByRole("progressbar", { name: "Time" })).toBeNull();
    expect(aside.textContent).not.toContain("ends in 5m");
  });

  it("shows no bars for a run that has none", () => {
    render(<StreamViewBody view={view({ row: row({ state: "ok" }) })} />);
    expect(within(screen.getByRole("complementary", { name: "Details" })).queryByRole("progressbar")).toBeNull();
  });
});

describe("following the reply", () => {
  let scrollTo: ReturnType<typeof vi.spyOn>;
  const setScroll = (y: number, height: number) => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: height, configurable: true });
  };

  beforeEach(() => {
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setScroll(1200, 2000);
  });

  afterEach(() => scrollTo.mockRestore());

  const grow = (text: string) => view({ turns: [turn(1, { closed: false, partial: { reasoning: "", answer: text } })] });

  it("keeps the newest text in sight while the reader is at the bottom", () => {
    const { rerender } = render(<StreamViewBody view={grow("one")} />);
    scrollTo.mockClear();
    rerender(<StreamViewBody view={grow("one two")} />);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("stops following once the reader scrolls up, and offers a way back", () => {
    const { rerender } = render(<StreamViewBody view={grow("one")} />);
    setScroll(200, 2000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();
    rerender(<StreamViewBody view={grow("one two")} />);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("offers no way back while already following", () => {
    render(<StreamViewBody view={grow("one")} />);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });
});

// On a desktop the detail pane scrolls itself and the window does not move at all, so
// following must watch and scroll the pane (plans#55).
describe("following the reply in a pane that scrolls itself", () => {
  let windowScrollTo: ReturnType<typeof vi.spyOn>;
  const grow = (text: string) => view({ turns: [turn(1, { closed: false, partial: { reasoning: "", answer: text } })] });
  const inPane = (v: StreamView) => (
    <div data-testid="pane" style={{ overflowY: "auto" }}>
      <StreamViewBody view={v} />
    </div>
  );
  const pane = () => {
    const el = screen.getByTestId("pane");
    Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 800, configurable: true });
    return el;
  };

  beforeEach(() => {
    windowScrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => windowScrollTo.mockRestore());

  it("keeps the newest text in sight by scrolling the pane, not the window", () => {
    const { rerender } = render(inPane(grow("one")));
    const el = pane();
    el.scrollTop = 1200;
    vi.mocked(el.scrollTo).mockClear();
    windowScrollTo.mockClear();
    rerender(inPane(grow("one two")));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000 });
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it("stops following when the reader scrolls the pane up, and Jump to latest scrolls the pane", () => {
    const { rerender } = render(inPane(grow("one")));
    const el = pane();
    el.scrollTop = 200;
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    vi.mocked(el.scrollTo).mockClear();
    rerender(inPane(grow("one two")));
    expect(el.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000 });
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });
});
