import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectSummary, WorkspaceState } from "../types";
import { useWorkspaceState } from "./useWorkspaceState";
import { WorkspaceApp } from "./App";

const App = () => (
  <WorkspaceApp
    user={{
      id: "admin",
      username: "admin",
      displayName: "管理员",
      role: "admin",
      kind: "human",
      disabled: false,
      createdAt: "",
    }}
    onLogout={vi.fn()}
    onSessionChange={vi.fn()}
  />
);

vi.mock("./useWorkspaceState");

describe("first project onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("never imports source into the old project while the newly selected project is absent from a snapshot", async () => {
    const old: Project = {
      id: "old-project",
      name: "已有项目",
      description: "",
      genre: "悬疑",
      style: "二维",
      createdAt: "",
      updatedAt: "",
      members: [],
      chapters: [],
      assets: [],
      messages: [],
      nodes: [],
      memory: { facts: [], decisions: [], summary: "", compressedCount: 0 },
      approval: null,
      running: false,
    };
    const mutate = vi
      .fn()
      .mockResolvedValue({ project: { ...old, id: "new-project", name: "新项目" } });
    vi.mocked(useWorkspaceState).mockReturnValue({
      state: { projects: [old], providers: [], agents: [] },
      error: "",
      busy: false,
      toast: null,
      refresh: vi.fn().mockResolvedValue(undefined),
      mutate,
      action: vi.fn(),
      notify: vi.fn(),
      dismissToast: vi.fn(),
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "新建创作项目" }));
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "新项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目群聊" }));
    await waitFor(() => expect(screen.getByText("所选项目暂未加载")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "把故事交给创作团队" })).toBeNull();
    await waitFor(() => expect(localStorage.getItem("yingxu-project")).toBeNull());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("opens a newly created project and immediately offers to import this episode's source from an empty workspace", async () => {
    const state: WorkspaceState = { projects: [], providers: [], agents: [] };
    const mutate = vi.fn().mockImplementation(async (_path, body) => {
      const project: Project = {
        ...body,
        id: "new-project",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        members: [],
        chapters: [],
        assets: [],
        messages: [],
        nodes: [],
        memory: { facts: [], decisions: [], summary: "", compressedCount: 0 },
        approval: null,
        running: false,
      };
      state.projects = [project];
      return { project };
    });
    vi.mocked(useWorkspaceState).mockImplementation(() => ({
      state,
      error: "",
      busy: false,
      toast: null,
      refresh: vi.fn(),
      mutate,
      action: vi.fn(),
      notify: vi.fn(),
      dismissToast: vi.fn(),
    }));
    render(<App />);
    expect(screen.getByText("开始你的第一部短剧")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("main")).getByRole("button", {
        name: "新建项目",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "本集创作" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建项目群聊" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "把故事交给创作团队" })).toBeTruthy(),
    );
    expect(mutate).toHaveBeenCalledExactlyOnceWith("/projects", {
      name: "本集创作",
      description: "",
      genre: "悬疑",
      style: "真人短剧",
    });
    const source = screen.getByRole("dialog", { name: "把故事交给创作团队" });
    expect(
      within(source).getByRole("textbox", { name: "章节或片段标题 选填" }),
    ).toBeTruthy();
    expect(within(source).getByRole("button", { name: "导入本集原文" })).toBeTruthy();
    expect(document.querySelector(".project-title h1")?.textContent).toBe("本集创作");
    expect(document.querySelector(".project-title p")?.textContent).toContain(
      "当前第 1 集",
    );
    await waitFor(() => expect(localStorage.getItem("yingxu-project")).toBeNull());
  });

  it("selects a summary-only project and waits for its compact detail without showing the old project", () => {
    const old: Project = {
      id: "old-project",
      name: "已有项目",
      description: "",
      genre: "悬疑",
      style: "二维",
      createdAt: "",
      updatedAt: "",
      members: [],
      chapters: [],
      assets: [],
      messages: [
        {
          id: "old-message",
          agentId: "user",
          type: "text",
          content: "旧项目的群聊内容",
          createdAt: "2026-10-13T00:00:00Z",
        },
      ],
      messagePage: { startIndex: 0, nextBefore: null, total: 1 },
      snapshot: { history: "recent" },
      nodes: [],
      memory: { facts: [], decisions: [], summary: "", compressedCount: 0 },
      approval: null,
      running: false,
    };
    const next: Project = {
      ...old,
      id: "next-project",
      name: "另一项目",
      messages: [
        { ...old.messages[0], id: "next-message", content: "另一项目的群聊内容" },
      ],
    };
    const summaries: ProjectSummary[] = [old, next].map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      genre: item.genre,
      style: item.style,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      members: item.members,
      running: item.running,
      approval: item.approval,
    }));
    const state: WorkspaceState = {
      projects: [old],
      projectSummaries: summaries,
      providers: [],
      agents: [],
    };
    vi.mocked(useWorkspaceState).mockReturnValue({
      state,
      error: "",
      busy: false,
      toast: null,
      refresh: vi.fn(),
      mutate: vi.fn(),
      action: vi.fn(),
      notify: vi.fn(),
      dismissToast: vi.fn(),
    });
    const { rerender } = render(<App />);
    expect(screen.getByText("旧项目的群聊内容")).toBeTruthy();
    const selectNext = within(screen.getByRole("complementary")).getByRole("button", {
      name: /另一项目/,
    });
    fireEvent.click(selectNext);
    expect(useWorkspaceState).toHaveBeenLastCalledWith({
      projectId: "next-project",
      fullHistory: false,
    });
    expect(selectNext.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("正在加载项目…")).toBeTruthy();
    expect(screen.queryByText("旧项目的群聊内容")).toBeNull();
    expect(screen.queryByRole("heading", { name: "已有项目" })).toBeNull();
    expect(screen.queryByText("开始你的第一部短剧")).toBeNull();
    expect(localStorage.getItem("yingxu-project")).toBeNull();
    state.projects = [next];
    rerender(<App />);
    expect(screen.queryByText("正在加载项目…")).toBeNull();
    expect(screen.getByRole("heading", { name: "另一项目" })).toBeTruthy();
    expect(screen.getByText("另一项目的群聊内容")).toBeTruthy();
    expect(screen.queryByText("旧项目的群聊内容")).toBeNull();
  });
});
