// @vitest-environment jsdom
// A turn's thinking can run to hundreds of kilobytes, and parsing all of it again on every new
// piece takes over a second. So thinking renders in blocks, split at blank lines, each block
// parsed once: a new piece re-parses only the last block, and the blocks render as the whole.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("react-markdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-markdown")>();
  const Counted = (props: Parameters<typeof real.default>[0]) => {
    parses.count += 1;
    return real.default(props);
  };
  return { ...real, default: Counted };
});

const { Markdown, MarkdownBlocks, splitBlocks } = await import("../../src/web/Markdown.tsx");

afterEach(cleanup);

// What a reader sees: the rendered elements in order, ignoring the boxes that hold them.
function rendered(root: Element): string {
  const parts: string[] = [];
  for (const box of root.querySelectorAll("[data-markdown]")) {
    for (const child of box.children) parts.push(child.outerHTML);
  }
  return parts.join("");
}

const MIXED = [
  "First I read the **config**.",
  "",
  "| file | callers |",
  "|---|---:|",
  "| a.py | 3 |",
  "",
  "```py",
  "def load():",
  "",
  "    return 1",
  "```",
  "",
  "1. one",
  "",
  "2. two",
  "",
  "- item",
  "",
  "    still the item",
  "",
  "Done.",
].join("\n");

describe("splitting thinking into blocks", () => {
  it("never splits inside a code fence", () => {
    const blocks = splitBlocks("a\n\n```\nx\n\ny\n```\n\nb");
    expect(blocks).toContain("```\nx\n\ny\n```");
  });

  it("keeps a list together across its blank lines, and an indented line with its item", () => {
    const blocks = splitBlocks("1. one\n\n2. two\n\n- item\n\n    still the item\n\nDone.");
    expect(blocks).toEqual(["1. one\n\n2. two\n\n- item\n\n    still the item", "Done."]);
  });

  it("renders the same in blocks as the text does whole", () => {
    const whole = render(<Markdown text={MIXED} />);
    const wholeHtml = rendered(whole.container);
    cleanup();
    const blocks = render(<MarkdownBlocks text={MIXED} />);
    expect(rendered(blocks.container)).toBe(wholeHtml);
    expect(splitBlocks(MIXED).length).toBeGreaterThan(2);
  });

  it("parses only the last block again when the text grows", () => {
    const start = "One.\n\nTwo.\n\nThree is still";
    const { rerender } = render(<MarkdownBlocks text={start} />);
    parses.count = 0;
    rerender(<MarkdownBlocks text={start + " being written"} />);
    expect(parses.count).toBe(1);
  });
});
