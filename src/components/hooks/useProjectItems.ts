import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../../api";

export interface ProjectItemPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  projectTotal?: number;
  savedCount?: number;
}

type PageState<T> = {
  path: string;
  pages: ProjectItemPage<T>[];
  metadata?: ProjectItemPage<T>;
  loading: boolean;
  error: string;
};

/** Read only the visible project's pages; a query change owns a new request session. */
export function useProjectItems<T extends { id: string }>({
  path,
  enabled,
  activeId,
}: {
  path: string;
  enabled: boolean;
  activeId?: string;
}) {
  const [state, setState] = useState<PageState<T>>({
    path: "",
    pages: [],
    loading: false,
    error: "",
  });
  const activeRef = useRef(activeId);
  const sessionRef = useRef<{
    more: () => void;
    retry: () => void;
    refresh: (id?: string) => Promise<void>;
  } | null>(null);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let pages: ProjectItemPage<T>[] = [];
    let metadata: ProjectItemPage<T> | undefined;
    let error = "";
    let failedOffset = 0;
    let generation = 0;
    const requests = new Map<number, AbortController>();
    const foreground = new Set<number>();
    const publish = () => {
      if (!closed)
        setState({
          path,
          pages: [...pages],
          metadata,
          loading: foreground.size > 0,
          error,
        });
    };
    const load = async (offset: number, silent = false) => {
      if (closed || requests.has(offset)) return;
      const controller = new AbortController();
      const requestGeneration = generation;
      requests.set(offset, controller);
      if (!silent) foreground.add(offset);
      publish();
      try {
        const page = await request<ProjectItemPage<T>>(
          `${path}&limit=24&offset=${offset}`,
          undefined,
          "GET",
          { signal: controller.signal },
        );
        if (closed || controller.signal.aborted || requestGeneration !== generation)
          return;
        const previousHead = pages.find((item) => item.offset === 0);
        // An insertion/deletion moves offset boundaries, even if it happened
        // beyond the first page. Drop older windows when the total changes too.
        if (
          offset === 0 &&
          previousHead &&
          (previousHead.total !== page.total ||
            previousHead.items.map((item) => item.id).join("\0") !==
              page.items.map((item) => item.id).join("\0"))
        ) {
          generation += 1;
          pages = [];
          error = "";
          failedOffset = 0;
          for (const [pendingOffset, pending] of requests) {
            if (pendingOffset !== 0) {
              pending.abort();
              requests.delete(pendingOffset);
              foreground.delete(pendingOffset);
            }
          }
        }
        pages = [...pages.filter((item) => item.offset !== offset), page].sort(
          (left, right) => left.offset - right.offset,
        );
        metadata = page;
        if (failedOffset === offset) error = "";
      } catch (failure) {
        if (closed || controller.signal.aborted || requestGeneration !== generation)
          return;
        failedOffset = offset;
        error = failure instanceof Error ? failure.message : "加载失败，请重试。";
      } finally {
        if (requests.get(offset) === controller) {
          requests.delete(offset);
          foreground.delete(offset);
        }
        publish();
      }
    };
    const refresh = async (id?: string, force = false) => {
      if (closed) return;
      const current = pages.find((page) =>
        page.items.some((item) => item.id === (id || activeRef.current)),
      );
      const offset = current?.offset ?? pages.at(-1)?.offset ?? 0;
      // A mutation must not reuse an in-flight read taken before it completed.
      if (force) {
        for (const target of new Set([0, offset])) {
          requests.get(target)?.abort();
          requests.delete(target);
          foreground.delete(target);
        }
      }
      const before = generation;
      await load(0, pages.length > 0);
      if (offset && before === generation) await load(offset, true);
    };
    sessionRef.current = {
      more: () => {
        const last = pages.at(-1);
        if (last?.hasMore) void load(last.offset + last.limit);
      },
      retry: () => void load(failedOffset),
      refresh: (id) => refresh(id, true),
    };
    void load(0);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && requests.size === 0) void refresh();
    }, 2000);
    return () => {
      closed = true;
      window.clearInterval(timer);
      for (const controller of requests.values()) controller.abort();
      sessionRef.current = null;
    };
  }, [path, enabled]);

  const current = enabled && state.path === path ? state : undefined;
  const seen = new Set<string>();
  const items = (current?.pages ?? []).flatMap((page) =>
    page.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  );
  const loadMore = useCallback(() => sessionRef.current?.more(), []);
  const retry = useCallback(() => sessionRef.current?.retry(), []);
  const refresh = useCallback(
    async (id?: string) => sessionRef.current?.refresh(id),
    [],
  );
  return {
    items,
    metadata: current?.metadata,
    loading: enabled && (!current || current.loading),
    error: current?.error || "",
    hasMore: current?.pages.at(-1)?.hasMore ?? false,
    loadMore,
    retry,
    refresh,
  };
}
