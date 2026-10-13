import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api";
import type { Material, Project } from "../../types";
import { MaterialLibrary } from "./MaterialLibrary";
import {
  collectMaterials,
  formatMaterialBytes,
  materialPreviewUrl,
} from "./materialUtils";

vi.mock("../../api", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
afterEach(() => vi.useRealTimers());

const material = (changes: Partial<Material> = {}): Material => ({
  id: "image-1",
  name: "长生定妆初稿",
  type: "image",
  projectId: "p1",
  sourceUrl: "https://images.example.test/result.png?token=secret",
  url: "/api/media/image-1/file",
  status: "local",
  bytes: 2048,
  model: "gpt-image-2.5",
  createdAt: "2026-10-12T09:00:00.000Z",
  ...changes,
});
const project = (id = "p1", materials?: Material[]): Project => ({
  id,
  name: id === "p1" ? "借邪骨" : "另一个故事",
  description: "",
  genre: "悬疑",
  style: "二次元",
  createdAt: "",
  updatedAt: "",
  members: [],
  messages: [],
  nodes: [],
  assets: [],
  materials,
  chapters: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  approval: null,
  running: false,
});

const materialPage = (items: Material[], changes = {}) => ({
  items,
  total: items.length,
  projectTotal: items.length,
  savedCount: items.filter((item) => item.status === "local").length,
  offset: 0,
  limit: 24,
  hasMore: false,
  ...changes,
});

describe("remote MaterialLibrary", () => {
  it("loads only one page, then reads the next page and searches on the server", async () => {
    vi.mocked(request)
      .mockResolvedValueOnce(
        materialPage([material()], {
          total: 25,
          projectTotal: 25,
          savedCount: 10,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        materialPage([material({ id: "older", name: "旧素材" })], {
          total: 25,
          projectTotal: 25,
          savedCount: 10,
          offset: 24,
        }),
      )
      .mockResolvedValueOnce(
        materialPage([material({ id: "search", name: "搜索到未加载的素材" })], {
          projectTotal: 25,
          savedCount: 10,
        }),
      );
    render(
      <MaterialLibrary
        remote
        projects={[{ id: "p1", name: "借邪骨", running: false }]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    await screen.findByText("长生定妆初稿");
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText("25 份素材")).toBeTruthy();
    expect(screen.getByText("10 份已保存")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "加载更多素材" }));
    await screen.findByText("旧素材");
    expect(vi.mocked(request).mock.calls[1][0]).toContain("offset=24");
    expect(screen.getByText("长生定妆初稿")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索素材"), {
      target: { value: "未加载" },
    });
    expect(screen.queryByText("旧素材")).toBeNull();
    await screen.findByText("搜索到未加载的素材");
    const query = new URL(vi.mocked(request).mock.calls[2][0], "https://local")
      .searchParams;
    expect(query.get("q")).toBe("未加载");
    expect(query.get("offset")).toBe("0");
    expect(screen.getByText("1 份素材")).toBeTruthy();
  });

  it("ignores a late response from the previous project even if fetch ignores cancellation", async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(request)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(
        materialPage([material({ projectId: "p2", name: "城市夜景" })]),
      );
    const props = {
      remote: true,
      projects: [project("p1"), project("p2")],
      busy: false,
      onAction: vi.fn(),
    };
    const { rerender } = render(<MaterialLibrary {...props} projectId="p1" />);
    const oldSignal = vi.mocked(request).mock.calls[0][3]?.signal;
    rerender(<MaterialLibrary {...props} projectId="p2" />);
    await screen.findByText("城市夜景");
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(materialPage([material()])));
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    expect(screen.getByText("城市夜景")).toBeTruthy();
  });

  it("retains loaded items after a page failure and retries the failed offset", async () => {
    vi.mocked(request)
      .mockResolvedValueOnce(materialPage([material()], { total: 25, hasMore: true }))
      .mockRejectedValueOnce(new Error("读取素材失败"))
      .mockResolvedValueOnce(
        materialPage([material({ id: "next", name: "第二页" })], {
          total: 25,
          offset: 24,
        }),
      );
    render(
      <MaterialLibrary remote projects={[project()]} busy={false} onAction={vi.fn()} />,
    );
    await screen.findByText("长生定妆初稿");
    fireEvent.click(screen.getByRole("button", { name: "加载更多素材" }));
    await screen.findByRole("alert");
    expect(screen.getByText("长生定妆初稿")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试加载素材" }));
    await screen.findByText("第二页");
    expect(vi.mocked(request).mock.calls[2][0]).toContain("offset=24");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refreshes the open preview and saved total after saving without a workspace download", async () => {
    vi.mocked(request)
      .mockResolvedValueOnce(
        materialPage([
          material({ status: "remote", url: "https://images.example.test/result.png" }),
        ]),
      )
      .mockResolvedValueOnce(materialPage([material()]));
    const action = vi.fn().mockResolvedValue(true);
    render(
      <MaterialLibrary remote projects={[project()]} busy={false} onAction={action} />,
    );
    await screen.findByText("长生定妆初稿");
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "保存到本地 长生定妆初稿" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
        "/api/media/image-1/file",
      ),
    );
    expect(screen.getByText("1 份已保存")).toBeTruthy();
    expect(action).toHaveBeenCalledWith(
      "/projects/p1/materials/image-1/download",
      {},
      "素材保存状态已更新",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("polls at most the first and active preview pages and closes a deleted preview", async () => {
    vi.useFakeTimers();
    const pages = [
      materialPage([material()], { total: 49, hasMore: true }),
      materialPage([material({ id: "middle", name: "中间页" })], {
        total: 49,
        offset: 24,
        hasMore: true,
      }),
      materialPage([material({ id: "oldest", name: "最后页" })], {
        total: 49,
        offset: 48,
      }),
    ];
    vi.mocked(request).mockImplementation(
      async (path) =>
        pages[Number(new URL(path, "https://local").searchParams.get("offset")) / 24],
    );
    render(
      <MaterialLibrary remote projects={[project()]} busy={false} onAction={vi.fn()} />,
    );
    await act(async () => {});
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "加载更多素材" })),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "加载更多素材" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "预览 中间页" }));
    vi.mocked(request).mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      vi
        .mocked(request)
        .mock.calls.map(([path]) =>
          new URL(path, "https://local").searchParams.get("offset"),
        ),
    ).toEqual(["0", "24"]);
    pages[1] = materialPage([], { offset: 24 });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("replaces a pre-save polling request so a delayed response cannot undo the saved preview", async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: unknown) => void;
    const pending = material({
      status: "remote",
      url: "https://images.example.test/result.png",
    });
    vi.mocked(request)
      .mockResolvedValueOnce(materialPage([pending]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      )
      .mockResolvedValueOnce(materialPage([material()]));
    render(
      <MaterialLibrary
        remote
        projects={[project()]}
        busy={false}
        onAction={vi.fn().mockResolvedValue(true)}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    const pollSignal = vi.mocked(request).mock.calls[1][3]?.signal;
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "保存到本地 长生定妆初稿" }),
      ),
    );
    expect(pollSignal?.aborted).toBe(true);
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      "/api/media/image-1/file",
    );
    await act(async () => resolvePoll(materialPage([pending])));
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      "/api/media/image-1/file",
    );
  });

  it("discards stale offset pages when a middle item is deleted without changing the first page", async () => {
    vi.useFakeTimers();
    const items = Array.from({ length: 49 }, (_, index) =>
      material({ id: `item-${index + 1}`, name: `素材 ${index + 1}` }),
    );
    vi.mocked(request).mockImplementation(async (path) => {
      const offset = Number(new URL(path, "https://local").searchParams.get("offset"));
      return materialPage(items.slice(offset, offset + 24), {
        total: items.length,
        projectTotal: items.length,
        savedCount: items.length,
        offset,
        hasMore: offset + 24 < items.length,
      });
    });
    render(
      <MaterialLibrary remote projects={[project()]} busy={false} onAction={vi.fn()} />,
    );
    await act(async () => {});
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "加载更多素材" })),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "加载更多素材" })),
    );
    expect(screen.getByText("49 份素材")).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览 素材 30" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览 素材 49" })).toBeTruthy();

    items.splice(29, 1);
    vi.mocked(request).mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText("48 份素材")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "预览 素材 30" })).toBeNull();
    expect(screen.queryByRole("button", { name: "预览 素材 49" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^预览 素材 / })).toHaveLength(24);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "加载更多素材" })),
    );
    expect(screen.getAllByRole("button", { name: /^预览 素材 / })).toHaveLength(48);
    expect(screen.queryByRole("button", { name: "预览 素材 30" })).toBeNull();
    expect(screen.getByRole("button", { name: "预览 素材 31" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览 素材 49" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加载更多素材" })).toBeNull();
  });
});

describe("MaterialLibrary", () => {
  it("opens older projects without materials and offers project-scoped import", () => {
    const action = vi.fn().mockResolvedValue(true);
    render(
      <MaterialLibrary
        projects={[project()]}
        projectId="p1"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText("暂无素材")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "补存历史素材" }));
    expect(action.mock.calls[0][0]).toBe("/projects/p1/materials/import");
  });
  it("shows only the initial project, then falls back when that project is removed", () => {
    const first = project("p1", [material()]);
    const second = project("p2", [
      material({ id: "image-2", projectId: "p2", name: "城市夜景" }),
    ]);
    const action = vi.fn();
    const { rerender } = render(
      <MaterialLibrary
        projects={[first, second]}
        initialProjectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByLabelText("素材所属项目").textContent).toBe("另一个故事");
    expect(screen.getByText("城市夜景")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预览 城市夜景" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    rerender(
      <MaterialLibrary
        projects={[first]}
        initialProjectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByLabelText("素材所属项目").textContent).toBe("借邪骨");
    expect(screen.getByText("长生定妆初稿")).toBeTruthy();
    expect(screen.queryByText("城市夜景")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("defaults to the first project and resets filters when choosing another project", async () => {
    const first = project("p1", [material()]);
    const second = project("p2", [
      material({
        id: "video-2",
        projectId: "p2",
        name: "城市夜景",
        type: "video",
        status: "remote",
      }),
    ]);
    const action = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <MaterialLibrary projects={[first, second]} busy={false} onAction={action} />,
    );
    expect(screen.getByText("长生定妆初稿")).toBeTruthy();
    expect(screen.queryByText("城市夜景")).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "素材类型" })).getByRole("button", {
        name: "图片",
      }),
    );
    fireEvent.click(screen.getByLabelText("素材保存状态"));
    fireEvent.click(screen.getByRole("option", { name: "本地已保存" }));
    fireEvent.change(screen.getByLabelText("搜索素材"), { target: { value: "长生" } });
    fireEvent.click(screen.getByLabelText("素材所属项目"));
    expect(screen.queryByRole("option", { name: "全部项目" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "另一个故事" }));
    expect(screen.getByText("城市夜景")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    expect((screen.getByLabelText("搜索素材") as HTMLInputElement).value).toBe("");

    rerender(
      <MaterialLibrary
        projects={[{ ...first }, { ...second }]}
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText("城市夜景")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "补存历史素材" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "/projects/p2/materials/import",
        {},
        "历史素材保存状态已更新",
      ),
    );
  });
  it("does not show another project's materials when an embedded project is missing", () => {
    render(
      <MaterialLibrary
        projects={[project("p1", [material()])]}
        projectId="missing"
        initialProjectId="p1"
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("项目不存在")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    expect(screen.queryByLabelText("素材所属项目")).toBeNull();
    expect(screen.queryByRole("button", { name: "补存历史素材" })).toBeNull();
  });
  it("handles an empty workspace and selects the requested project when it loads", () => {
    const action = vi.fn();
    const { rerender } = render(
      <MaterialLibrary
        projects={[]}
        initialProjectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText("暂无项目")).toBeTruthy();
    expect(screen.queryByLabelText("素材所属项目")).toBeNull();
    expect(screen.queryByRole("button", { name: "补存历史素材" })).toBeNull();
    rerender(
      <MaterialLibrary
        projects={[
          project("p1", [material()]),
          project("p2", [
            material({ id: "image-2", projectId: "p2", name: "城市夜景" }),
          ]),
        ]}
        initialProjectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText("城市夜景")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
  });
  it("closes the preview on an embedded project switch even when material IDs match", () => {
    const projects = [
      project("p1", [material()]),
      project("p2", [material({ projectId: "p2", name: "城市夜景" })]),
    ];
    const action = vi.fn();
    const { rerender } = render(
      <MaterialLibrary
        projects={projects}
        projectId="p1"
        busy={false}
        onAction={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("img").getAttribute("alt"),
    ).toBe("长生定妆初稿");
    rerender(
      <MaterialLibrary
        projects={projects}
        projectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("城市夜景")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
  });
  it("keeps multiple generations and sorts newest first without changing project arrays", () => {
    const older = material();
    const newer = material({
      id: "image-2",
      name: "长生定妆修订",
      createdAt: "2026-10-12T09:05:00Z",
    });
    const p = project("p1", [older, newer]);
    expect(collectMaterials([p]).map((entry) => entry.material.id)).toEqual([
      "image-2",
      "image-1",
    ]);
    expect(p.materials?.map((item) => item.id)).toEqual(["image-1", "image-2"]);
  });
  it("updates project scope on a project switch and blocks history import during production", () => {
    const action = vi.fn();
    const first = project("p1", [material()]);
    const next = {
      ...project("p2", [
        material({ id: "image-2", projectId: "p2", name: "城市夜景" }),
      ]),
      running: true,
    };
    const { rerender } = render(
      <MaterialLibrary
        projects={[first]}
        projectId="p1"
        busy={false}
        onAction={action}
      />,
    );
    rerender(
      <MaterialLibrary
        projects={[next]}
        projectId="p2"
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText("城市夜景")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    const button = screen.getByRole("button", {
      name: "补存历史素材",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("请先暂停制作");
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
  });
  it("combines project, type, save status and keyword filters", () => {
    render(
      <MaterialLibrary
        projects={[
          project("p1", [
            material(),
            material({
              id: "video-1",
              name: "逃离树林",
              type: "video",
              status: "failed",
              prompt: "月光下的剪影",
            }),
          ]),
          project("p2", [
            material({ id: "image-2", projectId: "p2", name: "城市夜景" }),
          ]),
        ]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("素材所属项目"));
    fireEvent.click(screen.getByRole("option", { name: "借邪骨" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "素材类型" })).getByRole("button", {
        name: "视频",
      }),
    );
    fireEvent.click(screen.getByLabelText("素材保存状态"));
    fireEvent.click(screen.getByRole("option", { name: "下载失败" }));
    fireEvent.change(screen.getByLabelText("搜索素材"), { target: { value: "剪影" } });
    expect(screen.getByText("逃离树林")).toBeTruthy();
    expect(screen.queryByText("长生定妆初稿")).toBeNull();
    expect(screen.queryByText("城市夜景")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索素材"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配的素材")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("长生定妆初稿")).toBeTruthy();
    expect(screen.queryByText("城市夜景")).toBeNull();
  });
  it("does not fetch remote thumbnails and previews only after user opens them", () => {
    const remote = material({
      status: "remote",
      url: "https://images.example.test/remote.png",
    });
    render(
      <MaterialLibrary
        projects={[project("p1", [remote])]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(remote.url);
    expect(within(dialog).getByText("images.example.test")).toBeTruthy();
    expect(dialog.textContent).not.toContain("token=secret");
    expect(screen.queryByRole("button", { name: /锁定/ })).toBeNull();
  });
  it("downloads locally saved media through the local endpoint and retries failed saves", async () => {
    const action = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <MaterialLibrary
        projects={[
          project("p1", [
            material({
              status: "failed",
              url: "https://images.example.test/result.png",
            }),
          ]),
        ]}
        busy={false}
        onAction={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试保存 长生定妆初稿" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        "/projects/p1/materials/image-1/download",
        {},
        "素材保存状态已更新",
      ),
    );
    rerender(
      <MaterialLibrary
        projects={[project("p1", [material()])]}
        busy={false}
        onAction={action}
      />,
    );
    expect(
      screen.getByRole("link", { name: "下载 长生定妆初稿" }).getAttribute("href"),
    ).toBe("/api/media/image-1/file?download=1");
    expect(screen.getByRole("img").getAttribute("src")).toBe("/api/media/image-1/file");
  });
  it("lets a failed preview load again without closing the material dialog or changing its selection", () => {
    render(
      <MaterialLibrary
        projects={[project("p1", [material()])]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    const dialog = screen.getByRole("dialog");
    const preview = within(dialog).getByRole("img");
    fireEvent.error(preview);
    expect(within(dialog).queryByRole("img")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "重试加载 长生定妆初稿" }),
    );
    const retried = within(dialog).getByRole("img");
    expect(retried).not.toBe(preview);
    expect(retried.getAttribute("src")).toBe("/api/media/image-1/file");
  });
  it("retries a failed record save while retaining the local preview and download", async () => {
    const error = "本地文件已保存，但素材记录保存失败，请重试保存。";
    const action = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <MaterialLibrary
        projects={[project("p1", [material({ error })])]}
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.getByText(error)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "重试保存记录 长生定妆初稿" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "下载 长生定妆初稿" }).getAttribute("href"),
    ).toBe("/api/media/image-1/file?download=1");
    fireEvent.click(screen.getByRole("button", { name: "预览 长生定妆初稿" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(error)).toBeTruthy();
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      "/api/media/image-1/file",
    );
    expect(
      within(dialog).getByRole("link", { name: "下载 长生定妆初稿" }),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "重试保存记录 长生定妆初稿" }),
    );
    await waitFor(() =>
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "/projects/p1/materials/image-1/download",
        {},
        "素材保存状态已更新",
      ),
    );
    rerender(
      <MaterialLibrary
        projects={[project("p1", [material()])]}
        busy={false}
        onAction={action}
      />,
    );
    expect(screen.queryByText(error)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "重试保存记录 长生定妆初稿" }),
    ).toBeNull();
    expect(within(dialog).getByRole("img")).toBeTruthy();
  });
  it("allows history import for the default project and disables saves during downloads", () => {
    render(
      <MaterialLibrary
        projects={[project("p1", [material({ status: "downloading" })])]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "补存历史素材" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "保存到本地 长生定妆初稿",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("rejects unsafe remote URLs and formats missing file sizes honestly", () => {
    expect(
      materialPreviewUrl(material({ status: "remote", url: "javascript:alert(1)" })),
    ).toBe("");
    expect(
      materialPreviewUrl(
        material({ status: "remote", url: "https://name:secret@example.test/image" }),
      ),
    ).toBe("");
    expect(formatMaterialBytes()).toBe("大小待保存后确认");
    expect(formatMaterialBytes(2048)).toBe("2.0 KB");
  });
  it("shows measured video metadata separately from requested duration and submitted references", () => {
    render(
      <MaterialLibrary
        projects={[
          project("p1", [
            material({
              id: "video-8",
              name: "镜头 08",
              type: "video",
              url: "/api/media/video-8/file",
              model: "MiniMax-H3",
              providerTaskId: "task-8",
              videoShot: {
                id: "08",
                startSeconds: 39,
                endSeconds: 44,
                durationSeconds: 5,
                storyboardId: "board",
                storyboardVersion: 1,
              },
              referenceAssets: [
                {
                  id: "changsheng",
                  name: "长生",
                  type: "character",
                  version: 2,
                  materialId: "image-v2",
                },
              ],
            }),
          ]),
        ]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "预览 镜头 08" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("实际视频规格")).toBeNull();
    const video = within(dialog).getByLabelText("镜头 08");
    Object.defineProperties(video, {
      duration: { value: 5.167 },
      videoWidth: { value: 768 },
      videoHeight: { value: 1344 },
    });
    fireEvent.loadedMetadata(video);
    expect(within(dialog).getByText(/768 × 1344 · 5.167 秒/)).toBeTruthy();
    expect(within(dialog).getByText(/镜头 08 · 请求 5 秒/)).toBeTruthy();
    expect(within(dialog).getByText("task-8")).toBeTruthy();
    const references = within(dialog).getByRole("region", { name: "生成参考依据" });
    expect(within(references).getAllByRole("listitem")).toHaveLength(1);
    expect(within(references).getByText("长生")).toBeTruthy();
    expect(within(references).getByText("v2")).toBeTruthy();
    expect(within(references).queryByText("老道士")).toBeNull();
  });
});
