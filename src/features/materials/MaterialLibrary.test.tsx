import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Material, Project } from "../../types";
import { MaterialLibrary } from "./MaterialLibrary";
import {
  collectMaterials,
  formatMaterialBytes,
  materialPreviewUrl,
} from "./materialUtils";

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
    expect(screen.getByText("生成的每一版，都将留在这里")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "补存历史素材" }));
    expect(action.mock.calls[0][0]).toBe("/projects/p1/materials/import");
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
  it("requires a concrete project for history import and disables saves during downloads", () => {
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
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "保存到本地 长生定妆初稿",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("素材所属项目"));
    fireEvent.click(screen.getByRole("option", { name: "借邪骨" }));
    expect(
      (screen.getByRole("button", { name: "补存历史素材" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
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
