// @vitest-environment jsdom
// The conversation reads as a chat between two sides, with compact tool rows that open for detail.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { CallView, StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1", state: "live", why: null, age: null, kind: "read_file", model: "flash", effort: null,
    title: "Find every caller of load_config", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, ...overrides,
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

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: "Find every place that calls load_config()", files: [], waiting: null, turns: [], summary: null, ...overrides };
}

const message = (from: string) => document.querySelectorAll(`[data-from="${from}"]`);

afterEach(cleanup);

describe("the two sides", () => {
  // A capped column left bands of empty space beside it; the pane is the column.
  it("lets the conversation fill the pane, with no cap leaving empty bands beside it", () => {
    render(<StreamViewBody view={view()} />);
    const classes = screen.getByRole("list", { name: "Conversation" }).className.split(/\s+/);
    expect(classes).toContain("w-full");
    expect(classes.filter((c) => c.startsWith("max-w-"))).toEqual([]);
  });

  // Content-sized bubbles left a short tool call in a narrow sliver; every turn is as wide.
  it("gives every delegation bubble the same width, 88% of the column", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, { closed: true, calls: [call({ name: "read_file" })] }),
            turn(2, { closed: true, reply: "A much longer reply that would have made its bubble wider." }),
          ],
        })}
      />,
    );
    for (const li of message("delegation")) {
      const classes = li.querySelector("[data-bubble]")!.className.split(/\s+/);
      expect(classes).toContain("w-[88%]");
      expect(classes).not.toContain("max-w-[88%]");
    }
  });

  it("bubbles each turn on the left and keeps the task on the right", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [turn(1, { calls: [call({ name: "read_file" })], reply: "done" })],
        })}
      />,
    );
    const [delegation] = message("delegation");
    const bubble = delegation.querySelector("[data-bubble]")!;
    expect(bubble.className).toMatch(/\bmr-auto\b/);
    expect(bubble.className.split(/\s+/)).toContain("w-[88%]");
    expect(bubble.className).toMatch(/\brounded-2xl\b/);
    expect(bubble.querySelector('[aria-label="Tool calls"]')).not.toBeNull();
    expect(bubble.textContent).toContain("done");
    const [caller] = message("caller");
    expect(caller.className).toMatch(/\bml-auto\b/);
  });

  it("shows a call's main argument by value and joins its figures with ' · '", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              calls: [
                call({
                  name: "read_file",
                  result: "40 lines · 1.2 KB",
                  time: "<1s",
                  exitCode: 1,
                  args: [["path", "/w/proj/backoff.py"], ["start_line", "1"]],
                }),
              ],
            }),
          ],
        })}
      />,
    );
    const [row] = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(row.textContent).toContain("/w/proj/backoff.py");
    expect(row.textContent).not.toContain("path:");
    expect(row.textContent).not.toContain("start_line");
    expect(row.textContent).toContain("40 lines · 1.2 KB · <1s");
    expect(row.textContent).toContain("exit 1");
  });

  it("opens a call to show every argument with its key", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              calls: [call({ name: "read_file", args: [["path", "/w/proj/backoff.py"], ["start_line", "1"]] })],
            }),
          ],
        })}
      />,
    );
    const [row] = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    const toggle = within(row).getByRole("button", { name: /read_file/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(row.textContent).not.toContain("start_line: 1");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("start_line: 1");
    expect(row.textContent).toContain("path: /w/proj/backoff.py");
  });

  it("shows a refusal's message without opening the call", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [turn(1, { calls: [call({ name: "read_file", ok: false, message: "Refused: the path is outside the workspace roots" })] })],
        })}
      />,
    );
    const [row] = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(row.textContent).toContain("Refused: the path is outside the workspace roots");
  });

  it("keeps the tool name from breaking inside the word", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ name: "read_file" })] })] })} />);
    const [row] = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(within(row).getByText("read_file").className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it("draws no empty bubble for a turn whose only call was its question", () => {
    const { container } = render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              question: { questions: ["Which file?"] },
              calls: [call({ name: "ask_caller" })],
            }),
          ],
        })}
      />,
    );
    expect(container.querySelector('[data-from="delegation"] [data-bubble]')).toBeNull();
    expect(screen.getByRole("note", { name: "Question for the caller" })).toBeTruthy();
  });

  it("does not draw an ask_caller call as a tool row once the turn has a question", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              question: { questions: ["Proceed on your best reading?"] },
              calls: [call({ name: "ask_caller" }), call({ name: "read_file" })],
            }),
          ],
        })}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("read_file");
    expect(rows[0].textContent).not.toContain("ask_caller");
  });

  it("still draws an ask_caller call when the turn has no question", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ name: "ask_caller" })] })] })} />);
    const rows = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("ask_caller");
  });

  it("folds the budget and the evicted counts behind a Turn details toggle", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [
            turn(1, {
              budget: "turn 1 · max_tokens 8192 · cap 16384 · 2 running",
              evicted: 0,
              tokensIn: 1800,
              tokensOut: 120,
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByText("turn 1 · max_tokens 8192 · cap 16384 · 2 running")).toBeNull();
    expect(screen.queryByText("tool results evicted 0")).toBeNull();
    expect(screen.getByText("1.8k in · 120 out")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Turn details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("turn 1 · max_tokens 8192 · cap 16384 · 2 running")).toBeTruthy();
    expect(screen.getByText("tool results evicted 0")).toBeTruthy();
  });

  it("clamps and titles each file chip so a long path is readable and reachable", () => {
    render(
      <StreamViewBody
        view={view({
          files: [{ path: "deploy/settings.py", size: "6.8 KB", skipped: null }],
        })}
      />,
    );
    const chip = screen.getByText("deploy/settings.py");
    expect(chip.className).toMatch(/\bline-clamp-2\b/);
    expect(chip.getAttribute("title")).toBe("deploy/settings.py");
    expect(chip.getAttribute("tabindex")).toBe("0");
  });
});
