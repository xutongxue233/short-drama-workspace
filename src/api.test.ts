import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  onSessionExpired,
  request,
  requestScreen,
  setApiSession,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setApiSession();
});

describe("API boundary", () => {
  it("fetches computer images with the authenticated same-origin boundary and no cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("pixels", { headers: { "Content-Type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const result = await requestScreen("/computers/1/screen", controller.signal);
    expect(result.type).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/computers/1/screen",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      }),
    );
  });

  it("rejects computer images from a previous login session", async () => {
    let finish!: (blob: Blob) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: () =>
          new Promise<Blob>((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const pending = requestScreen("/computers/1/screen");
    await Promise.resolve();
    setApiSession("new-user-token", "new-user");
    finish(new Blob(["private-screen"], { type: "image/png" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects non-image computer responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("not a screen", { headers: { "Content-Type": "text/html" } }),
        ),
    );
    await expect(requestScreen("/computers/1/screen")).rejects.toThrow(
      "电脑未返回有效画面",
    );
  });
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
      credentials: "same-origin",
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

  it("keeps CSRF in memory and sends it only on writes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    setApiSession("csrf-secret");
    await request("/projects", {}, "POST");
    await request("/state", undefined, "GET");
    expect(fetchMock.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("csrf-secret");
    expect(fetchMock.mock.calls[1][1].headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("notifies expiry immediately even if the 401 response is HTML", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("expired", { status: 401 })),
    );
    await expect(request("/state", undefined, "GET")).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("ignores an old account's late 401 instead of logging out the new account", async () => {
    let complete!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
      ),
    );
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    const pending = request("/state", undefined, "GET");
    setApiSession("new-account-token");
    complete(new Response("{}", { status: 401 }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("rejects old account data after a session change while parsing the response", async () => {
    let complete!: (value: unknown) => void;
    const parsing = new Promise((resolve) => {
      complete = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => parsing }),
    );
    const pending = request("/state", undefined, "GET");
    await Promise.resolve();
    setApiSession("new-account-token");
    complete({ projects: [{ name: "private-old-account" }] });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a workspace belonging to a different cookie account before rendering it", async () => {
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    setApiSession("old-token", "old-user");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            currentUser: { id: "another-user" },
            projects: [{ id: "secret" }],
          }),
        ),
      ),
    );
    await expect(request("/state?compact=1", undefined, "GET")).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
    unsubscribe();
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
