// @vitest-environment jsdom
// Replies and tasks are Markdown: rendered as formatted text, with raw HTML shown as text and
// never run, and links that open in a new tab without handing over this page.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("does not make a javascript: link clickable", () => {
    render(<Markdown text={"[click](javascript:alert(1))"} />);
    const link = screen.queryByRole("link", { name: "click" });
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});

function row(): ListRow {
  return {
    name: "s", state: "ok", why: null, age: null, kind: "?", model: null, effort: null, title: "t",
    startedAt: null, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null,
  };
}

function turn(overrides: Partial<TurnView>): TurnView {
  return {
    n: 1, heading: "turn 1", budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null,
    toolTime: null, attempts: null, repeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView>): StreamView {
  return { name: "s", seq: 1, row: row(), task: null, files: [], waiting: null, turns: [], summary: null, ...overrides };
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

  it("renders the answer as it is written as Markdown too", () => {
    const { container } = render(
      <StreamViewBody view={view({ turns: [turn({ closed: false, partial: { reasoning: "", answer: "Using `x`" } })] })} />,
    );
    expect(container.querySelector('[data-from="delegation"] code')?.textContent).toBe("x");
  });
});
