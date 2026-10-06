// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyPatch } from "../../src/web/useStreamView.ts";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, ViewPatch, TurnView, CallView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

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
    workspace: null,
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
    reasonedFor: null,
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

function patch(overrides: Partial<ViewPatch> = {}): ViewPatch {
  return {
    name: "stream-1",
    seq: 1,
    row: row(),
    waiting: null,
    turns: [],
    summary: null,
    ...overrides,
  };
}

describe("applyPatch", () => {
  it("applies the next seq and replaces the turn at its index", () => {
    const held = view({ seq: 1, turns: [turn(1), turn(2)] });
    const result = applyPatch(
      held,
      patch({ seq: 2, turns: [{ index: 1, turn: turn(2, { reply: "replacement" }) }] }),
    );
    expect(result).not.toBe("refetch");
    expect(result).not.toBe("ignore");
    const next = result as StreamView;
    expect(next.seq).toBe(2);
    expect(next.turns[1].reply).toBe("replacement");
    expect(next.turns[0].reply).toBeNull();
  });

  it("appends a turn at an index equal to the current length", () => {
    const held = view({ seq: 1, turns: [turn(1)] });
    const result = applyPatch(held, patch({ seq: 2, turns: [{ index: 1, turn: turn(2) }] })) as StreamView;
    expect(result.turns).toHaveLength(2);
    expect(result.turns[1].n).toBe(2);
  });

  it("refetches when an index is past the end", () => {
    const held = view({ seq: 1, turns: [turn(1)] });
    expect(applyPatch(held, patch({ seq: 2, turns: [{ index: 2, turn: turn(3) }] }))).toBe("refetch");
  });

  it("refetches on a seq gap", () => {
    const held = view({ seq: 1, turns: [] });
    expect(applyPatch(held, patch({ seq: 3, turns: [] }))).toBe("refetch");
  });

  it("ignores a stale or duplicate seq", () => {
    const held = view({ seq: 5, turns: [] });
    expect(applyPatch(held, patch({ seq: 5, turns: [] }))).toBe("ignore");
    expect(applyPatch(held, patch({ seq: 4, turns: [] }))).toBe("ignore");
  });

  it("does not mutate the held view", () => {
    const held = view({ seq: 1, turns: [turn(1)] });
    const before = held.turns;
    const result = applyPatch(
      held,
      patch({ seq: 2, turns: [{ index: 0, turn: turn(1, { reply: "changed" }) }] }),
    ) as StreamView;
    expect(held.turns).toBe(before);
    expect(held.turns[0].reply).toBeNull();
    expect(result.turns).not.toBe(before);
    expect(result.turns[0].reply).toBe("changed");
  });

  it("appends the patch partial onto the held turn's partial", () => {
    const held = view({
      seq: 1,
      turns: [turn(1, { partial: { reasoning: "thinking", answer: "hello" } })],
    });
    const result = applyPatch(
      held,
      patch({
        seq: 2,
        turns: [{ index: 0, turn: turn(1, { partial: { reasoning: " hard", answer: " world" } }), append: true }],
      }),
    ) as StreamView;
    expect(result.turns[0].partial).toEqual({ reasoning: "thinking hard", answer: "hello world" });
  });

  it("refetches when appending onto a held turn with a null partial", () => {
    const held = view({ seq: 1, turns: [turn(1)] });
    expect(
      applyPatch(
        held,
        patch({
          seq: 2,
          turns: [{ index: 0, turn: turn(1, { partial: { reasoning: "x", answer: "y" } }), append: true }],
        }),
      ),
    ).toBe("refetch");
  });

  it("refetches when appending onto a missing turn index", () => {
    const held = view({ seq: 1, turns: [] });
    expect(
      applyPatch(
        held,
        patch({
          seq: 2,
          turns: [{ index: 0, turn: turn(1, { partial: { reasoning: "x", answer: "y" } }), append: true }],
        }),
      ),
    ).toBe("refetch");
  });

  it("does not mutate the held view when appending", () => {
    const held = view({
      seq: 1,
      turns: [turn(1, { partial: { reasoning: "thinking", answer: "hello" } })],
    });
    const before = held.turns;
    const result = applyPatch(
      held,
      patch({
        seq: 2,
        turns: [{ index: 0, turn: turn(1, { partial: { reasoning: " hard", answer: " world" } }), append: true }],
      }),
    ) as StreamView;
    expect(held.turns).toBe(before);
    expect(held.turns[0].partial).toEqual({ reasoning: "thinking", answer: "hello" });
    expect(result.turns).not.toBe(before);
    expect(result.turns[0].partial).toEqual({ reasoning: "thinking hard", answer: "hello world" });
  });
});

describe("StreamViewBody", () => {
  afterEach(cleanup);

  it("shows the reply, the refusal message in full, omits null fields, and colors failures red", () => {
    const v = view({
      task: "Do the thing",
      turns: [
        turn(1, {
          reply: "Here is the answer",
          calls: [call({ name: "read_file", ok: false, message: "Refused: not allowed" })],
        }),
      ],
      summary: {
        finished: true,
        ok: true,
        elapsed: "5s",
        turns: "1 of 2",
        cached: null,
        reuse: "61%",
        returned: 100,
        load: 200,
        failures: 2,
        toolTime: "1m",
        finishReason: "stop",
        error: null,
        shellCalls: null,
      },
    });
    render(<StreamViewBody view={v} />);

    expect(screen.getByText("Here is the answer")).toBeTruthy();
    expect(screen.getByText("Refused: not allowed")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("null")).toBeNull();
    const failures = within(screen.getByRole("complementary", { name: "Details" })).getByText(/^Failures$/);
    expect(failures.className).toContain("text-hot");
  });

  it("shows a turn's repeated output share as a marker and its evicted tool results in the fold", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { closed: true, repeated: "23%", evicted: 0 })] })} />);
    const marker = screen.getByRole("status");
    expect(marker.textContent).toBe("reply repeats 23%");
    expect(screen.queryByText("tool results evicted 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn details" }));
    expect(screen.getByText("tool results evicted 0")).toBeTruthy();
  });

  it("leaves both out when the view has none", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { closed: true })] })} />);
    expect(screen.queryByText(/repeated output/)).toBeNull();
    expect(screen.queryByText(/tool results evicted/)).toBeNull();
  });

  it("shows the shell count in the summary when there is one", () => {
    const summary = {
      finished: true, ok: true, elapsed: "5s", turns: null, cached: null, reuse: null, returned: null,
      load: null, failures: null, toolTime: null, finishReason: null, error: null, shellCalls: 4,
    };
    const aside = () => screen.getByRole("complementary", { name: "Details" });
    const { unmount } = render(<StreamViewBody view={view({ summary })} />);
    expect(within(aside()).getByText(/shell calls/i)).toBeTruthy();
    unmount();
    render(<StreamViewBody view={view({ summary: { ...summary, shellCalls: null } })} />);
    expect(within(aside()).queryByText(/shell calls/i)).toBeNull();
  });

  it("shows an open turn's partial answer and folds its reasoning away", () => {
    const v = view({
      turns: [
        turn(1, {
          partial: { reasoning: "thinking hard", answer: "The loop retries" },
        }),
      ],
    });
    render(<StreamViewBody view={v} />);

    expect(screen.getByText("The loop retries")).toBeTruthy();
    const reasoning = screen.getByText("thinking hard");
    const details = reasoning.closest("details");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText(/^Thinking · /).closest("details")).toBe(details);
  });

  it("shows the final reply and no writing label for a closed turn", () => {
    const v = view({
      turns: [turn(1, { closed: true, reply: "final answer" })],
    });
    render(<StreamViewBody view={v} />);

    expect(screen.getByText("final answer")).toBeTruthy();
    expect(screen.queryByText("writing…")).toBeNull();
  });
});

describe("long values on a phone", () => {
  afterEach(cleanup);
  const LONG = "/w/" + "a_very_long_directory_name_".repeat(6) + "file.py";

  it("an argument is cut to one line, and one tap shows all of it", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { calls: [call({ args: [["path", LONG]] })] })] })} />);
    const summary = screen.getByText(LONG);
    const toggle = summary.closest("button");
    expect(toggle).not.toBeNull();
    expect(summary.className).toMatch(/\btruncate\b/);
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle!);
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(`path: ${LONG}`)).toBeTruthy();
  });

  it("a file path is clamped to two lines, with the full path on hover and focus", () => {
    render(<StreamViewBody view={view({ files: [{ path: LONG, size: "1.2 KB", skipped: null }] })} />);
    const summary = screen.getByText(LONG);
    expect(summary.className).toMatch(/\bline-clamp-2\b/);
    expect(summary.className).toMatch(/\bbreak-all\b/);
    expect(summary.getAttribute("title")).toBe(LONG);
    expect(summary.getAttribute("tabindex")).toBe("0");
  });
});
