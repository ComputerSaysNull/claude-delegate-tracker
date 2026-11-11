// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bottomInView, bottomInViewOnceObserved, installIntersectionObserver } from "./intersection.ts";

// The list makes its next observer in an effect that can run after a findBy returns. These
// tests make the observer late on purpose, which is the race that failed the Older-fetch test.
function observeLater(ms: number): { seen: () => number } {
  let count = 0;
  setTimeout(() => {
    const target = document.createElement("div");
    new IntersectionObserver(() => {
      count += 1;
    }).observe(target);
  }, ms);
  return { seen: () => count };
}

describe("reporting the list's end marker in view", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches no observer when it fires before the observer exists", async () => {
    installIntersectionObserver();
    const late = observeLater(20);
    bottomInView();
    await new Promise((r) => setTimeout(r, 40));
    expect(late.seen()).toBe(0);
  });

  it("waits for a live observer before reporting", async () => {
    installIntersectionObserver();
    const late = observeLater(20);
    await bottomInViewOnceObserved();
    expect(late.seen()).toBe(1);
  });
});
