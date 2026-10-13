import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, WorkflowNode } from "../../../types";
import { NodeDialog } from "./NodeDialog";

const node: WorkflowNode = {
  id: "video",
  name: "视频制作",
  description: "",
  agentId: "director",
  status: "failed",
  output: "",
  videoGeneration: {
    providerId: "test",
    baseUrl: "https://provider.test",
    model: "video",
    shotId: "shot-1",
    requestKey: "req-1",
    taskId: "remote-task-1",
  },
};
const project: Project = {
  id: "project",
  name: "测试",
  description: "",
  genre: "",
  style: "",
  createdAt: "",
  updatedAt: "",
  members: [],
  messages: [],
  nodes: [node],
  assets: [],
  chapters: [{ id: "chapter", title: "原文", content: "原文", createdAt: "" }],
  memory: { facts: [], decisions: [], summary: "", compressedCount: 0 },
  approval: null,
  running: false,
};
function setup(selected = node, current = project) {
  const onAction = vi.fn().mockResolvedValue(true);
  render(
    <NodeDialog
      node={selected}
      project={current}
      agents={[]}
      busy={false}
      onAction={onAction}
      onClose={vi.fn()}
    />,
  );
  return onAction;
}

describe("recovering uncertain generation tasks", () => {
  it("requires explicit acknowledgement before archiving a video task and never starts a new job", async () => {
    const onAction = setup();
    expect(screen.getByText("待取回的视频任务：remote-task-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "归档旧视频任务" }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText(/不会取消供应商任务，远端可能继续计费/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认归档旧视频任务" }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledExactlyOnceWith(
        "/projects/project/video-task/archive",
        { taskId: "remote-task-1", acknowledgement: "archive-without-cancelling" },
        expect.any(String),
      ),
    );
  });
  it("offers image recovery only for submitted requests with no persisted URL", async () => {
    const images: WorkflowNode = {
      ...node,
      videoGeneration: undefined,
      characterGeneration: {
        id: "generation",
        key: "generation",
        plan: [],
        images: [
          { captureId: "uncertain", name: "待核查角色", status: "submitted" },
          { captureId: "failed", name: "失败角色", status: "failed" },
          {
            captureId: "saved",
            name: "已保存角色",
            status: "submitted",
            result: { url: "/saved.png" },
          },
        ],
      },
    };
    const onAction = setup(images);
    expect(screen.queryByText(/图像请求结果待核查：失败角色/)).toBeNull();
    expect(screen.queryByText(/图像请求结果待核查：已保存角色/)).toBeNull();
    expect(screen.queryByRole("button", { name: "从此节点重新制作" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "归档图像请求 待核查角色" }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText(/可能已完成并计费/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "确认归档图像请求 待核查角色" }),
    );
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledExactlyOnceWith(
        "/projects/project/image-task/archive",
        { captureId: "uncertain", acknowledgement: "new-image-may-charge" },
        expect.any(String),
      ),
    );
  });
  it("blocks task archival and reruns during an image test", () => {
    const onAction = setup(node, { ...project, backgroundTask: "image-test" });
    const archive = screen.getByRole("button", {
      name: "归档旧视频任务",
    }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    fireEvent.click(archive);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "从此节点重新制作" })).toBeNull();
  });
});

it.each(["member", "viewer"] as const)(
  "lets %s inspect and close a node without permitting mutations",
  (access) => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <NodeDialog
        node={node}
        project={{ ...project, currentUserAccess: access }}
        agents={[]}
        busy={false}
        onAction={onAction}
        onClose={onClose}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "归档旧视频任务" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "从此节点重新制作" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "归档旧视频任务" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回工作台" }));
    expect(onClose).toHaveBeenCalledOnce();
  },
);
