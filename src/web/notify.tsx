// A desktop notification when a delegation ends, once the viewer has allowed them. Only a
// run seen still going on this page can notify, so runs that had ended before it opened
// never do. The browser offers notifications only in a secure context: on localhost, not
// over the overlay VPN's plain HTTP, so a phone gets no button.
import { useEffect, useRef, useState } from "react";
import type { ListRow } from "../server/streams.ts";

const GOING = new Set<ListRow["state"]>(["live", "asking", "queued", "quiet"]);
const ENDING: Partial<Record<ListRow["state"], string>> = {
  ok: "Finished",
  failed: "Failed",
  stopped: "Stopped",
  "timed out": "Timed out",
  "cut off": "Cut off",
};

function available(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window;
}

export function useNotifications(rows: ListRow[], onOpen: (name: string) => void): void {
  const going = useRef(new Set<string>()); // delegations last seen still going
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  });

  useEffect(() => {
    for (const row of rows) {
      const ending = ENDING[row.state];
      if (GOING.has(row.state)) going.current.add(row.name);
      else if (going.current.delete(row.name) && ending !== undefined && available() && Notification.permission === "granted") {
        const note = new Notification(`${ending}: ${row.title}`, { body: row.why ?? "", tag: row.name });
        note.onclick = () => {
          window.focus();
          open.current(row.name);
        };
      }
    }
  }, [rows]);
}

export function NotifyButton() {
  const [permission, setPermission] = useState(() => (available() ? Notification.permission : null));
  if (permission === null || permission === "granted") return null;
  if (permission === "denied") return <span className="text-sm text-muted">Notifications are blocked in this browser</span>;
  return (
    <button
      type="button"
      onClick={async () => setPermission(await Notification.requestPermission())}
      className="rounded border border-line px-2 py-1 text-sm text-accent hover:bg-line/50"
    >
      Notify me when a delegation ends
    </button>
  );
}
