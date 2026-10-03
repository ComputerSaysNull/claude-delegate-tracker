// The page's live connections (Server-Sent Events). A page the browser keeps in its
// back/forward cache would keep them open, and over HTTP/1.1 a browser allows only six per
// host, so a few visits back and forth would stall every new page. So they close when the
// page is hidden, and a page that comes back from that cache reloads to get fresh state.
const open = new Set<EventSource>();

export function openLive(url: string): EventSource {
  const source = new EventSource(url);
  open.add(source);
  return source;
}

export function closeLive(source: EventSource): void {
  source.close();
  open.delete(source);
}

window.addEventListener("pagehide", () => {
  for (const source of open) source.close();
  open.clear();
});

// Replaceable in tests, where a real reload can't happen.
export const page = { reload: (): void => location.reload() };

window.addEventListener("pageshow", (event) => {
  if (event.persisted) page.reload();
});
