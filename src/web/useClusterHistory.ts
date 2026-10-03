// The cluster figures over time, kept client-side: the server's history loaded once on
// mount, then grown as the live `cluster` events arrive.
import { useEffect, useState } from "react";
import { NODE_KEYS, type ClusterHistory, type Series } from "../server/history.ts";
import type { Cluster } from "./useLiveList.ts";
import { appendPoint, pointFromModel, pointFromNode } from "./sparkData.ts";

function emptySeries(keys: readonly string[]): Series {
  const values: Record<string, (number | null)[]> = {};
  for (const key of keys) values[key] = [];
  return { at: [], values };
}

// The history with one cluster update's points added, trimmed to its window.
function withCluster(prev: ClusterHistory, cluster: Cluster): ClusterHistory {
  const windowMs = prev.windowSeconds * 1000;
  const modelPoint = pointFromModel(cluster.model);
  const model = modelPoint === null ? prev.model : appendPoint(prev.model, modelPoint.atMs, modelPoint.values, windowMs);
  const nodes = new Map<string, Series>();
  for (const { name, series } of prev.nodes) nodes.set(name, series);
  for (const node of cluster.nodes) {
    const existing = nodes.get(node.name) ?? emptySeries(NODE_KEYS);
    const point = pointFromNode(node);
    nodes.set(node.name, point === null ? existing : appendPoint(existing, point.atMs, point.values, windowMs));
  }
  return { windowSeconds: prev.windowSeconds, model, nodes: [...nodes].map(([name, series]) => ({ name, series })) };
}

export function useClusterHistory(cluster: Cluster | null): ClusterHistory | null {
  const [history, setHistory] = useState<ClusterHistory | null>(null);

  // Load the server's history once on mount. A failed or missing fetch leaves the history
  // to be built up entirely from the live cluster events below.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/cluster/history");
        if (!res.ok) return;
        const data = (await res.json()) as ClusterHistory;
        if (!cancelled) setHistory(data);
      } catch {
        // No server history yet; the live events below build it up.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fold each new cluster update in while rendering (React's pattern for state that follows
  // a prop). Until the server's history has loaded, its window is unknown, so updates wait;
  // the server's history already holds their points.
  const [seen, setSeen] = useState<Cluster | null>(null);
  if (cluster !== seen) {
    setSeen(cluster);
    if (cluster !== null) setHistory((prev) => (prev === null ? null : withCluster(prev, cluster)));
  }

  return history;
}
