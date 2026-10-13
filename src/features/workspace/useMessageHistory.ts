import { useEffect, useMemo, useRef, useState } from "react";
import { request } from "../../api";
import type { Message, MessagePage, Project } from "../../types";

/** Keep explicitly loaded history while the project snapshot refreshes its latest page. */
export function useMessageHistory(project: Project) {
  const episodeStart = project.currentEpisode?.startMessageIndex ?? 0;
  const episodeId = project.currentEpisode?.id ?? null;
  const scope = `${project.id}:${episodeId}:${episodeStart}`;
  const page = project.messagePage;
  const [cache, setCache] = useState<{
    scope: string;
    items: Map<number, Message>;
    expanded: boolean;
  }>(() => ({ scope, items: new Map(), expanded: false }));
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState({ scope: "", message: "" });
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [scope],
  );

  const history = useMemo(() => {
    if (!page) return { messages: project.messages, startIndex: 0, nextBefore: null };
    const items = new Map(cache.scope === scope ? cache.items : []);
    project.messages.forEach((message, index) =>
      items.set(page.startIndex + index, message),
    );
    const end = page.startIndex + project.messages.length;
    const oldest =
      cache.scope === scope && cache.expanded
        ? episodeStart
        : Math.max(episodeStart, end - 200);
    let startIndex = end;
    // Never show two pages with a hidden gap when many new messages arrive at once.
    while (startIndex > oldest && items.has(startIndex - 1)) startIndex -= 1;
    const messages = Array.from({ length: end - startIndex }, (_, index) =>
      items.get(startIndex + index)!,
    );
    return {
      messages,
      startIndex,
      nextBefore: startIndex > episodeStart ? startIndex : null,
    };
  }, [cache, scope, page, project.messages, episodeStart]);

  useEffect(() => {
    if (!page) return;
    setCache((previous) => {
      const items = new Map(previous.scope === scope ? previous.items : []);
      project.messages.forEach((message, index) =>
        items.set(page.startIndex + index, message),
      );
      const expanded = previous.scope === scope && previous.expanded;
      const end = page.startIndex + project.messages.length;
      for (const index of items.keys())
        if (index >= end || (!expanded && index < end - 200)) items.delete(index);
      return { scope, items, expanded };
    });
  }, [scope, page, project.messages]);

  const loadEarlier = async () => {
    if (history.nextBefore === null || controller.current) return false;
    const active = new AbortController();
    controller.current = active;
    setPending(scope);
    setFailure({ scope, message: "" });
    try {
      const result = await request<MessagePage>(
        `/projects/${encodeURIComponent(project.id)}/messages?limit=50&before=${history.nextBefore}`,
        undefined,
        "GET",
        { signal: active.signal },
      );
      if (active.signal.aborted || result.episodeId !== episodeId) return false;
      setCache((previous) => {
        const items = new Map(previous.scope === scope ? previous.items : []);
        result.items.forEach((message, index) =>
          items.set(result.startIndex + index, message),
        );
        return { scope, items, expanded: true };
      });
      return true;
    } catch (error) {
      if (!active.signal.aborted)
        setFailure({
          scope,
          message: error instanceof Error ? error.message : "聊天记录加载失败",
        });
      return false;
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setPending("");
      }
    }
  };
  return {
    ...history,
    loadEarlier,
    loading: pending === scope,
    error: failure.scope === scope ? failure.message : "",
  };
}
