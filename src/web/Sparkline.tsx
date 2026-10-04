// A single-line sparkline of one key's history. uPlot renders into a full-width h-8 div;
// with fewer than two points the div is left empty (no chart). uPlot is loaded only when a
// chart is drawn: it reads the screen as soon as it is imported.
import { useEffect, useRef } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export function Sparkline({
  data,
  label,
}: {
  data: [number[], (number | null)[]];
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Create, update and (when too little data) destroy the chart. The chart is reused across
  // data changes via setData; a missing figure is a gap (spanGaps: false), never joined.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (data[0].length < 2) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }
    if (chartRef.current !== null) {
      chartRef.current.setData(data);
      return;
    }
    let cancelled = false;
    void import("uplot").then(({ default: UPlot }) => {
      if (cancelled || chartRef.current !== null) return;
      chartRef.current = new UPlot(
        {
          width: el.clientWidth || 200,
          height: 32,
          // Hidden one by one: uPlot fills an empty list with its default x and y axes.
          axes: [{ show: false }, { show: false }],
          legend: { show: false },
          cursor: { show: false },
          // uPlot draws on a canvas, which cannot read a CSS variable: take the token's value.
          series: [{}, { spanGaps: false, stroke: getComputedStyle(el).getPropertyValue("--muted").trim() || "currentColor" }],
        },
        data,
        el,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Follow the container's width: the chart is drawn at the width it had when created, so a
  // phone turned sideways or a resized window would otherwise leave it too wide or too narrow.
  // Tear the chart down when the component unmounts.
  useEffect(() => {
    const el = ref.current;
    const observer =
      el === null || typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const width = Math.round(entries[0]?.contentRect.width ?? 0);
            if (width > 0) chartRef.current?.setSize({ width, height: 32 });
          });
    if (el !== null) observer?.observe(el);
    return () => {
      observer?.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  return <div ref={ref} role="img" aria-label={label} className="w-full h-8" />;
}

// "over the last hour"-style suffix for a history window, in minutes under an hour and in
// hours at or above it.
export function windowLabel(windowSeconds: number): string {
  if (windowSeconds < 3600) {
    const minutes = Math.round(windowSeconds / 60);
    return minutes === 1 ? "last 1 minute" : `last ${minutes} minutes`;
  }
  const hours = windowSeconds / 3600;
  return hours === 1 ? "last hour" : `last ${hours} hours`;
}
