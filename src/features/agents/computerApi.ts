import { request } from "../../api";

export const computerPath = (id: string) => `/computers/${encodeURIComponent(id)}`;

export type ComputerAction =
  | { type: "click"; x: number; y: number; button: "left" | "right" | "double" }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "scroll"; delta: number };

/** Computer connections must never leave the controls waiting indefinitely. */
export async function computerRequest<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(cancel, 20_000);
  try {
    return await request<T>(path, body, method, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error("电脑连接超时。接管状态不会自动解除，请重新查看状态。", {
        cause: error,
      });
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
