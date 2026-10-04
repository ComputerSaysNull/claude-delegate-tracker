// @vitest-environment jsdom
// A background tab says how things stand: running and failed counts in its title, and a
// coloured dot on its icon, cleared when the tab is shown again.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ListRow } from "../../src/server/streams.ts";
import { faviconSvg, tabTitle, useTabStatus } from "../../src/web/tabStatus.ts";

function row(name: string, state: ListRow["state"]): ListRow {
  return {
    name, state, why: null, age: null, kind: "?", model: null, effort: null, title: name, startedAt: null,
    elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null,
  };
}

describe("the tab's title", () => {
  it("is the plain name when nothing runs or failed unseen", () => {
    expect(tabTitle(0, 0)).toBe("Delegation tracker");
  });

  it("counts what runs and what failed unseen", () => {
    expect(tabTitle(2, 0)).toBe("(2 running) Delegation tracker");
    expect(tabTitle(0, 1)).toBe("(1 failed) Delegation tracker");
    expect(tabTitle(2, 1)).toBe("(2 running, 1 failed) Delegation tracker");
  });
});

describe("the tab's icon", () => {
  const colours = { base: "#123456", running: "#0000ff", failed: "#ff0000" };

  it("has no dot when nothing runs", () => {
    expect(faviconSvg(null, colours)).not.toContain("<circle cx=\"24\"");
  });

  it("has a blue dot while something runs, a red one after a failure", () => {
    expect(faviconSvg("running", colours)).toContain('fill="#0000ff"');
    expect(faviconSvg("failed", colours)).toContain('fill="#ff0000"');
  });
});

describe("useTabStatus", () => {
  let hidden = false;
  const setHidden = (value: boolean) => {
    hidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const icon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? "";

  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.title = "Delegation tracker";
  });

  afterEach(cleanup);

  it("counts the running delegations in the title, asking ones included", () => {
    renderHook(() => useTabStatus([row("a", "live"), row("b", "asking"), row("c", "ok")]));
    expect(document.title).toBe("(2 running) Delegation tracker");
    expect(decodeURIComponent(icon())).toContain('data-dot="running"');
  });

  it("says a delegation failed while the tab was in the background, until it is shown again", () => {
    const { rerender } = renderHook(({ rows }) => useTabStatus(rows), { initialProps: { rows: [row("a", "live")] } });
    act(() => setHidden(true));
    rerender({ rows: [row("a", "failed")] });
    expect(document.title).toBe("(1 failed) Delegation tracker");
    expect(decodeURIComponent(icon())).toContain('data-dot="failed"');
    act(() => setHidden(false));
    expect(document.title).toBe("Delegation tracker");
    expect(decodeURIComponent(icon())).not.toContain("data-dot");
  });

  it("shows the red dot over the blue one while both apply", () => {
    const { rerender } = renderHook(({ rows }) => useTabStatus(rows), { initialProps: { rows: [row("a", "live"), row("b", "live")] } });
    act(() => setHidden(true));
    rerender({ rows: [row("a", "live"), row("b", "failed")] });
    expect(document.title).toBe("(1 running, 1 failed) Delegation tracker");
    expect(decodeURIComponent(icon())).toContain('data-dot="failed"');
  });

  it("does not count a failure that happened while the tab was being looked at", () => {
    const { rerender } = renderHook(({ rows }) => useTabStatus(rows), { initialProps: { rows: [row("a", "live")] } });
    rerender({ rows: [row("a", "failed")] });
    act(() => setHidden(true));
    expect(document.title).toBe("Delegation tracker");
  });

  it("does not count failures that were already there when the page opened", () => {
    act(() => setHidden(true));
    renderHook(() => useTabStatus([row("old", "failed")]));
    expect(document.title).toBe("Delegation tracker");
  });
});
