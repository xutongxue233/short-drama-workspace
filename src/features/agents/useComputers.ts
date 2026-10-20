import { useCallback, useEffect, useState } from "react";
import type { Computer } from "../../types";
import { computerRequest } from "./computerApi";

export function useComputers(enabled: boolean) {
  const [computers, setComputers] = useState<Computer[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number;
    async function load() {
      try {
        const result = await computerRequest<{ computers: Computer[] }>(
          "/computers",
          undefined,
          "GET",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setComputers(result.computers);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "无法加载电脑列表");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 5000);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, revision]);
  return { computers, error, refresh };
}
