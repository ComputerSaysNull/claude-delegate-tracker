import { useEffect, useState } from "react";
import type { ListResponse } from "../server/poller.ts";
import type { ModelFigures } from "../server/metrics.ts";
import type { NodeFigures } from "../server/nodes.ts";

export type Cluster = { model: ModelFigures; nodes: NodeFigures[] };

export function useLiveList(): {
  list: ListResponse | null;
  cluster: Cluster | null;
  connected: boolean;
} {
  const [list, setList] = useState<ListResponse | null>(null);
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/updates");
    source.addEventListener("list", (event) => {
      setList(JSON.parse((event as MessageEvent<string>).data) as ListResponse);
      setConnected(true);
    });
    source.addEventListener("cluster", (event) => {
      setCluster(JSON.parse((event as MessageEvent<string>).data) as Cluster);
      setConnected(true);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return { list, cluster, connected };
}
