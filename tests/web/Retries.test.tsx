// @vitest-environment jsdom
// A turn retried by the delegation shows its count in the heading and, once opened,
// one line per recorded retry, plus a count for those with no reason recorded.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1", state: "live", why: null, age: null, kind: "read_file", model: "flash", effort: null,
    title: "Find every caller of load_config", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, workspace: null, ...overrides,
  };
}

function turn(n: number, overrides: Partial<TurnView> = {}): TurnView {
  return {
    n, heading: `turn ${n}`, budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null,
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, retries: [], tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, question: null, answer: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: "Find every place that calls load_config()", files: [], waiting: null, turns: [], summary: null, ...overrides };
}

const retry = (over: Partial<TurnView["retries"][number]> = {}): TurnView["retries"][number] => ({
  reason: "the model server was unavailable", status: null, wait: "0.5s", ...over,
});

afterEach(cleanup);

describe("a turn's retries", () => {
  it("marks a retried turn in its heading", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 2, retries: [retry()] })] })} />);
    const marker = screen.getByRole("button", { name: "retried 1×" });
    expect(marker.className).toMatch(/\btext-warn\b/);
    expect(marker.getAttribute("aria-expanded")).toBe("false");
  });

  it("lists a retry's reason and wait when opened", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 2, retries: [retry()] })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "retried 1×" }));
    const items = within(screen.getByRole("list", { name: "Retries" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("the model server was unavailable");
    expect(items[0].textContent).toContain("tried again after 0.5s");
  });

  it("counts the retries it cannot explain", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 3, retries: [retry()] })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "retried 2×" }));
    const items = within(screen.getByRole("list", { name: "Retries" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("the model server was unavailable");
    expect(items[1].textContent).toContain("1 more attempt, no reason recorded");
  });

  it("lists only the unexplained count when nothing is recorded", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 4, retries: [] })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "retried 3×" }));
    const items = within(screen.getByRole("list", { name: "Retries" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("3 more attempts, no reason recorded");
  });

  it("shows a retry's HTTP status", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 2, retries: [retry({ reason: "rate limited", status: 429, wait: "12s" })] })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "retried 1×" }));
    const item = within(screen.getByRole("list", { name: "Retries" })).getByRole("listitem");
    expect(item.textContent).toContain("rate limited");
    expect(item.textContent).toContain("HTTP 429");
    expect(item.textContent).toContain("tried again after 12s");
  });

  it("shows no marker when a turn was not retried", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: null })] })} />);
    expect(screen.queryByRole("button", { name: /retried/ })).toBeNull();
  });

  it("no longer reports attempts inside the turn details fold", () => {
    render(<StreamViewBody view={view({ turns: [turn(1, { attempts: 2, evicted: 0, retries: [retry()] })] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn details" }));
    expect(screen.queryByText(/attempts \d/)).toBeNull();
  });
});
