// A background tab says how things stand: how many delegations run, and how many failed
// while nobody was looking, in its title and as a coloured dot on its icon. Looking at the
// tab again clears the failures. Failures already there when the page opened don't count.
import { useEffect, useRef } from "react";
import type { ListRow } from "../server/streams.ts";

const NAME = "Delegation tracker";

export function tabTitle(running: number, failedUnseen: number): string {
  const parts = [running > 0 ? `${running} running` : null, failedUnseen > 0 ? `${failedUnseen} failed` : null]
    .filter((p): p is string => p !== null);
  return parts.length === 0 ? NAME : `(${parts.join(", ")}) ${NAME}`;
}

export type Dot = "running" | "failed" | null;

export interface IconColours {
  base: string;
  running: string;
  failed: string;
}

// The icon: a ring, and a dot in its corner while something runs or failed unseen.
export function faviconSvg(dot: Dot, colours: IconColours): string {
  const mark =
    dot === null ? "" : `<circle cx="24" cy="24" r="7" data-dot="${dot}" fill="${dot === "failed" ? colours.failed : colours.running}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="14" cy="14" r="10" fill="none" stroke="${colours.base}" stroke-width="4"/>${mark}</svg>`;
}

// The icon is drawn from the page's colour tokens, read where they are defined.
function tokenColours(): IconColours {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || "currentColor";
  return { base: token("--muted"), running: token("--state-live"), failed: token("--state-failed") };
}

function setIcon(dot: Dot): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link === null) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(dot, tokenColours()))}`;
}

// `rows` is null until the first list arrives: that list is what was there when the page opened.
export function useTabStatus(rows: ListRow[] | null): void {
  const seen = useRef<Set<string> | null>(null); // failed delegations someone could have seen
  const unseen = useRef(new Set<string>());     // failed while the tab was hidden
  const latest = useRef<ListRow[]>(rows ?? []);

  const show = (current: ListRow[]) => {
    const running = current.filter((r) => r.state === "live" || r.state === "asking").length;
    document.title = tabTitle(running, unseen.current.size);
    setIcon(unseen.current.size > 0 ? "failed" : running > 0 ? "running" : null);
  };

  useEffect(() => {
    if (rows === null) {
      show([]);
      return;
    }
    latest.current = rows;
    const failed = rows.filter((r) => r.state === "failed").map((r) => r.name);
    if (seen.current === null) seen.current = new Set(failed);
    for (const name of failed) {
      if (seen.current.has(name) || unseen.current.has(name)) continue;
      if (document.hidden) unseen.current.add(name);
      else seen.current.add(name);
    }
    show(rows);
  }, [rows]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      for (const name of unseen.current) seen.current?.add(name);
      unseen.current.clear();
      show(latest.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
