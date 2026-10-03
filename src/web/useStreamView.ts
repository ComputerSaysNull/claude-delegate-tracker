// Follows one stream's view: the whole view once on connect, then the patches the
// followed stream sends. The apply rule lives in applyPatch so it can be unit tested.
import { useEffect, useState } from "react";
import type { StreamView, ViewPatch } from "../server/view.ts";

// Apply one patch to the held view. Returns "refetch" when the seq is a gap (the
// view must be re-fetched whole), "ignore" when the patch is stale (seq <= held's).
export function applyPatch(held: StreamView, patch: ViewPatch): StreamView | "refetch" | "ignore" {
  if (patch.seq <= held.seq) return "ignore";
  if (patch.seq !== held.seq + 1) return "refetch";
  const turns = held.turns.slice();
  for (const { index, turn, append } of patch.turns) {
    if (append === true) {
      if (index < 0 || index >= held.turns.length) return "refetch";
      const heldPartial = held.turns[index].partial;
      if (heldPartial === null || turn.partial === null) return "refetch";
      turns[index] = {
        ...turn,
        partial: {
          reasoning: heldPartial.reasoning + turn.partial.reasoning,
          answer: heldPartial.answer + turn.partial.answer,
        },
      };
    } else {
      if (index > held.turns.length) return "refetch";
      turns[index] = turn;
    }
  }
  return { ...held, seq: patch.seq, row: patch.row, waiting: patch.waiting, summary: patch.summary, turns };
}

export function useStreamView(name: string): { view: StreamView | null; connected: boolean; missing: boolean } {
  const [view, setView] = useState<StreamView | null>(null);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let disposed = false;
    const st = { held: null as StreamView | null, fetching: false, buffered: [] as ViewPatch[] };

    const url = "/api/streams/" + encodeURIComponent(name);

    const applyOne = (patch: ViewPatch): void => {
      if (disposed) return;
      const held = st.held;
      if (held === null) {
        st.buffered.push(patch);
        void fetchWhole();
        return;
      }
      const result = applyPatch(held, patch);
      if (result === "ignore") return;
      if (result === "refetch") {
        void fetchWhole();
        return;
      }
      st.held = result;
      setView(result);
    };

    const fetchWhole = async (): Promise<void> => {
      if (disposed || st.fetching) return;
      st.fetching = true;
      let next: StreamView | null = null;
      let notFound = false;
      try {
        const res = await fetch(url);
        if (res.status === 404) notFound = true;
        else if (res.ok) next = (await res.json()) as StreamView;
      } catch {
        // Network error; keep the last view we have.
      } finally {
        st.fetching = false;
      }
      if (disposed) return;
      if (notFound) {
        setMissing(true);
        return;
      }
      if (next !== null) {
        setMissing(false);
        st.held = next;
        setView(next);
      }
      // Patches that arrived while the fetch was in flight, applied in order.
      const buffered = st.buffered;
      st.buffered = [];
      for (const patch of buffered) {
        if (disposed) return;
        if (st.fetching) st.buffered.push(patch);
        else applyOne(patch);
      }
    };

    const source = new EventSource("/api/updates?stream=" + encodeURIComponent(name));
    source.addEventListener("open", () => {
      if (disposed) return;
      setConnected(true);
      void fetchWhole();
    });
    source.addEventListener("stream", (event) => {
      if (disposed) return;
      let patch: ViewPatch;
      try {
        patch = JSON.parse((event as MessageEvent<string>).data) as ViewPatch;
      } catch {
        return;
      }
      if (st.fetching) st.buffered.push(patch);
      else applyOne(patch);
    });
    source.onerror = () => {
      if (disposed) return;
      setConnected(false);
    };

    // Fetch once on mount too, so a name the backend does not list is detected.
    void fetchWhole();

    return () => {
      disposed = true;
      source.close();
    };
  }, [name]);

  return { view, connected, missing };
}
