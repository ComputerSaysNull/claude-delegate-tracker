// @vitest-environment jsdom
// Replies, tasks and thinking are Markdown: rendered as formatted text with tables, with raw
// HTML shown as text and never run, images shown as links and never loaded, and links that
// open in a new tab without handing over this page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Markdown } from "../../src/web/Markdown.tsx";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders headings, lists, emphasis, inline code and code blocks", () => {
    const { container } = render(
      <Markdown text={"# Callers\n\nThere are **fourteen** and *three* wrappers.\n\n- one\n- two\n\nUse `load_config()`:\n\n```py\nload_config(path)\n```"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Callers");
    expect(container.querySelector("strong")?.textContent).toBe("fourteen");
    expect(container.querySelector("em")?.textContent).toBe("three");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("p code")?.textContent).toBe("load_config()");
    expect(container.querySelector("pre code")?.textContent).toContain("load_config(path)");
  });

  // Replies, the task and questions read at 14px, the size of the tool calls beside them.
  it("writes its text at 14px", () => {
    const { container } = render(<Markdown text="A reply." />);
    expect((container.firstElementChild as HTMLElement).className.split(" ")).toContain("text-sm");
  });

  it("wraps a code block's long lines instead of scrolling it sideways", () => {
    const { container } = render(<Markdown text={"```\n" + "x".repeat(400) + "\n```"} />);
    const look = (container.firstElementChild as HTMLElement).className.split(" ");
    expect(look).toContain("[&_pre]:whitespace-pre-wrap");
    expect(look).not.toContain("[&_pre]:overflow-x-auto");
  });

  it("shows raw HTML as text and never makes elements of it", () => {
    const { container } = render(<Markdown text={'Hello <script>alert(1)</script> and <img src="x" onerror="alert(2)">'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("opens a link in a new tab, without giving it this page", () => {
    render(<Markdown text={"See [the docs](https://example.org/docs)."} />);
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoopener\b/);
    expect(link.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
  });

  it("renders a table, with a header row and its cells", () => {
    const { container } = render(<Markdown text={"| file | callers |\n|---|---:|\n| a.py | 3 |\n| b.py | 11 |"} />);
    expect(container.querySelectorAll("table thead th")).toHaveLength(2);
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(2);
    expect(container.querySelector("tbody td")?.textContent).toBe("a.py");
  });

  // A wide table scrolls inside its own box, so the bubble and the page never scroll sideways.
  it("puts a table in a box that scrolls sideways on its own", () => {
    const { container } = render(<Markdown text={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
    const box = container.querySelector("table")!.parentElement!;
    expect(box.className.split(" ")).toContain("overflow-x-auto");
    // Cells break only between words, so the columns keep their width and the box scrolls.
    const look = (container.firstElementChild as HTMLElement).className.split(" ");
    expect(look).toContain("[&_td]:[overflow-wrap:normal]");
    expect(look).toContain("[&_th]:[overflow-wrap:normal]");
  });

  it("renders struck-through text and task lists", () => {
    const { container } = render(<Markdown text={"~~gone~~ kept\n\n- [x] done\n- [ ] open"} />);
    expect(container.querySelector("del")?.textContent).toBe("gone");
    const boxes = container.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
    expect([...boxes].map((b) => b.checked)).toEqual([true, false]);
  });

  // An image would make the browser fetch whatever URL the model wrote, so it shows as a link.
  it("shows a Markdown image as a link and never loads it", () => {
    render(<Markdown text={"![the plot](https://example.org/p.png)"} />);
    expect(document.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: /the plot/ });
    expect(link.getAttribute("href")).toBe("https://example.org/p.png");
    expect(link.getAttribute("rel")).toMatch(/\bnoopener\b/);
  });

  it("does not make a javascript: link clickable", () => {
    render(<Markdown text={"[click](javascript:alert(1))"} />);
    const link = screen.queryByRole("link", { name: "click" });
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});

function row(): ListRow {
  return {
    name: "s", state: "ok", why: null, age: null, kind: "?", model: null, effort: null, title: "t",
    startedAt: null, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null, messaged: false, asked: false, workspace: null, mcpTask: null,
  };
}

function turn(overrides: Partial<TurnView>): TurnView {
  return {
    n: 1, heading: "turn 1", budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null, retries: [],
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null, model: null, askedFor: null,
    clock: null, at: null, asks: [], ...overrides,
  };
}

function view(overrides: Partial<StreamView>): StreamView {
  return { name: "s", seq: 1, row: row(), task: null, files: [], waiting: null, messages: [], turns: [], summary: null, ...overrides };
}

describe("where Markdown is used", () => {
  it("renders the task as Markdown", () => {
    const { container } = render(<StreamViewBody view={view({ task: "Find **every** caller" })} />);
    expect(container.querySelector('[data-from="caller"] strong')?.textContent).toBe("every");
  });

  it("renders a turn's reply as Markdown", () => {
    const { container } = render(<StreamViewBody view={view({ turns: [turn({ reply: "- a\n- b" })] })} />);
    expect(container.querySelectorAll('[data-from="delegation"] ul > li')).toHaveLength(2);
  });

  it("renders an open turn's thinking as Markdown once its fold opens, and none while folded", () => {
    render(
      <StreamViewBody view={view({ turns: [turn({ closed: false, partial: { reasoning: "Weighing **both**\n\n| a | b |\n|---|---|\n| 1 | 2 |", answer: "" } })] })} />,
    );
    const fold = screen.getByText(/^Thinking · /).closest("details")!;
    expect(fold.querySelector("strong")).toBeNull();
    expect(fold.textContent).not.toContain("Weighing");
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(fold.querySelector("strong")?.textContent).toBe("both");
    expect(fold.querySelector("table")).not.toBeNull();
    // Thinking keeps its single line breaks, as the model wrote them.
    expect(fold.querySelector("[data-markdown]")!.closest(".text-muted")!.className.split(" ")).toContain("[&_p]:whitespace-pre-line");
    fold.open = false;
    fireEvent(fold, new Event("toggle"));
    expect(fold.querySelector("table")).toBeNull();
  });

  it("renders a finished turn's thinking as Markdown when its fold opens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "Use `load()`\n\n| a |\n|---|\n| 1 |" }), { status: 200 })));
    render(<StreamViewBody view={view({ turns: [turn({ thinking: { chars: 30, complete: true } })] })} />);
    const fold = screen.getByText(/^Thinking · /).closest("details")!;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    await waitFor(() => expect(fold.querySelector("table")).not.toBeNull());
    expect(fold.querySelector("code")?.textContent).toBe("load()");
    vi.unstubAllGlobals();
  });

  it("renders the answer as it is written as Markdown too", () => {
    const { container } = render(
      <StreamViewBody view={view({ turns: [turn({ closed: false, partial: { reasoning: "", answer: "Using `x`" } })] })} />,
    );
    expect(container.querySelector('[data-from="delegation"] code')?.textContent).toBe("x");
  });
});
