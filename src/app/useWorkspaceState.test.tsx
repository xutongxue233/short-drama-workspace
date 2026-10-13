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
  it("serializes a write-after-poll refresh and never applies the pre-write snapshot", async () => {
    const older = deferred<WorkspaceState>();
    const newer = deferred<WorkspaceState>();
    let reads = 0;
    vi.mocked(request).mockImplementation((path) => {
      if (path !== "/state") return Promise.resolve({});
      return ++reads === 1 ? older.promise : newer.promise;
    });
    const { result } = renderHook(useWorkspaceState);
    let writing!: Promise<unknown>;
    await act(async () => {
      writing = result.current.mutate("/projects", { name: "new" });
      await Promise.resolve();
    });
    expect(reads).toBe(1);
    const latestSnapshot = snapshot();
    await act(async () => {
      older.resolve(snapshot());
      await older.promise;
    });
    expect(result.current.state).toBeNull();
    expect(reads).toBe(2);
    await act(async () => {
      newer.resolve(latestSnapshot);
      await writing;
    });
    expect(result.current.state).toBe(latestSnapshot);
  });

  it("applies slow successful polls while coalescing timer and manual refreshes", async () => {
    const slow = deferred<WorkspaceState>();
    vi.mocked(request).mockReturnValue(slow.promise);
    const { result } = renderHook(useWorkspaceState);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      void result.current.refresh();
    });
    expect(request).toHaveBeenCalledTimes(1);
    const next = snapshot();
    await act(async () => slow.resolve(next));
    expect(result.current.state).toBe(next);
  });

  it("retries synchronization without repeating a committed mutation", async () => {
    let reads = 0;
    const updated = snapshot();
    vi.mocked(request).mockImplementation((path) => {
      if (path !== "/state") return Promise.resolve({ id: "created" });
      reads += 1;
      if (reads === 2) return Promise.reject(new Error("offline"));
      return Promise.resolve(reads === 1 ? snapshot() : updated);
    });
    const { result } = renderHook(useWorkspaceState);
    await act(async () => {
      await Promise.resolve();
    });
    let completed = false;
    let writing!: Promise<unknown>;
    await act(async () => {
      writing = result.current.mutate("/projects", {}).then(() => {
        completed = true;
      });
    });
    expect(completed).toBe(false);
    expect(result.current.error).toContain("修改已保存");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await writing;
    });
    expect(completed).toBe(true);
    expect(result.current.state).toBe(updated);
    expect(
      vi.mocked(request).mock.calls.filter(([path]) => path === "/projects"),
    ).toHaveLength(1);
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
