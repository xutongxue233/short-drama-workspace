import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api";
import type { Asset, Project } from "../../types";
import { AssetLibrary } from "./AssetLibrary";

vi.mock("../../api", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());

const asset = (name: string, type: Asset["type"] = "character"): Asset => ({
  id: "shared-asset-id",
  name,
  type,
  description: "",
  content: name,
  version: 1,
  locked: false,
  tags: [],
  createdAt: "",
});

const project = (id: string, name: string, assets: Asset[]): Project => ({
  id,
  name,
  assets,
  description: "",
  genre: "悬疑",
  style: "二次元",
  createdAt: "",
  updatedAt: "",
  members: [],
  messages: [],
  nodes: [],
  chapters: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  approval: null,
  running: false,
});

const first = project("p1", "借邪骨", [asset("长生")]);
const second = project("p2", "夜行", [asset("城市夜景", "scene")]);

const assetPage = (items: Asset[], changes = {}) => ({
  items,
  total: items.length,
  offset: 0,
  limit: 24,
  hasMore: false,
  ...changes,
});

describe("remote AssetLibrary", () => {
  it("paginates server results and retains the owning project when opening an asset", async () => {
    const later = { ...asset("较早角色"), id: "later" };
    vi.mocked(request)
      .mockResolvedValueOnce(assetPage(second.assets, { total: 25, hasMore: true }))
      .mockResolvedValueOnce(assetPage([later], { total: 25, offset: 24 }));
    const onOpen = vi.fn();
    render(
      <AssetLibrary remote projects={[{ id: "p2", name: "夜行" }]} onOpen={onOpen} />,
    );
    await screen.findByRole("heading", { name: "城市夜景" });
    expect(screen.getByText("25 份资产")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "加载更多资产" }));
    await screen.findByRole("heading", { name: "较早角色" });
    expect(vi.mocked(request).mock.calls[1][0]).toContain("offset=24");
    fireEvent.click(screen.getByRole("button", { name: /较早角色/ }));
    expect(onOpen).toHaveBeenCalledWith({ asset: later, projectId: "p2" });
  });

  it("aborts the old project and never shows a late response under the new project", async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(request)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(assetPage(second.assets));
    render(<AssetLibrary remote projects={[first, second]} onOpen={vi.fn()} />);
    const signal = vi.mocked(request).mock.calls[0][3]?.signal;
    fireEvent.click(screen.getByRole("combobox", { name: "资产所属项目" }));
    fireEvent.click(screen.getByRole("option", { name: "夜行" }));
    await screen.findByRole("heading", { name: "城市夜景" });
    await act(async () => resolveOld(assetPage(first.assets)));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
  });

  it("retries read errors and resets offset when filtering on the server", async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error("资产读取失败"))
      .mockResolvedValueOnce(assetPage(first.assets, { total: 25, hasMore: true }))
      .mockResolvedValueOnce(assetPage([]));
    render(<AssetLibrary remote projects={[first]} onOpen={vi.fn()} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "暂无资产" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试加载资产" }));
    await screen.findByRole("heading", { name: "长生" });
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
    await screen.findByRole("heading", { name: "没有找到匹配资产" });
    const query = new URL(vi.mocked(request).mock.calls[2][0], "https://local")
      .searchParams;
    expect(query.get("type")).toBe("scene");
    expect(query.get("offset")).toBe("0");
  });
});

describe("AssetLibrary", () => {
  it("opens the current project's assets without mixing other projects", () => {
    const onOpen = vi.fn();
    render(
      <AssetLibrary projects={[first, second]} initialProjectId="p2" onOpen={onOpen} />,
    );

    expect(screen.getByRole("combobox", { name: "资产所属项目" }).textContent).toBe(
      "夜行",
    );
    expect(screen.getByText("1 份资产")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /城市夜景/ }));
    expect(onOpen).toHaveBeenCalledWith({
      asset: second.assets[0],
      projectId: "p2",
    });
  });

  it("defaults to the first project and clears filters when switching projects", () => {
    const onOpen = vi.fn();
    render(<AssetLibrary projects={[first, second]} onOpen={onOpen} />);
    expect(screen.getByRole("heading", { name: "长生" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "城市夜景" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索资产" }), {
      target: { value: "长生" },
    });

    fireEvent.click(screen.getByRole("combobox", { name: "资产所属项目" }));
    fireEvent.click(screen.getByRole("option", { name: "夜行" }));

    expect(screen.getByRole("heading", { name: "城市夜景" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "搜索资产" }) as HTMLInputElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /城市夜景/ }));
    expect(onOpen).toHaveBeenCalledWith({ asset: second.assets[0], projectId: "p2" });
  });

  it("falls back to an available project after the selected project is removed", () => {
    const props = { onOpen: vi.fn(), initialProjectId: "p2" };
    const { rerender } = render(<AssetLibrary projects={[first, second]} {...props} />);

    rerender(<AssetLibrary projects={[first]} {...props} />);

    expect(screen.getByRole("combobox", { name: "资产所属项目" }).textContent).toBe(
      "借邪骨",
    );
    expect(screen.getByRole("heading", { name: "长生" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "城市夜景" })).toBeNull();
  });

  it("keeps empty projects empty instead of showing another project's assets", () => {
    const empty = project("empty", "未制作", []);
    render(
      <AssetLibrary
        projects={[first, empty]}
        initialProjectId="empty"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "暂无资产" })).toBeTruthy();
    expect(screen.getByText("0 份资产")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
  });

  it("shows an empty project state and accepts projects loaded later", () => {
    const props = { onOpen: vi.fn(), initialProjectId: "p2" };
    const { rerender } = render(<AssetLibrary projects={[]} {...props} />);
    expect(screen.getByRole("heading", { name: "暂无项目" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "资产所属项目" })).toBeNull();

    rerender(<AssetLibrary projects={[first, second]} {...props} />);
    expect(screen.getByRole("heading", { name: "城市夜景" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "长生" })).toBeNull();
  });
});
