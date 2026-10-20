import { useEffect, useRef, useState } from "react";
import { requestScreen } from "../../api";
import type { Computer } from "../../types";
import { computerPath, computerRequest, type ComputerAction } from "./computerApi";

/** Polls serially; input is only permitted with a fresh image and our human lock. */
export function useComputerSession(initial: Computer, userId: string) {
  const [computer, setComputer] = useState(initial);
  const [screenUrl, setScreenUrl] = useState("");
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [revision, setRevision] = useState(0);
  const state = useRef({
    mounted: false,
    busy: false,
    generation: 0,
    lastFrame: 0,
    computer: initial,
  });
  const operation = useRef<AbortController | null>(null);
  const id = initial.id;
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.lastFrame = 0;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: number;
    let imageUrl = "";
    let staleTimer: number;
    let controller: AbortController | null = null;
    async function poll() {
      if (state.current.busy) {
        timer = window.setTimeout(poll, 500);
        return;
      }
      const generation = state.current.generation;
      controller = new AbortController();
      const activeController = controller;
      const timeout = window.setTimeout(() => activeController.abort(), 10_000);
      const current = () =>
        !stopped && generation === state.current.generation && !state.current.busy;
      try {
        const result = await computerRequest<{ computers: Computer[] }>(
          "/computers",
          undefined,
          "GET",
          activeController.signal,
        );
        const latest = result.computers.find((item) => item.id === id);
        if (!latest) throw new Error("这台电脑已移除，请关闭窗口后重新选择。");
        if (!current()) return;
        state.current.computer = latest;
        setComputer(latest);
        const blob = await requestScreen(
          `${computerPath(id)}/screen`,
          activeController.signal,
        );
        if (!current()) return;
        const nextUrl = URL.createObjectURL(blob);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = nextUrl;
        state.current.lastFrame = Date.now();
        setScreenUrl(nextUrl);
        setOnline(true);
        setError("");
        window.clearTimeout(staleTimer);
        staleTimer = window.setTimeout(() => {
          state.current.lastFrame = 0;
          setOnline(false);
        }, 5000);
      } catch (cause) {
        if (!current()) return;
        state.current.lastFrame = 0;
        setOnline(false);
        setError(
          activeController.signal.aborted
            ? "电脑连接超时，正在重连。人工接管状态会继续保留。"
            : cause instanceof Error
              ? cause.message
              : "无法读取电脑画面，正在重连。",
        );
      } finally {
        window.clearTimeout(timeout);
        if (!stopped) timer = window.setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(staleTimer);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [id, revision]);

  const owned =
    computer.control.mode === "human" && computer.control.ownerId === userId;
  const canControl = owned && online && !busy;

  async function perform(kind: "takeover" | "release" | "actions", body: unknown) {
    const current = state.current;
    if (!current.mounted || current.busy) return false;
    if (
      kind === "actions" &&
      (current.computer.control.mode !== "human" ||
        current.computer.control.ownerId !== userId ||
        Date.now() - current.lastFrame > 5000 ||
        !current.lastFrame)
    )
      return false;
    if (
      kind === "takeover" &&
      (!current.lastFrame ||
        Date.now() - current.lastFrame > 5000 ||
        current.computer.control.mode === "human")
    )
      return false;
    current.busy = true;
    current.generation += 1;
    current.lastFrame = 0;
    setBusy(true);
    setOnline(false);
    setError("");
    setCommandError("");
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await computerRequest<{ computer?: Computer }>(
        `${computerPath(id)}/${kind}`,
        body,
        "POST",
        controller.signal,
      );
      if (!current.mounted) return false;
      if (result.computer) {
        current.computer = result.computer;
        setComputer(result.computer);
      }
      return true;
    } catch (cause) {
      if (current.mounted)
        setCommandError(
          cause instanceof Error ? cause.message : "操作失败，请重新查看电脑状态。",
        );
      return false;
    } finally {
      if (current.mounted) {
        current.busy = false;
        setBusy(false);
        setRevision((value) => value + 1);
      }
    }
  }
  function imageFailed() {
    state.current.lastFrame = 0;
    setOnline(false);
    setError("画面加载失败，操作已禁用。正在重连电脑。");
  }
  return {
    computer,
    screenUrl,
    online,
    busy,
    error: commandError || error,
    owned,
    canControl,
    imageFailed,
    takeover: () => perform("takeover", {}),
    release: (force = false) => perform("release", force ? { force: true } : {}),
    send: (action: ComputerAction) => perform("actions", action),
  };
}
