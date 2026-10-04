// @vitest-environment jsdom
// The list as the design canvas draws it: a heading with the summary line, a search box and a
// states menu, and cards that lead with the state's icon, the title and the start time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";
import { localTime } from "../../src/web/time.ts";

const NOW = new Date("2026-10-04T17:00:00.000Z");
const TODAY = "2026-10-04T08:00:00.000Z";
const savedTz = process.env.TZ;

function row(name: string, overrides: Partial<ListRow> = {}): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "delegate", model: "flash", effort: "high",
    title: `Delegation ${name}`, startedAt: TODAY, elapsed: "3m10s", turns: "2 of 4", unknownFormat: null,
    left: null, queueOf: null, ...overrides,
  };
}

function list(rows: ListRow[]): ListResponse {
  return { rows, capped: false, total: rows.length, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0 };
}

const card = (name: string) => screen.getByRole("link", { name: `Delegation ${name}` }).closest("li")!;

describe("the list as designed", () => {
  beforeEach(() => {
    process.env.TZ = "Europe/Amsterdam";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    process.env.TZ = savedTz;
  });

  it("heads the list with its name and the summary line beside it", () => {
    render(<DelegationList list={list([row("a", { state: "live" })])} />);
    const heading = screen.getByRole("heading", { name: "Delegations" });
    expect(heading.parentElement!.textContent).toContain("1 running");
  });

  it("filters by state from one menu instead of a button per state", () => {
    render(<DelegationList list={list([row("a"), row("b", { state: "failed" })])} />);
    expect(screen.queryByRole("button", { name: "failed" })).toBeNull();
    fireEvent.click(screen.getByText("All states"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Failed" }));
    expect(screen.queryByRole("link", { name: "Delegation a" })).toBeNull();
    expect(screen.getByRole("link", { name: "Delegation b" })).toBeTruthy();
    expect(screen.getByText("1 state")).toBeTruthy();
  });

  it("leads a card with the state's icon, named for a screen reader, and no badge text in sight", () => {
    render(<DelegationList list={list([row("a", { state: "failed" })])} />);
    const icon = within(card("a")).getByRole("img", { name: "Failed" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(card("a").querySelector(".rounded-full")).toBeNull();
  });

  it("puts the start time on the title's line, in Plex Mono", () => {
    render(<DelegationList list={list([row("a")])} />);
    const time = within(card("a")).getByText(localTime(TODAY));
    expect(time.className).toMatch(/\bfont-mono\b/);
    expect(time.parentElement).toBe(screen.getByRole("link", { name: "Delegation a" }).parentElement);
  });

  it("says under the title what kind of run it was, its turns and how long it took", () => {
    render(<DelegationList list={list([row("a")])} />);
    expect(card("a").textContent).toContain("delegate · 2 turns · 3m10s");
  });

  it("counts a running delegation's turn as turn N of M", () => {
    render(<DelegationList list={list([row("a", { state: "live", turns: "4 of 6", elapsed: "12m31s" })])} />);
    expect(card("a").textContent).toContain("delegate · turn 4 of 6 · 12m31s");
  });

  it("draws a running delegation's turns as segments: done, the current one, and those to come", () => {
    render(<DelegationList list={list([row("a", { state: "live", turns: "4 of 6" })])} />);
    const bar = within(card("a")).getByRole("progressbar", { name: "Turns" });
    const segments = [...bar.children].map((s) => s.className);
    expect(segments).toHaveLength(6);
    expect(segments.filter((c) => /\bbg-state-live\b(?!\/)/.test(c))).toHaveLength(3);
    expect(segments.filter((c) => /\bbg-state-live\/45\b/.test(c))).toHaveLength(1);
    expect(segments.filter((c) => /\bbg-line\b/.test(c))).toHaveLength(2);
  });

  it("splits a group's header into its name and its date", () => {
    render(<DelegationList list={list([row("a")])} />);
    const header = screen.getByRole("button", { name: /Today/ });
    expect(within(header).getByText("Today").className).toMatch(/\bfont-semibold\b/);
    expect(within(header).getByText("· 4 Oct").className).toMatch(/\btext-muted\b/);
  });
});
