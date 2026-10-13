import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EpisodeArchive, Project } from "../../../types";
import { archivedEpisodeProject } from "../episodes";
import { EpisodeArchiveDialog } from "./EpisodeArchiveDialog";

const current: Project = {
  id: "project",
  name: "连续制作",
  description: "",
  genre: "悬疑",
  style: "二维",
  createdAt: "2026-10-13",
  updatedAt: "2026-10-13",
  members: ["writer"],
  currentEpisode: {
    id: "ep2",
    number: 2,
    title: "第二夜",
    createdAt: "2026-10-13",
    startMessageIndex: 10,
    startAssetIds: [],
    startMaterialIds: [],
  },
  episodeArchive: [],
  chapters: [],
  assets: [],
  messages: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  nodes: [
    {
      id: "analysis",
      name: "原著拆解",
      description: "",
      agentId: "writer",
      status: "completed",
      output: "当前产物",
    },
  ],
  running: false,
  approval: null,
};
const archive: EpisodeArchive = {
  id: "ep1",
  number: 1,
  title: "第一夜",
  createdAt: "2026-10-12",
  archivedAt: "2026-10-13",
  chapters: [
    { id: "c1", title: "旧章节", content: "上一集原文", createdAt: "2026-10-12" },
  ],
  nodes: [{ ...current.nodes[0], output: "历史产物" }],
  assets: [],
  materials: [],
  memory: { ...current.memory, summary: "历史记忆" },
  messages: [
    {
      id: "m1",
      agentId: "writer",
      nodeId: "analysis",
      type: "result",
      content: "历史执行结果",
      createdAt: "2026-10-12",
    },
  ],
};
function setup(project = current, onCreate = vi.fn().mockResolvedValue(undefined)) {
  const onActivity = vi.fn();
  render(
    <EpisodeArchiveDialog
      project={project}
      onClose={vi.fn()}
      onCreate={onCreate}
      onActivity={onActivity}
      onWorkflow={vi.fn()}
    />,
  );
  return { onCreate, onActivity };
}

describe("episode archive", () => {
  it.each([
    { running: true },
    { approval: { id: "approval" } },
    { chatPending: { agentId: "writer" } },
    { nodes: [{ ...current.nodes[0], status: "failed" }] },
    { nodes: [] },
  ])("blocks advancing with unfinished work %j", (overrides) => {
    setup({ ...current, ...overrides } as Project);
    expect(
      (screen.getByRole("button", { name: "开始下一集" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("keeps historical source and results separate and opens the selected episode log", () => {
    const { onActivity } = setup({ ...current, episodeArchive: [archive] });
    fireEvent.click(screen.getByRole("button", { name: /第一夜/ }));
    expect(screen.getByText("历史产物")).toBeTruthy();
    expect(screen.queryByText("当前产物")).toBeNull();
    expect(screen.getByText("上一集原文")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看工作记录" }));
    expect(onActivity).toHaveBeenCalledWith("ep1");
    expect(screen.queryByRole("button", { name: "进入本集流程" })).toBeNull();
  });
  it("requires an explicit archive submission and prevents duplicate requests", async () => {
    let resolve!: () => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    setup(current, onCreate);
    const prepare = screen.getByRole("button", { name: "开始下一集" });
    fireEvent.click(prepare);
    expect(onCreate).not.toHaveBeenCalled();
    expect(prepare.isConnected).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /第 3 集标题/ }), {
      target: { value: "  山中来客  " },
    });
    const submit = screen.getByRole("button", { name: "归档并创建第 3 集" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("山中来客");
    await act(async () => resolve());
  });
  it("keeps the entered title and surfaces an archive API failure", async () => {
    setup(current, vi.fn().mockRejectedValue(new Error("仍有未确认事项")));
    fireEvent.click(screen.getByRole("button", { name: "开始下一集" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "归档并创建第 3 集" })),
    );
    expect(screen.getByRole("alert").textContent).toBe("仍有未确认事项");
    expect(
      (screen.getByRole("button", { name: "归档并创建第 3 集" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("historical logs use archived boundaries and cannot inherit active work", () => {
    const snapshot = archivedEpisodeProject(
      {
        ...current,
        running: true,
        chatPending: { agentId: "writer", messageId: "new", startedAt: "2026-10-13" },
      },
      archive,
    );
    expect(snapshot.currentEpisode?.startMessageIndex).toBe(0);
    expect(snapshot.messages).toEqual(archive.messages);
    expect(snapshot.nodes).toEqual(archive.nodes);
    expect(snapshot.running).toBe(false);
    expect(snapshot.chatPending).toBeNull();
    expect(snapshot.memory.summary).toBe("历史记忆");
  });
});
