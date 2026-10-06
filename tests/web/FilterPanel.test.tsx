// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import { STATE_LABEL } from "../../src/web/states.tsx";
import { NO_FILTER, type RowFilter } from "../../src/web/filter.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

const STATES: ListRow["state"][] = ["live", "asking", "queued", "quiet", "ok", "failed", "stopped", "timed out", "cut off"];
const STATE_LABELS = STATES.map((state) => STATE_LABEL[state]);

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
    left: null,
    queueOf: null,
    ...overrides,
  };
}

function list(rows: ListRow[]): ListResponse {
  return {
    rows,
    capped: false,
    total: rows.length,
    unstamped: 0,
    folderReadable: true,
    badLines: 0,
    schemaFailures: 0,
  };
}

describe("DelegationList filter panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the search box and shows a closed Filters button beside it", () => {
    render(<DelegationList list={list([row({ name: "a" })])} />);
    expect(screen.getByRole("searchbox", { name: "Search titles" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("filter-panel");
  });

  it("counts selected states, kind and model in the Filters button but not the search text", () => {
    render(
      <DelegationList
        list={list([row({ name: "a" })])}
        filter={{ text: "auth", states: ["failed"], kind: "delegate", model: null }}
        onFilterChange={() => {}}
      />,
    );
    // Two filters (one state + one kind) count, so the button reads "Filters (2)",
    // not "Filters (3)" — the search text is not counted.
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeTruthy();
  });

  it("opens a panel holding the state, kind and model controls, hiding the old loose controls", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", kind: "claude-code", model: "claude-sonnet-4" }),
          row({ name: "b", kind: "one-shot", model: null }),
        ])}
        filter={NO_FILTER}
        onFilterChange={() => {}}
      />,
    );
    // The panel is not in the document while closed, and the old loose controls are gone.
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Kind" })).toBeNull();
    expect(screen.queryByText("All states")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("group", { name: "Filters" });
    expect(panel.getAttribute("id")).toBe("filter-panel");

    const stateGroup = screen.getByRole("group", { name: "State" });
    expect(stateGroup.tagName.toLowerCase()).toBe("fieldset");
    for (const label of STATE_LABELS) {
      expect(screen.getByRole("checkbox", { name: label })).toBeTruthy();
    }

    const kind = screen.getByRole("combobox", { name: "Kind" });
    expect([...kind.querySelectorAll("option")].map((o) => o.textContent ?? "")).toEqual([
      "All kinds",
      "claude-code",
      "one-shot",
    ]);

    const model = screen.getByRole("combobox", { name: "Model" });
    expect([...model.querySelectorAll("option")].map((o) => o.textContent ?? "")).toEqual([
      "All models",
      "claude-sonnet-4",
    ]);
  });

  it("calls onFilterChange with the state when a state is checked", () => {
    const onFilterChange = vi.fn();
    render(
      <DelegationList
        list={list([row({ name: "a", state: "failed" })])}
        filter={NO_FILTER}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Failed" }));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ states: ["failed"] }));
  });

  it("calls onFilterChange with the kind when a kind is chosen", () => {
    const onFilterChange = vi.fn();
    render(
      <DelegationList
        list={list([row({ name: "a", kind: "one-shot" })])}
        filter={NO_FILTER}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "one-shot" } });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "one-shot" }));
  });

  it("shows a chip per active state, kind and model filter and removes just that one on click", () => {
    const onFilterChange = vi.fn();
    const filter: RowFilter = { text: "", states: ["failed"], kind: "delegate", model: "flash" };
    render(<DelegationList list={list([row({ name: "a" })])} filter={filter} onFilterChange={onFilterChange} />);

    const failedChip = screen.getByRole("button", { name: "Remove filter: Failed" });
    expect(failedChip.textContent).toContain("Failed");
    expect(failedChip.textContent).toContain("×");
    const kindChip = screen.getByRole("button", { name: "Remove filter: kind delegate" });
    expect(kindChip.textContent).toContain("kind delegate");
    expect(kindChip.textContent).toContain("×");
    const modelChip = screen.getByRole("button", { name: "Remove filter: model flash" });
    expect(modelChip.textContent).toContain("model flash");
    expect(modelChip.textContent).toContain("×");

    fireEvent.click(failedChip);
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ states: [], kind: "delegate", model: "flash" }),
    );
    fireEvent.click(kindChip);
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ states: ["failed"], kind: null, model: "flash" }),
    );
    fireEvent.click(modelChip);
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ states: ["failed"], kind: "delegate", model: null }),
    );
  });

  it("shows no chips when no state, kind or model filter is set (search text alone makes none)", () => {
    render(
      <DelegationList
        list={list([row({ name: "a" })])}
        filter={{ text: "auth", states: [], kind: null, model: null }}
        onFilterChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove filter:/ })).toBeNull();
  });

  it("removes only its own state when two states are on", () => {
    const onFilterChange = vi.fn();
    const filter: RowFilter = { text: "", states: ["failed", "stopped"], kind: null, model: null };
    render(<DelegationList list={list([row({ name: "a" })])} filter={filter} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Failed" }));
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ states: ["stopped"] }));
  });
});
