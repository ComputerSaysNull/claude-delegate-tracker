// @vitest-environment jsdom
// A state never differs by colour alone, and only a run in progress is tinted.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STATES } from "../../src/server/streams.ts";
import { STATE_LABEL, StateBadge, cardClass } from "../../src/web/states.tsx";

afterEach(cleanup);

describe("state badge", () => {
  it.each(STATES)("%s shows its icon beside its word", (state) => {
    render(<StateBadge state={state} />);
    const badge = screen.getByText(STATE_LABEL[state]);
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("names each state in a word a reader knows, not the stream's code", () => {
    expect([STATE_LABEL.live, STATE_LABEL.ok, STATE_LABEL["cut off"]]).toEqual(["Running", "Done", "Cut off"]);
  });

  it("is a pill", () => {
    render(<StateBadge state="ok" />);
    expect(screen.getByText("Done").className).toMatch(/\brounded-full\b/);
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
