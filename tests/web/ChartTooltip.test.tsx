// @vitest-environment jsdom
// The Power BI–style tooltip card: a title, one row per series with a colour swatch, and
// (when given) a divider and a total row.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ChartTooltip } from "../../src/web/ChartTooltip.tsx";

const rows = [
  { label: "done", value: "3", swatch: "bg-chart-done" },
  { label: "stopped", value: "1", swatch: "bg-chart-stopped" },
];

afterEach(cleanup);

describe("ChartTooltip", () => {
  it("renders the title and each row's label and value", () => {
    render(<ChartTooltip title="5 Sep" rows={rows} />);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("5 Sep")).toBeTruthy();
    expect(within(tooltip).getByText("done")).toBeTruthy();
    expect(within(tooltip).getByText("3")).toBeTruthy();
    expect(within(tooltip).getByText("stopped")).toBeTruthy();
    expect(within(tooltip).getByText("1")).toBeTruthy();
  });

  it("renders the total row after a divider when a total is given", () => {
    render(<ChartTooltip title="5 Sep" rows={rows} total={{ label: "Delegations", value: "4" }} />);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByRole("separator")).toBeTruthy();
    expect(within(tooltip).getByText("Delegations")).toBeTruthy();
    expect(within(tooltip).getByText("4")).toBeTruthy();
  });

  it("draws no divider when there is no total", () => {
    render(<ChartTooltip title="5 Sep" rows={rows} />);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText("Delegations")).toBeNull();
  });
});
