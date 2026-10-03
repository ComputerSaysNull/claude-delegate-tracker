// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

const STATES: ListRow["state"][] = ["live", "queued", "quiet", "ok", "failed", "cut off"];

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1",
    state: "live",
    why: null,
    age: null,
    kind: "claude-code",
    model: null,
    effort: null,
    title: "Refactor the auth module",
    startedAt: null,
    elapsed: null,
    turns: null,
    unknownFormat: null,
    ...overrides,
  };
}

function list(rows: ListRow[], overrides: Partial<ListResponse> = {}): ListResponse {
  return {
    rows,
    capped: false,
    total: rows.length,
    unstamped: 0,
    folderReadable: true,
    badLines: 0,
    schemaFailures: 0,
    ...overrides,
  };
}

describe("DelegationList", () => {
  afterEach(cleanup);

  it("links the title and truncates it on the link itself, so a long title cannot widen a phone screen", () => {
    render(<DelegationList list={list([row({ title: "A title long enough to need cutting on a phone" })])} />);
    const link = screen.getByRole("link", { name: "A title long enough to need cutting on a phone" });
    expect(link.getAttribute("href")).toBe("/s/stream-1");
    expect(link.className).toMatch(/\bmin-w-0\b/);
    expect(link.className).toMatch(/\btruncate\b/);
  });

  it("shows the waiting line for a null list", () => {
    render(<DelegationList list={null} />);
    expect(screen.getByText("Waiting for the first list…")).toBeTruthy();
  });

  it("shows a capped note with a locale-safe total", () => {
    const total = 1212;
    render(<DelegationList list={list([row({ name: "a" }), row({ name: "b" })], { capped: true, total })} />);
    expect(screen.getByText(`Showing the newest 2 of ${total.toLocaleString()}`)).toBeTruthy();
  });

  it("no longer shows the folder-unreadable note (that fact lives in the health banners)", () => {
    render(<DelegationList list={list([], { folderReadable: false })} />);
    expect(screen.queryByText("The transcript folder can't be read; showing the last known list.")).toBeNull();
  });

  it("shows the empty message for no rows", () => {
    render(<DelegationList list={list([])} />);
    expect(screen.getByText("No delegations yet.")).toBeTruthy();
  });

  it("renders a badge for every state", () => {
    for (const state of STATES) {
      render(<DelegationList list={list([row({ state })])} />);
      expect(screen.getAllByText(state).length).toBeGreaterThan(0);
    }
  });

  it("omits null meta pieces and never leaves a dangling separator", () => {
    render(<DelegationList list={list([row({ kind: "one-shot" })])} />);
    const meta = screen.getByText("one-shot");
    expect(meta.textContent).toBe("one-shot");
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("·")).toBeNull();
  });

  it("shows the start time in local time", () => {
    const startedAt = new Date("2024-01-15T13:45:00Z").toISOString();
    const expected = new Date(startedAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    render(<DelegationList list={list([row({ startedAt })])} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("shows a dash when startedAt is null", () => {
    render(<DelegationList list={list([row({ startedAt: null })])} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows quiet-for when the row is quiet", () => {
    render(<DelegationList list={list([row({ state: "quiet", age: "5m" })])} />);
    expect(screen.getByText(/quiet for 5m/)).toBeTruthy();
  });

  it("shows the why for a failed row", () => {
    render(<DelegationList list={list([row({ state: "failed", why: "rate limited" })])} />);
    expect(screen.getByText("rate limited")).toBeTruthy();
  });

  it("shows the unknown-format note", () => {
    render(<DelegationList list={list([row({ unknownFormat: "2.0" })])} />);
    expect(screen.getByText("format 2.0: shown as best it can be")).toBeTruthy();
  });
});
