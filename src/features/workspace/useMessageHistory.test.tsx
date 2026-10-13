import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api";
import type { Message, MessagePage, Project } from "../../types";
import { useMessageHistory } from "./useMessageHistory";

vi.mock("../../api", () => ({ request: vi.fn() }));

const messages = (start: number, end: number): Message[] =>
  Array.from({ length: end - start }, (_, index) => ({
    id: `m${start + index}`,
    agentId: "user",
    content: `消息 ${start + index}`,
    type: "text",
    createdAt: "2026-10-13T00:00:00Z",
  }));
function project(start = 60, end = 110, id = "one"): Project {
  return {
    id,
    name: id,
    description: "",
    genre: "悬疑",
    style: "动画",
    createdAt: "",
    updatedAt: "",
    members: [],
    assets: [],
    nodes: [],
    chapters: [],
    memory: { facts: [], decisions: [], summary: "", compressedCount: 0 },
    approval: null,
    running: false,
    currentEpisode: {
      id: "episode-2",
      number: 2,
      title: "",
      createdAt: "",
      startMessageIndex: 10,
      startAssetIds: [],
      startMaterialIds: [],
    },
    messages: messages(start, end),
    messagePage: {
      startIndex: start,
      nextBefore: start > 10 ? start : null,
      total: end - 10,
    },
  };
}
beforeEach(() => vi.mocked(request).mockReset());

describe("message pagination", () => {
  it("prepends this episode's older messages without slicing the compact page again", async () => {
    vi.mocked(request).mockResolvedValue({
      items: messages(10, 60),
      startIndex: 10,
      nextBefore: null,
      total: 100,
      episodeId: "episode-2",
    });
    const value = project();
    const { result } = renderHook(() => useMessageHistory(value));
    expect(result.current.messages).toHaveLength(50);
    expect(result.current.messages[0].id).toBe("m60");
    await act(async () => {
      expect(await result.current.loadEarlier()).toBe(true);
    });
    expect(request).toHaveBeenCalledWith(
      "/projects/one/messages?limit=50&before=60",
      undefined,
      "GET",
      expect.anything(),
    );
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].id).toBe("m10");
    expect(result.current.nextBefore).toBeNull();
  });

  it("retains messages leaving the latest page and keeps a contiguous boundary", async () => {
    const { result, rerender } = renderHook(({ value }) => useMessageHistory(value), {
      initialProps: { value: project() },
    });
    rerender({ value: project(65, 115) });
    expect(result.current.messages).toHaveLength(55);
    expect(result.current.nextBefore).toBe(60);
    rerender({ value: project(200, 250) });
    expect(result.current.messages).toHaveLength(50);
    expect(result.current.nextBefore).toBe(200);
    vi.mocked(request).mockResolvedValue({
      items: messages(150, 200),
      startIndex: 150,
      nextBefore: 150,
      total: 240,
      episodeId: "episode-2",
    });
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages[0].id).toBe("m150");
    expect(result.current.messages).toHaveLength(100);
  });

  it("caps automatically accumulated polling history at 200 messages and can explicitly load the trimmed page", async () => {
    const { result, rerender } = renderHook(({ value }) => useMessageHistory(value), {
      initialProps: { value: project(10, 60) },
    });
    for (const end of [110, 160, 210, 260, 310]) {
      rerender({ value: project(end - 50, end) });
      const start = Math.max(10, end - 200);
      expect(result.current.messages).toEqual(messages(start, end));
      expect(result.current.startIndex).toBe(start);
      expect(result.current.nextBefore).toBe(start > 10 ? start : null);
    }
    expect(request).not.toHaveBeenCalled();
    vi.mocked(request).mockResolvedValue({
      items: messages(60, 110),
      startIndex: 60,
      nextBefore: 60,
      total: 300,
      episodeId: "episode-2",
    });
    await act(async () => {
      expect(await result.current.loadEarlier()).toBe(true);
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/projects/one/messages?limit=50&before=110",
      undefined,
      "GET",
      expect.anything(),
    );
    expect(result.current.messages).toEqual(messages(60, 310));
    rerender({ value: project(280, 330) });
    expect(result.current.messages).toEqual(messages(60, 330));
    expect(result.current.nextBefore).toBe(60);
  });

  it("resets expanded history at a new episode even when the project is unchanged", async () => {
    vi.mocked(request).mockResolvedValue({
      items: messages(10, 60),
      startIndex: 10,
      nextBefore: null,
      total: 100,
      episodeId: "episode-2",
    });
    const { result, rerender } = renderHook(({ value }) => useMessageHistory(value), {
      initialProps: { value: project() },
    });
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages).toEqual(messages(10, 110));
    const next = project(110, 115);
    next.currentEpisode = {
      ...next.currentEpisode!,
      id: "episode-3",
      number: 3,
      startMessageIndex: 110,
    };
    next.messagePage = { startIndex: 110, nextBefore: null, total: 5 };
    rerender({ value: next });
    expect(result.current.messages).toEqual(messages(110, 115));
    expect(result.current.startIndex).toBe(110);
    expect(result.current.nextBefore).toBeNull();
    await act(async () => {
      expect(await result.current.loadEarlier()).toBe(false);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("aborts an old project's read and rejects its late result", async () => {
    let resolve!: (page: MessagePage) => void;
    vi.mocked(request).mockReturnValue(
      new Promise<MessagePage>((accept) => {
        resolve = accept;
      }),
    );
    const { result, rerender } = renderHook(({ value }) => useMessageHistory(value), {
      initialProps: { value: project() },
    });
    let loading!: Promise<boolean>;
    act(() => {
      loading = result.current.loadEarlier();
    });
    const signal = vi.mocked(request).mock.calls[0][3]?.signal;
    rerender({ value: project(10, 15, "two") });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve({
        items: messages(10, 60),
        startIndex: 10,
        nextBefore: null,
        total: 100,
        episodeId: "episode-2",
      });
      expect(await loading).toBe(false);
    });
    expect(result.current.messages).toHaveLength(5);
    expect(result.current.nextBefore).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("keeps current messages on failure and supports retry without duplicate requests", async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error("暂时离线"));
    const value = project();
    const { result } = renderHook(() => useMessageHistory(value));
    await act(async () => {
      expect(await result.current.loadEarlier()).toBe(false);
    });
    expect(result.current.error).toBe("暂时离线");
    expect(result.current.messages).toHaveLength(50);
    vi.mocked(request).mockResolvedValue({
      items: messages(10, 60),
      startIndex: 10,
      nextBefore: null,
      total: 100,
      episodeId: "episode-2",
    });
    await act(async () => {
      const first = result.current.loadEarlier();
      expect(await result.current.loadEarlier()).toBe(false);
      expect(await first).toBe(true);
    });
    expect(result.current.error).toBe("");
    expect(result.current.messages).toHaveLength(100);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
