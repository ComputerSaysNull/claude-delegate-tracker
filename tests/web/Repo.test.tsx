// @vitest-environment jsdom
// The repo that sent a delegation (plans#25): the list card's meta line leads with it in place
// of the kind, the filter panel can narrow to one repo, the task and answer bubbles name it,
// the file chips show the path inside it, and the details bar lists it before the kind.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import { NO_FILTER, type RowFilter } from "../../src/web/filter.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import type { StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";
import { localTime } from "../../src/web/time.ts";

// jsdom has no matchMedia; this stub is re-read at each render, so a test can set
// `mediaMatches` right before rendering to choose the viewport the component sees.
let mediaMatches = true;

beforeEach(() => {
  localStorage.clear();
  mediaMatches = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: mediaMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1", state: "live", why: null, age: null, kind: "delegate", model: null, effort: null,
    title: "Refactor the auth module", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, workspace: null, ...overrides,
  };
}

function list(rows: ListRow[]): ListResponse {
  return { rows, capped: false, total: rows.length, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0 };
}

function turn(n: number, overrides: Partial<TurnView> = {}): TurnView {
  return {
    n, heading: `turn ${n}`, budget: null, calls: [], reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null, retries: [],
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, question: null, answer: null, ...overrides,
  };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: "stream-1", seq: 1, row: row(), task: "Find every place that calls load_config()", files: [], waiting: null, turns: [], summary: null, ...overrides };
}

describe("the repo on a card", () => {
  it("leads the card's meta line with the repo in place of the kind when the row has a workspace", () => {
    render(<DelegationList list={list([row({ workspace: "web-shop", turns: "2", elapsed: "3m10s" })])} />);
    const meta = screen.getByText(/web-shop · 2 turns/, { selector: "p" });
    expect(meta.textContent).toBe("web-shop · 2 turns · 3m10s");
  });

  it("keeps the kind when the row has no workspace", () => {
    render(<DelegationList list={list([row({ turns: "2", elapsed: "3m10s" })])} />);
    const meta = screen.getByText(/delegate · 2 turns/, { selector: "p" });
    expect(meta.textContent).toBe("delegate · 2 turns · 3m10s");
  });
});

describe("the Repo filter", () => {
  it("lists each distinct workspace in the Repo select", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", workspace: "web-shop" }),
          row({ name: "b", workspace: "api" }),
          row({ name: "c", workspace: null }),
        ])}
        filter={NO_FILTER}
        onFilterChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const repo = screen.getByRole("combobox", { name: "Repo" });
    expect([...repo.querySelectorAll("option")].map((o) => o.textContent ?? "")).toEqual([
      "All repos",
      "api",
      "web-shop",
    ]);
  });

  it("calls onFilterChange with the repo when one is chosen", () => {
    const onFilterChange = vi.fn();
    render(
      <DelegationList
        list={list([row({ name: "a", workspace: "web-shop" })])}
        filter={NO_FILTER}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Repo" }), { target: { value: "web-shop" } });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ repo: "web-shop" }));
  });

  it("narrows the rows to the chosen repo", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", workspace: "web-shop", title: "Shop task" }),
          row({ name: "b", workspace: "api", title: "Api task" }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Repo" }), { target: { value: "web-shop" } });
    expect(screen.getByText("Shop task")).toBeTruthy();
    expect(screen.queryByText("Api task")).toBeNull();
  });

  it("shows a chip for an active repo filter and removes just it on click", () => {
    const onFilterChange = vi.fn();
    const filter: RowFilter = { text: "", states: [], kind: null, model: null, repo: "web-shop" };
    render(<DelegationList list={list([row({ name: "a" })])} filter={filter} onFilterChange={onFilterChange} />);
    const chip = screen.getByRole("button", { name: "Remove filter: repo web-shop" });
    expect(chip.textContent).toContain("repo web-shop");
    expect(chip.textContent).toContain("×");
    fireEvent.click(chip);
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ repo: null }));
  });

  it("counts a repo filter in the Filters button", () => {
    render(
      <DelegationList
        list={list([row({ name: "a" })])}
        filter={{ text: "", states: [], kind: null, model: null, repo: "web-shop" }}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
  });
});

describe("the repo on the stream page", () => {
  it("reads the task bubble's header as from the repo", () => {
    const startedAt = "2026-10-04T12:00:00.000Z";
    render(<StreamViewBody view={view({ row: row({ workspace: "web-shop", startedAt }) })} />);
    const header = screen.getByText(/Task from web-shop/);
    expect(header.textContent).toContain("Task from web-shop");
    expect(header.textContent).toContain(localTime(startedAt));
  });

  it("keeps the plain task header when the row has no workspace", () => {
    const startedAt = "2026-10-04T12:00:00.000Z";
    render(<StreamViewBody view={view({ row: row({ startedAt }) })} />);
    const header = screen.getByText(/^Task/);
    expect(header.textContent).not.toContain("from");
    expect(header.textContent).toContain(localTime(startedAt));
  });

  it("reads the caller's answer bubble's header as from the repo", () => {
    render(
      <StreamViewBody
        view={view({
          row: row({ workspace: "web-shop" }),
          turns: [turn(1, { answer: { text: "yes", waited: "5s", bestReading: false } })],
        })}
      />,
    );
    const header = screen.getByText(/Answer from web-shop, after/);
    expect(header.textContent).toContain("Answer from web-shop, after");
    expect(header.textContent).toContain("5s");
  });

  it("keeps the plain answer header when the row has no workspace", () => {
    render(
      <StreamViewBody
        view={view({
          turns: [turn(1, { answer: { text: "yes", waited: "5s", bestReading: false } })],
        })}
      />,
    );
    expect(screen.getByText(/Answer, after/)).toBeTruthy();
    expect(screen.queryByText(/Answer from/)).toBeNull();
  });
});

describe("the repo on a file chip", () => {
  it("shows the path inside the repo when the workspace is its folder, keeping the full path as the title", () => {
    render(
      <StreamViewBody
        view={view({
          row: row({ workspace: "web-shop" }),
          files: [{ path: "C:\\w\\web-shop\\src\\dates.py", size: null, skipped: null }],
        })}
      />,
    );
    const chip = screen.getByText("src/dates.py");
    expect(chip.getAttribute("title")).toBe("C:\\w\\web-shop\\src\\dates.py");
  });

  it("shows the path inside the repo for a forward-slash path too", () => {
    render(
      <StreamViewBody
        view={view({
          row: row({ workspace: "web-shop" }),
          files: [{ path: "/w/web-shop/src/dates.py", size: null, skipped: null }],
        })}
      />,
    );
    expect(screen.getByText("src/dates.py")).toBeTruthy();
  });

  it("shows the full path when the workspace is absent", () => {
    render(
      <StreamViewBody
        view={view({
          files: [{ path: "/w/web-shop/src/dates.py", size: null, skipped: null }],
        })}
      />,
    );
    expect(screen.getByText("/w/web-shop/src/dates.py")).toBeTruthy();
  });

  it("shows the full path when the workspace is not a folder of the path", () => {
    render(
      <StreamViewBody
        view={view({
          row: row({ workspace: "api" }),
          files: [{ path: "/w/web-shop/src/dates.py", size: null, skipped: null }],
        })}
      />,
    );
    expect(screen.getByText("/w/web-shop/src/dates.py")).toBeTruthy();
  });
});

describe("the repo in the details bar", () => {
  it("shows a Repo row before Kind when the row has a workspace", () => {
    const v = view({ row: row({ workspace: "web-shop" }) });
    render(<StreamViewBody view={v} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    const repo = within(aside).getByText("Repo");
    expect(repo.nextElementSibling?.textContent).toBe("web-shop");
    const kind = within(aside).getByText("Kind");
    expect(repo.compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no Repo row when the row has no workspace", () => {
    render(<StreamViewBody view={view()} />);
    const aside = screen.getByRole("complementary", { name: "Details" });
    expect(within(aside).queryByText("Repo")).toBeNull();
  });
});
