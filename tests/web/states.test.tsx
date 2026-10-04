// @vitest-environment jsdom
// A state never differs by colour alone, and only a run in progress is tinted.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STATES } from "../../src/server/streams.ts";
import { StateBadge, cardClass } from "../../src/web/states.tsx";

afterEach(cleanup);

describe("state badge", () => {
  it.each(STATES)("%s shows its icon beside its name", (state) => {
    render(<StateBadge state={state} />);
    const badge = screen.getByText(state);
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("the icons differ between states", () => {
    const shapes = STATES.map((state) => {
      const { container, unmount } = render(<StateBadge state={state} />);
      const svg = container.querySelector("svg")!.innerHTML;
      unmount();
      return svg;
    });
    expect(new Set(shapes).size).toBe(STATES.length);
  });
});

describe("card tint", () => {
  it("tints a running and a queued card", () => {
    expect(cardClass("live")).toMatch(/\bbg-state-live\//);
    expect(cardClass("queued")).toMatch(/\bbg-state-queued\//);
  });

  it.each(["quiet", "ok", "failed", "cut off"] as const)("leaves a %s card plain", (state) => {
    expect(cardClass(state)).toBe("bg-card border-line");
  });
});
