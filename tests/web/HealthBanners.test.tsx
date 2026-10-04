// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HealthBanners } from "../../src/web/HealthBanners.tsx";
import type { Banner } from "../../src/server/health.ts";

describe("HealthBanners", () => {
  afterEach(cleanup);

  it("renders nothing for an empty banner list", () => {
    const { container } = render(<HealthBanners banners={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("gives an error banner a red box", () => {
    const banner: Banner = { level: "error", text: "TRANSCRIPT_DIR is not set" };
    render(<HealthBanners banners={[banner]} />);
    const el = screen.getByText(banner.text);
    expect(el.className).toContain("border-red-600");
    expect(el.className).toContain("bg-red-100");
    expect(el.className).toContain("text-red-700");
    expect(el.className).toContain("dark:border-red-500");
    expect(el.className).toContain("dark:bg-red-950");
    expect(el.className).toContain("dark:text-red-300");
  });

  it("gives a warning banner an amber box", () => {
    const banner: Banner = { level: "warning", text: "The model server can't be reached." };
    render(<HealthBanners banners={[banner]} />);
    const el = screen.getByText(banner.text);
    expect(el.className).toContain("border-amber-500");
    expect(el.className).toContain("bg-amber-100");
    expect(el.className).toContain("text-amber-700");
    expect(el.className).toContain("dark:border-amber-400");
    expect(el.className).toContain("dark:bg-amber-950");
    expect(el.className).toContain("dark:text-amber-300");
  });

  it("renders the banner texts in the given order", () => {
    const banners: Banner[] = [
      { level: "error", text: "first error" },
      { level: "warning", text: "second warning" },
      { level: "warning", text: "third warning" },
    ];
    render(<HealthBanners banners={banners} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => el.textContent)).toEqual(["first error", "second warning", "third warning"]);
  });
});
