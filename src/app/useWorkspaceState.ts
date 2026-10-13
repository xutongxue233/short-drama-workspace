import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, request } from "../api";
import type { Action, ToastMessage } from "../shared/contracts";
import type { WorkspaceState } from "../types";

const WORKSPACE_POLL_INTERVAL_MS = 2000;

/** Owns server snapshots, mutation serialization and transient notifications. */
export function useWorkspaceState(scope?: {
  projectId: string;
  fullHistory?: boolean;
}) {
  const query = new URLSearchParams({ compact: "1" });
  if (scope?.projectId) query.set("projectId", scope.projectId);
  if (scope?.fullHistory) query.set("history", "full");
  const snapshotPath = scope ? `/state?${query}` : "/state";
  const requestPath = useRef(snapshotPath);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const lifecycle = useRef(0);
  const mounted = useRef(true);
  const pendingSnapshot = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const synchronizations = useRef(
    new Set<{
      revision: number;
      resolve: () => void;
      reject: (error: Error) => void;
    }>(),
  );
  const actionPending = useRef(false);
  const notify = useCallback(
    (message: string, kind: "success" | "error" = "success") => {
      if (!mounted.current) return;
      setToast({ message, kind });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(
        () => setToast(null),
        kind === "error" ? 6500 : 4500,
      );
    },
    [],
  );
  const refresh = useCallback(function refreshSnapshot(): Promise<void> {
    if (!mounted.current) return Promise.resolve();
    if (pendingSnapshot.current) return pendingSnapshot.current.promise;
    const seq = revision.current;
    const currentLifecycle = lifecycle.current;
    const controller = new AbortController();
    const isCurrent = () => mounted.current && currentLifecycle === lifecycle.current;
    const promise = (async () => {
      try {
        const next = await request<WorkspaceState>(
          requestPath.current,
          undefined,
          "GET",
          {
            signal: controller.signal,
          },
        );
        if (isCurrent() && seq === revision.current) {
          setState(next);
          setError("");
          for (const pending of synchronizations.current) {
            if (pending.revision <= seq) {
              synchronizations.current.delete(pending);
              pending.resolve();
            }
          }
        }
      } catch (error) {
        if (
          isCurrent() &&
          error instanceof ApiError &&
          [401, 403].includes(error.status)
        ) {
          setState(null);
          for (const pending of synchronizations.current) pending.reject(error);
          synchronizations.current.clear();
        }
        if (isCurrent() && seq === revision.current && !controller.signal.aborted)
          setError(
            `${synchronizations.current.size ? "修改已保存，正在重新同步，请勿重复提交。" : ""}${(error as Error).message}`,
          );
      } finally {
        if (pendingSnapshot.current?.controller === controller)
          pendingSnapshot.current = null;
        // A write committed during this read. Start a fresh read before releasing
        // any caller that depends on the committed state; timers share this read.
        if (isCurrent() && seq !== revision.current) void refreshSnapshot();
      }
    })();
    pendingSnapshot.current = { controller, promise };
    return promise;
  }, []);
  useEffect(() => {
    if (requestPath.current === snapshotPath) return;
    requestPath.current = snapshotPath;
    revision.current += 1;
    pendingSnapshot.current?.controller.abort();
    pendingSnapshot.current = null;
    void refresh();
  }, [snapshotPath, refresh]);
  useEffect(() => {
    mounted.current = true;
    const waiting = synchronizations.current;
    void refresh();
    const interval = setInterval(() => void refresh(), WORKSPACE_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      mounted.current = false;
      lifecycle.current += 1;
      revision.current += 1;
      pendingSnapshot.current?.controller.abort();
      pendingSnapshot.current = null;
      for (const pending of waiting)
        pending.reject(new DOMException("工作台已关闭", "AbortError"));
      waiting.clear();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  const mutate = useCallback(
    async (path: string, body?: unknown, method = "POST") => {
      const currentLifecycle = lifecycle.current;
      try {
        const result = await request(path, body, method);
        if (!mounted.current || currentLifecycle !== lifecycle.current)
          throw new DOMException("工作台已关闭", "AbortError");
        const seq = ++revision.current;
        const synchronized = new Promise<void>((resolve, reject) => {
          synchronizations.current.add({ revision: seq, resolve, reject });
        });
        void refresh();
        // A failed GET is retried by polling, never by repeating the committed
        // write. Keep dependent forms busy until a fresh snapshot is applied.
        await synchronized;
        return result;
      } catch (error) {
        if (mounted.current && currentLifecycle === lifecycle.current)
          notify((error as Error).message, "error");
        throw error;
      }
    },
    [notify, refresh],
  );
  const action: Action = useCallback(
    async (path, body, success, method = "POST") => {
      if (actionPending.current) return false;
      const currentLifecycle = lifecycle.current;
      actionPending.current = true;
      setBusy(true);
      try {
        await mutate(path, body === undefined && method === "POST" ? {} : body, method);
        if (success && currentLifecycle === lifecycle.current) notify(success);
        return true;
      } catch {
        return false;
      } finally {
        actionPending.current = false;
        if (mounted.current && currentLifecycle === lifecycle.current) setBusy(false);
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
