import { useEffect, useState } from "react";
import type { ListResponse } from "../server/poller.ts";

export function useLiveList(): { list: ListResponse | null; connected: boolean } {
  const [list, setList] = useState<ListResponse | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/updates");
    source.addEventListener("list", (event) => {
      setList(JSON.parse((event as MessageEvent<string>).data) as ListResponse);
      setConnected(true);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return { list, connected };
}
