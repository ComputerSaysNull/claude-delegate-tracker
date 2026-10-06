// @vitest-environment jsdom
// A turn's thinking is a fold labelled with its character count: a closed turn's comes from
// turn.thinking.chars, an open turn's from turn.partial.reasoning.length. A finished turn's text
// is fetched once when the reader opens the fold; an open turn's is shown directly. An incomplete
// turn's fold says the last moments of thinking may be missing; a completed one does not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, TurnView } from "../../src/server/view.ts";
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
    n, heading: `turn ${n}`, budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null,
    thinking: null, toolTime: null, attempts: null, repeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, question: null, answer: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: null, files: [], waiting: null, turns: [], summary: null, ...overrides };
}

const TEXT = "Look at the file.";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: TEXT }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a turn's thinking", () => {
  it("shows a closed turn's thinking as a fold labelled by its character count", () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("does not show the thinking text or fetch until the fold opens", async () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, {}), turn(2, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    const fold = summary.closest("details")!;
    expect(fold.textContent).not.toContain(TEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(await screen.findByText(TEXT)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/streams/${encodeURIComponent("stream-1")}/thinking/2`);
  });

  it("fetches the thinking only once when the fold opens repeatedly", async () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    const fold = summary.closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    await screen.findByText(TEXT);
    fold.open = false;
    fireEvent(fold, new Event("toggle"));
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a failure message when the fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    const fold = summary.closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(await screen.findByText("Could not load the thinking.")).toBeTruthy();
  });

  it("tries again when the fold is opened after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const fold = screen.getByText("Thinking · 17 characters").closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(await screen.findByText("Could not load the thinking.")).toBeTruthy();
    fold.open = false;
    fireEvent(fold, new Event("toggle"));
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(await screen.findByText("Look at the file.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("notes that the last moments of thinking may be missing while incomplete", async () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: false } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    const fold = summary.closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    await screen.findByText(TEXT);
    expect(fold.textContent).toContain(
      "The last moments of thinking before the turn ended may be missing.",
    );
  });

  it("drops the note once thinking completed", async () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: true } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters");
    const fold = summary.closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    await screen.findByText(TEXT);
    expect(fold.textContent).not.toContain(
      "The last moments of thinking before the turn ended may be missing.",
    );
  });

  it("draws no thinking fold for a closed turn without thinking", () => {
    render(<StreamViewBody view={view({ turns: [turn(1)] })} />);
    expect(screen.queryByText(/^Thinking/)).toBeNull();
  });

  it("labels an open turn's thinking by the reasoning written so far and shows it directly", () => {
    const reasoning = "x".repeat(1240);
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { closed: false, partial: { reasoning, answer: "" } })] })}
      />,
    );
    expect(screen.getByText("Thinking · 1,240 characters")).toBeTruthy();
    expect(screen.getByText(reasoning)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Tailwind draws an icon as a block, so without a flex row the chevron and the label each
  // took a line, under the browser's own marker.
  it("keeps the fold's chevron and label on one line, with no second marker", () => {
    render(
      <StreamViewBody
        view={view({ turns: [turn(1, { thinking: { chars: 17, complete: true } })] })}
      />,
    );
    const summary = screen.getByText("Thinking · 17 characters").closest("summary")!;
    const classes = summary.className.split(/\s+/);
    expect(classes).toContain("flex");
    expect(classes).toContain("list-none");
    expect(classes).toContain("[&::-webkit-details-marker]:hidden");
  });
});
