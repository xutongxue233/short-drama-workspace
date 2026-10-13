import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent, Asset, EpisodeArchive, Project } from "../../../types";
import { agentWorkState } from "../workflow-overview";
import { ProjectInspector } from "./ProjectInspector";
import { WorkflowPanel } from "./WorkflowPanel";

const agents: Agent[] = [
  {
    id: "producer",
    name: "总制片",
    role: "统筹",
    description: "",
    color: "#7160cf",
    enabled: true,
    providerId: "text",
    model: "",
    systemPrompt: "",
  },
  {
    id: "writer",
    name: "编剧",
    role: "剧情改编",
    description: "",
    color: "#7160cf",
    enabled: true,
    providerId: "text",
    model: "",
    systemPrompt: "",
  },
  {
    id: "director",
    name: "导演",
    role: "镜头语言",
    description: "",
    color: "#7160cf",
    enabled: true,
    providerId: "text",
    model: "",
    systemPrompt: "",
  },
];
const project: Project = {
  id: "project",
  name: "连载短剧",
  description: "",
  genre: "悬疑",
  style: "二次元动画",
  createdAt: "",
  updatedAt: "",
  members: agents.map((agent) => agent.id),
  participants: [
    {
      userId: "owner",
      username: "xiaolin",
      displayName: "小林",
      kind: "human",
      access: "owner",
    },
  ],
  messages: [],
  chapters: [],
  assets: [],
  running: false,
  approval: null,
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  nodes: [
    {
      id: "analysis",
      name: "原著拆解",
      description: "分析本集原文",
      agentId: "producer",
      status: "completed",
      output: "本集拆解结果",
    },
    {
      id: "adaptation",
      name: "剧本改编",
      description: "改编本集剧本",
      agentId: "writer",
      status: "pending",
      output: "",
    },
    {
      id: "storyboard",
      name: "分镜设计",
      description: "设计本集镜头",
      agentId: "director",
      status: "pending",
      output: "",
    },
  ],
};
const archive: EpisodeArchive = {
  id: "episode-1",
  number: 1,
  title: "第一集",
  createdAt: "",
  archivedAt: "",
  chapters: [],
  nodes: project.nodes.map((node) => ({ ...node, status: "completed" })),
  memory: project.memory,
  messages: [],
  assets: [],
  materials: [],
};
const character: Asset = {
  id: "hero",
  name: "长生",
  type: "character",
  description: "",
  content: "",
  locked: true,
  version: 1,
  createdAt: "",
  tags: [],
};
function inspector(data = project) {
  const callbacks = {
    onTabChange: vi.fn(),
    onNode: vi.fn(),
    onInvite: vi.fn(),
    onActivity: vi.fn(),
    onEpisodes: vi.fn(),
  };
  const view = render(
    <ProjectInspector project={data} agents={agents} {...callbacks} />,
  );
  return { ...view, ...callbacks };
}
function panel(data = project) {
  const callbacks = {
    onNode: vi.fn(),
    onRun: vi.fn(),
    onChat: vi.fn(),
    onSource: vi.fn(),
    onActivity: vi.fn(),
    onEpisodes: vi.fn(),
  };
  const view = render(
    <WorkflowPanel project={data} agents={agents} busy={false} {...callbacks} />,
  );
  return { ...view, ...callbacks };
}

describe("project and episode overview", () => {
  it("includes the project owner in the group count and opens their manual records", () => {
    const { onActivity } = inspector();
    expect(screen.getByRole("heading", { name: "群成员" })).toBeTruthy();
    expect(screen.getByText("4 位成员")).toBeTruthy();
    const owner = screen.getByRole("button", { name: "查看 小林 的工作记录" });
    expect(within(owner).queryByText("真人")).toBeNull();
    expect(within(owner).getByText("用户")).toBeTruthy();
    expect(screen.getAllByText("Agent")).toHaveLength(3);
    expect(within(owner).getByText("项目所有者")).toBeTruthy();
    fireEvent.click(owner);
    expect(onActivity).toHaveBeenCalledWith("owner");
  });

  it("separates project totals from current episode nodes and counts only usable shared assets", () => {
    const { container, onEpisodes } = inspector({
      ...project,
      currentEpisode: {
        id: "episode-3",
        number: 3,
        title: "老道士现身",
        createdAt: "",
        startMessageIndex: 0,
        startAssetIds: [],
        startMaterialIds: [],
      },
      episodeArchive: [archive, { ...archive, id: "episode-2", number: 2 }],
      assets: [
        character,
        { ...character, id: "old", tags: ["历史版本"] },
        { ...character, id: "stale", tags: ["待更新"] },
        { ...character, id: "draft", locked: false },
        {
          ...character,
          id: "statue",
          characterDesign: {
            version: 1,
            subjectType: "object",
            baseAppearance: "神像",
            sceneStates: [],
          },
        },
      ],
      materials: ["local", "remote", "failed"].map((status, index) => ({
        id: String(index),
        name: "图片",
        projectId: project.id,
        type: "image",
        status: status as "local" | "remote" | "failed",
        sourceUrl: "",
        url: "",
        createdAt: "",
      })),
    });
    const counter = (label: string) =>
      screen.getByText(label).parentElement?.querySelector("dd")?.textContent;
    expect(counter("已建剧集")).toBe("3集");
    expect(counter("已归档")).toBe("2集");
    expect(counter("锁定角色")).toBe("1位");
    expect(counter("本地素材")).toBe("1份");
    expect(screen.getByText("第 03 集 · 本集制作")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "本集制作" })).getByText(
        "1 / 3 已完成",
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("%");
    fireEvent.click(screen.getByRole("button", { name: "剧集档案" }));
    expect(onEpisodes).toHaveBeenCalledOnce();
  });

  it("keeps legacy projects at episode one without inventing a final episode count", () => {
    inspector();
    expect(screen.getByText("第 01 集 · 本集制作")).toBeTruthy();
    expect(
      screen.getByText("已建剧集").parentElement?.querySelector("dd")?.textContent,
    ).toBe("1集");
    expect(screen.queryByText("当前制作进度")).toBeNull();
  });

  it("collapses the node timeline by default while keeping agent records accessible", () => {
    const { container, onNode, onActivity } = inspector();
    const details = container.querySelector(
      ".episode-node-details",
    ) as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;
    expect(details.open).toBe(false);
    expect(summary.textContent).toContain("本集节点");
    expect(summary.textContent).toContain("1 / 3 已完成");
    fireEvent.click(
      screen.getByRole("button", { name: "查看 编剧 的工作记录 · 待开始" }),
    );
    expect(onActivity).toHaveBeenCalledWith("writer");
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "原著拆解 · 已完成，查看节点" }),
    );
    expect(onNode).toHaveBeenCalledWith(project.nodes[0]);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("omits a duplicate default episode title and keeps provider details out of the overview", () => {
    const { container } = inspector({
      ...project,
      currentEpisode: {
        id: "current",
        number: 1,
        title: "第 1 集",
        createdAt: "",
        startMessageIndex: 0,
        startAssetIds: [],
        startMaterialIds: [],
      },
      nodes: project.nodes.map((node) =>
        node.id === "adaptation"
          ? {
              ...node,
              status: "failed",
              error:
                "HTTP 404 ModelNotOpen: account 0123456789 model has not been activated",
            }
          : node,
      ),
    });
    expect(screen.getByText("模型未开通或账号无调用权限。")).toBeTruthy();
    expect(container.querySelector(".episode-overview-title")).toBeNull();
    expect(container.textContent).not.toContain("0123456789");
  });

  it("surfaces an exact failed node and opens its recovery details without marking all agents busy", () => {
    const failedProject: Project = {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "adaptation"
          ? { ...node, status: "failed", error: "该模型暂未开通" }
          : node,
      ),
    };
    const { onNode, onActivity } = inspector(failedProject);
    expect(screen.getByText("模型未开通或账号无调用权限。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看问题与重试" }));
    expect(onNode).toHaveBeenCalledWith(failedProject.nodes[1]);
    fireEvent.click(screen.getByRole("button", { name: "工作记录" }));
    expect(onActivity).toHaveBeenCalledWith("writer", "adaptation");
    expect(
      screen.getByRole("button", { name: "查看 编剧 的工作记录 · 需处理" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "查看 导演 的工作记录 · 待接手" }),
    ).toBeTruthy();
    expect(screen.queryByText("创作中")).toBeNull();
  });

  it("uses the approval handoff even when the next stage stays with the same agent", () => {
    const { onTabChange, onActivity } = inspector({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "adaptation" ? { ...node, status: "waiting" } : node,
      ),
      approval: {
        id: "approval",
        nodeId: "adaptation",
        title: "确认样板",
        description: "",
        kind: "character",
        nextStep: { agentId: "writer", name: "批量生成角色" },
      },
    });
    expect(screen.getByText("确认后交给 编剧 · 批量生成角色")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往群聊确认" }));
    expect(onTabChange).toHaveBeenCalledWith("chat");
    fireEvent.click(
      screen.getByRole("button", { name: "查看 编剧 的工作记录 · 待你确认" }),
    );
    expect(onActivity).toHaveBeenCalledWith("writer");
    fireEvent.click(screen.getByRole("button", { name: "全部工作记录" }));
    expect(onActivity).toHaveBeenCalledWith();
  });

  it("reports completed nodes as workflow acceptance rather than a finished movie", () => {
    const { container } = inspector({ ...project, nodes: archive.nodes });
    expect(screen.getByText("本集流程验收完成")).toBeTruthy();
    expect(screen.getByText("请在交付清单中核对实际视频与待办。")).toBeTruthy();
    expect(container.textContent).not.toMatch(/100%|成片已完成|项目已完成/);
    expect(screen.queryByText(/完成后交给/)).toBeNull();
  });

  it("derives agent activity only from a running node or an actual pending reply", () => {
    expect(agentWorkState(project, agents[0])).toBe("节点已完成");
    expect(agentWorkState(project, agents[1])).toBe("待开始");
    expect(agentWorkState(project, agents[2])).toBe("待接手");
    expect(agentWorkState({ ...project, running: true }, agents[2])).toBe("待接手");
    expect(
      agentWorkState(
        {
          ...project,
          chatPending: { agentId: "producer", messageId: "question", startedAt: "" },
        },
        agents[0],
      ),
    ).toBe("回复中");
    expect(
      agentWorkState(
        { ...project, nodes: [{ ...project.nodes[1], status: "running" }] },
        agents[1],
      ),
    ).toBe("创作中");
    expect(agentWorkState(project, { ...agents[2], enabled: false })).toBe("已停用");
  });
});

describe("episode workflow panel", () => {
  it("opens filtered node records separately from the node result", () => {
    const { onActivity, onNode, onSource } = panel();
    expect(screen.getByRole("heading", { name: "第 01 集 · 制作流程" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看 剧本改编 的工作记录" }));
    expect(onActivity).toHaveBeenCalledWith("writer", "adaptation");
    expect(onNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /02 剧本改编/ }));
    expect(onNode).toHaveBeenCalledWith(project.nodes[1]);
    fireEvent.click(screen.getByRole("button", { name: "导入本集原文" }));
    expect(onSource).toHaveBeenCalledOnce();
  });

  it("keeps records and episode archives accessible after all nodes are accepted", () => {
    const { onActivity, onEpisodes } = panel({
      ...project,
      nodes: archive.nodes,
      chapters: [{ id: "source", title: "片段", content: "原文", createdAt: "" }],
    });
    expect(
      (screen.getByRole("button", { name: "流程验收完成" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "工作记录" }));
    expect(onActivity).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole("button", { name: "剧集档案" }));
    expect(onEpisodes).toHaveBeenCalledOnce();
    expect(screen.getByText(/核对实际视频与待办/)).toBeTruthy();
  });
});
