import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, WorkspaceState } from "../types";
import { useWorkspaceState } from "./useWorkspaceState";
import App from "./App";

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
  afterEach(() => vi.unstubAllGlobals());

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
    expect(localStorage.getItem("yingxu-project")).toBe("new-project");
  });
});
