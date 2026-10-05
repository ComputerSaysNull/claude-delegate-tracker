// @vitest-environment jsdom
// A state never differs by colour alone, and every card is tinted, a run in progress more strongly.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STATES, type State } from "../../src/server/streams.ts";
import { STATE_LABEL, StateBadge, StateIcon, cardClass } from "../../src/web/states.tsx";

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

  it.each(STATES)("gives a %s card a state-coloured tint", (state) => {
    expect(cardClass(state)).toMatch(/bg-state-/);
  });

  it("tints an active card's background more strongly than a finished one's", () => {
    const share = (state: State) => Number(/bg-state-[a-z-]+\/(\d+)/.exec(cardClass(state))?.[1]);
    const active = (["live", "asking", "queued"] as State[]).map(share);
    const finished = (["quiet", "ok", "failed", "stopped", "timed out", "cut off"] as State[]).map(share);
    expect(Math.min(...active)).toBeGreaterThan(Math.max(...finished));
  });
});

describe("state icon", () => {
  it("pulses a live icon and leaves a finished one still", () => {
    const live = render(<StateIcon state="live" />);
    expect(live.container.querySelector("svg")!.getAttribute("class")).toMatch(/\bmotion-safe:animate-pulse\b/);
    live.unmount();
    const ok = render(<StateIcon state="ok" />);
    expect(ok.container.querySelector("svg")!.getAttribute("class")).not.toMatch(/\bmotion-safe:animate-pulse\b/);
  });

  it("pulses a running badge's dot only when the system allows motion", () => {
    const { container } = render(<StateBadge state="live" />);
    const classes = container.querySelector("svg")!.getAttribute("class")!.split(/\s+/);
    expect(classes).toContain("motion-safe:animate-pulse");
    expect(classes).not.toContain("animate-pulse");
  });
});
