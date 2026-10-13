import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";
import type { Action, ToastMessage } from "../shared/contracts";
import type { WorkspaceState } from "../types";

const WORKSPACE_POLL_INTERVAL_MS = 2000;

/** Owns server snapshots, mutation serialization and transient notifications. */
export function useWorkspaceState() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const pendingSnapshots = useRef(new Set<AbortController>());
  const actionPending = useRef(false);
  const notify = useCallback(
    (message: string, kind: "success" | "error" = "success") => {
      setToast({ message, kind });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(
        () => setToast(null),
        kind === "error" ? 6500 : 4500,
      );
    },
    [],
  );
  const refresh = useCallback(async () => {
    const seq = ++revision.current;
    const controller = new AbortController();
    pendingSnapshots.current.add(controller);
    try {
      const next = await request<WorkspaceState>("/state", undefined, "GET", {
        signal: controller.signal,
      });
      if (seq === revision.current) {
        setState(next);
        setError("");
      }
    } catch (error) {
      if (seq === revision.current) setError((error as Error).message);
    } finally {
      pendingSnapshots.current.delete(controller);
    }
  }, []);
  useEffect(() => {
    const controllers = pendingSnapshots.current;
    void refresh();
    const interval = setInterval(() => void refresh(), WORKSPACE_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      revision.current += 1;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  const mutate = useCallback(
    async (path: string, body?: unknown, method = "POST") => {
      try {
        const result = await request(path, body, method);
        await refresh();
        return result;
      } catch (error) {
        notify((error as Error).message, "error");
        throw error;
      }
    },
    [notify, refresh],
  );
  const action: Action = useCallback(
    async (path, body, success, method = "POST") => {
      if (actionPending.current) return false;
      actionPending.current = true;
      setBusy(true);
      try {
        await mutate(path, body === undefined && method === "POST" ? {} : body, method);
        if (success) notify(success);
        return true;
      } catch {
        return false;
      } finally {
        actionPending.current = false;
        setBusy(false);
      }
    },
    [mutate, notify],
  );
  return {
    state,
    error,
    busy,
    toast,
    refresh,
    mutate,
    action,
    notify,
    dismissToast: () => setToast(null),
  };
}
