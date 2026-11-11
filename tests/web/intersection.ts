// A fake IntersectionObserver for the delegation list's "load on scroll" marker. jsdom has
// no IntersectionObserver, so each instance records its callback and the elements it observes,
// and bottomInView() replays an intersecting report for every live (not disconnected) instance
// inside act — letting a test drive the load-on-scroll path without a real observer.
import { act, waitFor } from "@testing-library/react";
import { vi } from "vitest";

interface LiveObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
  disconnected: boolean;
}

const observers: LiveObserver[] = [];

// Install the fake as the global IntersectionObserver. The files' existing afterEach calls
// vi.unstubAllGlobals(), which restores the real (absent) one.
export function installIntersectionObserver(): void {
  observers.length = 0;
  class FakeIntersectionObserver {
    readonly callback: IntersectionObserverCallback;
    readonly targets: Element[] = [];
    disconnected = false;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      observers.push(this);
    }

    observe(target: Element): void {
      this.targets.push(target);
    }

    unobserve(target: Element): void {
      const at = this.targets.indexOf(target);
      if (at !== -1) this.targets.splice(at, 1);
    }

    disconnect(): void {
      this.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

// Report the observed marker intersecting for every live observer, inside act.
export function bottomInView(): void {
  act(() => {
    for (const observer of observers) {
      if (observer.disconnected) continue;
      for (const target of observer.targets) {
        observer.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        );
      }
    }
  });
}

// The list makes a fresh observer in an effect after each page, and a findBy can return before
// that effect has run. Reporting the marker then reaches no live observer and nothing loads, so
// after awaiting a page, wait for a live observer first.
export async function bottomInViewOnceObserved(): Promise<void> {
  await waitFor(() => {
    if (!observers.some((o) => !o.disconnected && o.targets.length > 0)) throw new Error("no live observer yet");
  });
  bottomInView();
}

// How many observers were made, and how many are still live: a real observer reports only
// changes, so the list must make a fresh one after each page for a marker still in view.
export function observerCounts(): { made: number; live: number } {
  return { made: observers.length, live: observers.filter((o) => !o.disconnected).length };
}
