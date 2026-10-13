import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent, Message, Project } from "../../../types";
import { ChatHistory } from "./ChatHistory";

const agents: Agent[] = [
  {
    id: "producer",
    name: "总制片",
    role: "主控 Agent",
    description: "协调制作",
    color: "#7160cf",
    enabled: true,
    providerId: "text",
    model: "test",
    systemPrompt: "协调制作",
  },
];

const message = (patch: Partial<Message>): Message => ({
  id: "message-1",
  agentId: "producer",
  content: "收到你的创作需求。",
  type: "text",
  createdAt: "2026-10-12T10:00:00.000Z",
  ...patch,
});

function history(
  messages: Message[],
  pendingAgentId?: string,
  patch: Partial<Project> = {},
) {
  const project: Project = {
    id: "chat-test",
    name: "短剧测试项目",
    description: "",
    genre: "悬疑",
    style: "动画",
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    members: ["producer"],
    messages,
    nodes: [],
    assets: [],
    chapters: [],
    memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
    approval: null,
    running: false,
    ...patch,
  };
  const onSource = vi.fn();
  const view = render(
    <ChatHistory
      project={project}
      agents={agents}
      busy={false}
      onAction={vi.fn()}
      onNode={vi.fn()}
      onAssets={vi.fn()}
      onSource={onSource}
      historyRef={null}
      pendingAgentId={pendingAgentId}
    />,
  );
  return { ...view, onSource };
}

describe("chat response visibility", () => {
  it("keeps human and agent identities clear without repeating the project intro", () => {
    const view = history(
      [
        message({ id: "human", agentId: "user", content: "我批准这版剧本" }),
        message({ id: "agent", content: "开始交接" }),
      ],
      undefined,
      { members: ["producer", "producer", "user", "missing"] },
    );
    expect(screen.queryByText("短剧测试项目")).toBeNull();
    const rows = view.container.querySelectorAll("article.message");
    expect(rows[0].querySelector("header")?.textContent).toContain("我项目负责人");
    expect(rows[0].querySelector(".studio-member-kind")).toBeNull();
    expect(rows[1].querySelector("header")?.textContent).toContain(
      "总制片Agent制作统筹",
    );
  });

  it("offers a source import when the current episode is empty", () => {
    const view = history([]);
    fireEvent.click(screen.getByRole("button", { name: "导入本集原文" }));
    expect(view.onSource).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "开始本集创作" })).toBeTruthy();
  });

  it("does not attribute a missing historical member to the producer", () => {
    const view = history([message({ agentId: "removed-agent" })]);
    const header = view.container.querySelector("article.message header");
    expect(header?.textContent).toContain("历史成员");
    expect(header?.textContent).not.toContain("总制片");
    expect(header?.querySelector(".studio-member-kind")).toBeNull();
  });

  it("does not expose a previous episode result as a link to the current episode node", () => {
    history(
      [
        message({
          id: "old",
          content: "上一集已批准结果",
          type: "result",
          nodeId: "adaptation",
        }),
        message({ id: "new", content: "本集讨论" }),
      ],
      undefined,
      {
        currentEpisode: {
          id: "ep2",
          number: 2,
          title: "第 2 集",
          createdAt: "2026-10-13",
          startMessageIndex: 1,
          startAssetIds: [],
          startMaterialIds: [],
        },
      },
    );
    expect(screen.queryByText("上一集已批准结果")).toBeNull();
    expect(screen.getByText("本集讨论")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看节点成果" })).toBeNull();
  });
  it("highlights mentions in sent messages, headings and bold text", () => {
    const view = history([
      message({ content: "# @总制片\n**@总制片** 请确认。\n@你 请检查稿件。" }),
    ]);
    expect(
      [...view.container.querySelectorAll(".message-mention")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["@总制片", "@总制片", "@你"]);
  });

  it("shows a named reply indicator independently of workflow execution", () => {
    history([], "producer");
    expect(screen.getByRole("status").textContent).toContain("总制片正在回复");
    expect(screen.queryByText("正在推进制作节点…")).toBeNull();
  });

  it("renders model failures as an agent error card", () => {
    history([message({ type: "error", content: "服务已停用，请在模型接入中启用。" })]);
    const error = screen.getByText("回复未完成").closest("article");
    expect(error?.textContent).toContain("总制片");
    expect(error?.querySelector(".reply-error")?.textContent).toContain("服务已停用");
  });

  it("makes existing saved chat failures visible without rewriting history", () => {
    history([
      message({
        agentId: "system",
        type: "system",
        content: "反馈已保存，但「总制片」本次回复未完成：绑定的模型服务已停用。",
      }),
    ]);
    expect(screen.getByText("回复未完成").closest("article")?.textContent).toContain(
      "总制片",
    );
    expect(screen.getByText(/请在模型接入中检查服务状态/)).toBeTruthy();
  });

  it("retains regular workflow notices as system messages and labels demo replies", () => {
    const view = history([
      message({
        id: "notice",
        agentId: "system",
        type: "system",
        content: "成员已加入",
      }),
      message({ content: "【演示模式】已收到创作需求。" }),
    ]);
    expect(view.container.querySelectorAll(".system-message")).toHaveLength(1);
    expect(screen.getByText(/【演示模式】/).closest("article")?.textContent).toContain(
      "总制片",
    );
  });
});
