import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../api";
import type { WorkspaceState } from "../types";
import { useWorkspaceState } from "./useWorkspaceState";

vi.mock("../api", () => ({ request: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const snapshot = (): WorkspaceState => ({ projects: [], agents: [], providers: [] });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(request).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("workspace state lifecycle", () => {
  it("keeps a newer server snapshot when an older poll finishes late", async () => {
    const older = deferred<WorkspaceState>();
    const newer = deferred<WorkspaceState>();
    vi.mocked(request)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = renderHook(useWorkspaceState);
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    const latestSnapshot = snapshot();
    await act(async () => {
      newer.resolve(latestSnapshot);
      await refreshing;
    });
    expect(result.current.state).toBe(latestSnapshot);
    await act(async () => {
      older.resolve(snapshot());
      await older.promise;
    });
    expect(result.current.state).toBe(latestSnapshot);
  });

  it("cancels pending snapshot requests and removes timers on unmount", () => {
    vi.mocked(request).mockReturnValue(deferred<WorkspaceState>().promise);
    const { unmount } = renderHook(useWorkspaceState);
    const signal = vi.mocked(request).mock.calls[0][3]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("prevents repeated creation commands while the first is pending", async () => {
    const mutation = deferred<unknown>();
    vi.mocked(request).mockImplementation((path) =>
      path === "/state" ? Promise.resolve(snapshot()) : mutation.promise,
    );
    const { result } = renderHook(useWorkspaceState);
    await act(async () => {
      await Promise.resolve();
    });
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.action("/projects/demo/run");
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      expect(await result.current.action("/projects/demo/run")).toBe(false);
    });
    await act(async () => {
      mutation.resolve({});
      expect(await first).toBe(true);
    });
    expect(result.current.busy).toBe(false);
    expect(
      vi.mocked(request).mock.calls.filter(([path]) => path === "/projects/demo/run"),
    ).toHaveLength(1);
  });

  it("reports failures and allows the next action after the failed command", async () => {
    let fail = true;
    vi.mocked(request).mockImplementation((path) => {
      if (path === "/state") return Promise.resolve(snapshot());
      return fail ? Promise.reject(new Error("请先完成风格确认")) : Promise.resolve({});
    });
    const { result } = renderHook(useWorkspaceState);
    await act(async () => {
      expect(await result.current.action("/projects/demo/run")).toBe(false);
    });
    expect(result.current.toast).toEqual({
      message: "请先完成风格确认",
      kind: "error",
    });
    expect(result.current.busy).toBe(false);
    fail = false;
    await act(async () => {
      expect(await result.current.action("/projects/demo/run")).toBe(true);
    });
    expect(result.current.busy).toBe(false);
  });
});
