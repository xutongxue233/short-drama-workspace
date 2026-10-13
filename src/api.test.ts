import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API boundary", () => {
  it("serializes mutations and forwards cancellation without persisting credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"id":"project-1"}', { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(
      request("/projects", { name: "故事" }, "POST", { signal: controller.signal }),
    ).resolves.toEqual({ id: "project-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"故事"}',
      signal: controller.signal,
    });
  });

  it("does not attach a request body to reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"projects":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    await request("/state", undefined, "GET");
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("preserves actionable API validation errors and their status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"error":"请先暂停项目"}', { status: 409 })),
    );
    await expect(request("/projects/1", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "请先暂停项目",
    });
  });

  it("reports a proxy failure instead of exposing HTML or a JSON parser exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })),
    );
    await expect(request("/state", undefined, "GET")).rejects.toMatchObject({
      status: 502,
      message: "请求失败 (502)，请检查本地 API 服务。",
    });
  });

  it("rejects malformed success responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));
    await expect(request("/state", undefined, "GET")).rejects.toBeInstanceOf(ApiError);
  });

  it("supports empty success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(request("/providers/1", undefined, "DELETE")).resolves.toBeUndefined();
  });

  it("preserves AbortError for callers to distinguish cancellation", async () => {
    const aborted = new DOMException("Request cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(request("/state", undefined, "GET")).rejects.toBe(aborted);
  });

  it("also preserves cancellation while the response body is being read", async () => {
    const aborted = new DOMException("Body cancelled", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () => Promise.reject(aborted),
      }),
    );
    await expect(request("/state", undefined, "GET")).rejects.toBe(aborted);
  });
});
