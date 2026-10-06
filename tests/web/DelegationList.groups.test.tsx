// @vitest-environment jsdom
// The list grouped by date like a mail client: a header per group that folds, a summary
// line on top, and progress on the cards of runs still going.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

// Sunday 4 October 2026, 19:00 in Amsterdam.
const NOW = new Date("2026-10-04T17:00:00.000Z");
const TODAY = "2026-10-04T08:00:00.000Z";
const YESTERDAY = "2026-10-03T08:00:00.000Z";
const savedTz = process.env.TZ;

function row(name: string, overrides: Partial<ListRow> = {}): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "claude-code", model: null, effort: null,
    title: `Delegation ${name}`, startedAt: TODAY, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, workspace: null, ...overrides,
  };
}

function list(rows: ListRow[], overrides: Partial<ListResponse> = {}): ListResponse {
  return { rows, capped: false, total: rows.length, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0, ...overrides };
}

const header = (name: RegExp) => screen.getByRole("button", { name });

describe("DelegationList grouped by date", () => {
  beforeEach(() => {
    process.env.TZ = "Europe/Amsterdam";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = savedTz;
  });

  it("puts the cards under a header per day, with the group's count", () => {
    render(<DelegationList list={list([row("a"), row("b"), row("c", { startedAt: YESTERDAY })])} />);
    expect(header(/Today · 4 Oct/).textContent).toContain("2");
    expect(header(/Yesterday · 3 Oct/).textContent).toContain("1");
  });

  it("starts every group expanded, and a header folds its own group only", () => {
    render(<DelegationList list={list([row("a"), row("c", { startedAt: YESTERDAY })])} />);
    const today = header(/Today · 4 Oct/);
    expect(today.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(today);
    expect(today.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Delegation a" })).toBeNull();
    expect(screen.getByRole("link", { name: "Delegation c" })).toBeTruthy();
    fireEvent.click(today);
    expect(screen.getByRole("link", { name: "Delegation a" })).toBeTruthy();
  });

  it("older pages fall into the same groups as the live rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rows: [row("old", { startedAt: YESTERDAY })], nextBefore: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row("live", { startedAt: YESTERDAY })], { capped: true, total: 21 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    await screen.findByRole("link", { name: "Delegation old" });
    expect(screen.getAllByRole("button", { name: /Yesterday · 3 Oct/ })).toHaveLength(1);
    expect(header(/Yesterday · 3 Oct/).textContent).toContain("2");
  });

  it("sums up what is running, queued and failed today above the list", () => {
    render(
      <DelegationList
        list={list([
          row("r", { state: "live" }),
          row("q", { state: "queued" }),
          row("f", { state: "failed" }),
          row("f-old", { state: "failed", startedAt: YESTERDAY }),
        ])}
      />,
    );
    const line = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "1 running · 1 queued · 1 failed today");
    expect(line.querySelector(".text-state-failed")!.textContent).toBe("1 failed");
  });

  it("a running card shows its turns as a bar and its time left", () => {
    render(<DelegationList list={list([row("r", { state: "live", turns: "2 of 4", left: "2m50s" })])} />);
    const card = screen.getByRole("link", { name: "Delegation r" }).closest("li")!;
    const bar = within(card).getByRole("progressbar", { name: "Turns" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["2", "4"]);
    expect(card.textContent).toContain("2m50s left");
  });

  it("a queued card shows how long it has waited out of how long it may", () => {
    render(<DelegationList list={list([row("q", { state: "queued", age: "1m", queueOf: "10m" })])} />);
    expect(screen.getByRole("link", { name: "Delegation q" }).closest("li")!.textContent).toContain("queued 1m of 10m");
  });

  it("an asking card is tinted like a running one and says it waits for an answer", () => {
    render(<DelegationList list={list([row("a", { state: "asking", age: "48s" })])} />);
    const card = screen.getByRole("link", { name: "Delegation a" }).closest("li")!;
    expect(card.className).toMatch(/\bbg-state-asking\//);
    expect(card.textContent).toContain("waiting for an answer 48s");
  });

  it("counts an asking run as running in the summary line", () => {
    render(<DelegationList list={list([row("r", { state: "live" }), row("a", { state: "asking" })])} />);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "2 running · 0 queued · 0 failed today")).toBeTruthy();
  });

  it("counts stopped and timed-out runs apart from failed ones, only when there are any", () => {
    render(
      <DelegationList
        list={list([row("f", { state: "failed" }), row("s", { state: "stopped" }), row("t", { state: "timed out" }), row("t2", { state: "timed out" })])}
      />,
    );
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "0 running · 0 queued · 1 failed · 2 timed out · 1 stopped today"),
    ).toBeTruthy();
  });

  it("a finished card shows no progress", () => {
    render(<DelegationList list={list([row("done", { turns: "4 of 4" })])} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
