// Moving through the list at the desk without the mouse. j and k move the focus through
// the delegation links, so Enter opens one the browser's own way; Esc closes the open
// delegation (or this list of keys); / jumps to the search box; ? shows the keys. A key
// typed into a field, or pressed with Ctrl, Alt or Cmd, is left alone.
import { useEffect, useRef, useState } from "react";

const KEYS: [string, string][] = [
  ["j / k", "next / previous delegation"],
  ["Enter", "open it"],
  ["Esc", "close it"],
  ["/", "search"],
  ["?", "show these keys"],
];

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function moveFocus(step: 1 | -1): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Delegations"] li a[href^="/s/"]')];
  if (links.length === 0) return;
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next = at === -1 ? 0 : Math.min(links.length - 1, Math.max(0, at + step));
  links[next].focus();
  links[next].scrollIntoView?.({ block: "nearest" });
}

export function useKeyboard(onClose: () => void): { helpOpen: boolean; closeHelp: () => void } {
  const [helpOpen, setHelpOpen] = useState(false);
  const latest = useRef({ onClose, helpOpen });
  useEffect(() => {
    latest.current = { onClose, helpOpen };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "j") moveFocus(1);
      else if (e.key === "k") moveFocus(-1);
      else if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      } else if (e.key === "?") setHelpOpen((open) => !open);
      else if (e.key === "Escape") {
        if (latest.current.helpOpen) setHelpOpen(false);
        else latest.current.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { helpOpen, closeHelp: () => setHelpOpen(false) };
}

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed bottom-4 left-4 z-30 hidden rounded-xl border border-line bg-card p-4 text-sm shadow lg:block"
    >
      <div className="mb-2 flex items-center gap-4">
        <h2 className="font-semibold">Keyboard shortcuts</h2>
        <button type="button" onClick={onClose} className="ml-auto text-accent hover:underline">
          Close
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {KEYS.map(([key, what]) => (
          <div key={key} className="contents">
            <dt className="font-mono">{key}</dt>
            <dd className="text-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
