import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// How far a hover card stays in from either edge of the screen.
export const CARD_MARGIN = 8;

// Where a hover card goes, as a left offset inside its container: centred over `anchorX` (px
// from the container's left edge), then shifted so the whole card stays between `bounds`
// (screen px). A card wider than that keeps its left edge, where its title is.
export function cardLeft(anchorX: number, cardWidth: number, containerLeft: number,
                         bounds: { left: number; right: number }, margin = CARD_MARGIN): number {
  const centred = anchorX - cardWidth / 2;
  const lowest = bounds.left + margin - containerLeft;
  const highest = bounds.right - margin - cardWidth - containerLeft;
  return Math.max(lowest, Math.min(highest, centred));
}

// The part of the screen that `el` can be seen in: the window, narrowed by every ancestor
// that clips sideways. A scrolling column clips inside its scrollbar, so its inner box counts.
export function visibleBounds(el: HTMLElement): { left: number; right: number } {
  let left = 0;
  let right = document.documentElement.clientWidth;
  for (let a = el.parentElement; a !== null; a = a.parentElement) {
    const overflowX = getComputedStyle(a).overflowX;
    if (overflowX === "" || overflowX === "visible" || a.clientWidth === 0) continue;
    const inner = a.getBoundingClientRect().left + a.clientLeft;
    left = Math.max(left, inner);
    right = Math.min(right, inner + a.clientWidth);
  }
  return { left, right };
}

// A hover card over a chart. `at` is the anchor as a share (0 to 1) of the width of the
// positioned container it sits in. It measures itself before the browser paints and stays
// where it can be seen; its width does not depend on where it lands (`w-max`), so one measure holds.
export function PlacedCard({ at, children }: { at: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    const box = card?.parentElement?.getBoundingClientRect();
    if (!card || !box) return;
    const next = cardLeft(at * box.width, card.offsetWidth, box.left, visibleBounds(card));
    setLeft((prev) => (prev === next ? prev : next));
  });
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-max"
      style={left === null ? { visibility: "hidden" } : { left: `${left}px` }}
    >
      {children}
    </div>
  );
}

// Power BI–style tooltip card for the History day charts: a title, one row per series with
// a short colour stroke, and (when given) a divider and a total row.
export function ChartTooltip({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; value: string; swatch: string }[];
  total?: { label: string; value: string };
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none min-w-[11rem] rounded-lg border border-line bg-card p-2 text-[12.5px] shadow"
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span className={`h-0.5 w-2.5 rounded-full ${r.swatch}`} aria-hidden="true" />
            <span className="flex-1 text-muted">{r.label}</span>
            <span className="font-mono tabular-nums font-semibold text-text">{r.value}</span>
          </div>
        ))}
      </div>
      {total !== undefined && (
        <>
          <hr role="separator" className="my-1.5 border-line" />
          <div className="flex items-center gap-1.5">
            <span className="flex-1 text-muted">{total.label}</span>
            <span className="font-mono tabular-nums font-semibold text-text">{total.value}</span>
          </div>
        </>
      )}
    </div>
  );
}
