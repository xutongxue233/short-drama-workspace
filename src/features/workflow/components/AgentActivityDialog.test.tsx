import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent, Message, Project } from "../../../types";
import {
  activityPreview,
  activityTime,
  buildActivityLog,
  filterActivity,
} from "../activity";
import { AgentActivityDialog } from "./AgentActivityDialog";

const agents: Agent[] = ["producer", "writer", "character"].map((id, index) => ({
  id,
  name: ["总制片", "编剧", "角色设计"][index],
  role: "创作成员",
  description: "",
  color: "#7160cf",
  enabled: true,
  providerId: "today-provider",
  model: "today-model-is-not-historical-evidence",
  systemPrompt: "",
}));
const message = (
  id: string,
  agentId: string,
  type: Message["type"],
  content: string,
  nodeId?: string,
): Message => ({
  id,
  agentId,
  type,
  content,
  nodeId,
  createdAt: `2026-10-13T01:00:0${id.length % 10}Z`,
});
const project: Project = {
  id: "serial",
  name: "借邪骨",
  description: "",
  genre: "悬疑",
  style: "二次元动画",
  createdAt: "",
  updatedAt: "",
  members: ["producer", "writer", "character"],
  messages: [
    message("old", "writer", "result", "第一集旧稿", "adaptation"),
    message(
      "run",
      "character",
      "system",
      "开始「角色定妆」。已带入原著。",
      "characters",
    ),
    message("proposal", "character", "result", "角色定妆提案", "characters"),
    message("review", "producer", "approval", "@你 请确认角色", "characters"),
    message("feedback", "user", "text", "请返修「角色定妆」：袖口改灰色", "characters"),
    message("chat", "character", "text", "闲聊消息不会当作流程记录"),
    message("other", "writer", "result", "编剧本集结果", "adaptation"),
  ],
  currentEpisode: {
    id: "ep2",
    number: 2,
    title: "第二集",
    createdAt: "",
    startMessageIndex: 1,
    startAssetIds: [],
    startMaterialIds: [],
  },
  nodes: [
    {
      id: "characters",
      name: "角色定妆",
      description: "绘制本集角色标准图",
      agentId: "character",
      status: "waiting",
      output: "角色定妆提案",
      startedAt: "2026-10-13T01:00:01Z",
    },
    {
      id: "adaptation",
      name: "剧本改编",
      description: "改编本集",
      agentId: "writer",
      status: "completed",
      output: "编剧本集结果",
    },
  ],
  assets: [],
  chapters: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  approval: {
    id: "review",
    nodeId: "characters",
    title: "请确认角色",
    description: "",
    kind: "character",
  },
  running: false,
};

describe("episode activity evidence", () => {
  const evidenceProject = (messages: Message[]): Project => ({
    ...project,
    currentEpisode: undefined,
    approval: null,
    nodes: [
      {
        id: "analysis",
        name: "原著拆解",
        agentId: "producer",
        description: "",
        output: "",
        status: "completed",
      },
      {
        id: "adaptation",
        name: "剧本改编",
        agentId: "writer",
        description: "",
        output: "",
        status: "completed",
      },
      {
        id: "compliance",
        name: "合规校对",
        agentId: "compliance",
        description: "",
        output: "",
        status: "completed",
      },
      {
        id: "characters",
        name: "角色定妆",
        agentId: "character",
        description: "",
        output: "",
        status: "completed",
      },
      {
        id: "storyboard",
        name: "分镜设计",
        agentId: "director",
        description: "",
        output: "",
        status: "pending",
      },
    ],
    messages,
  });

  it("keeps node acceptance, a sample acceptance, and revision requests distinct", () => {
    const entries = buildActivityLog(
      evidenceProject([
        message("accepted", "user", "text", "已确认「剧本改编」。继续。", "adaptation"),
        message(
          "pilot",
          "user",
          "text",
          "采用「长生」角色样板，继续制作其余角色。",
          "characters",
        ),
        message(
          "revision",
          "user",
          "text",
          "请返修「角色定妆」：请改衣袖。",
          "characters",
        ),
        message("comment", "user", "text", "这一版先讨论一下", "characters"),
      ]),
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "approved",
      "approved",
      "revision",
      "feedback",
    ]);
    expect(entries[1].phase).toBe("character-pilot");
    expect(filterActivity(entries, { agentId: "user" })).toHaveLength(4);
  });

  it("reconstructs an evidenced historical handoff once and exposes both participants and nodes", () => {
    const approved = message(
      "accepted",
      "user",
      "text",
      "已确认「原著拆解」。继续。",
      "analysis",
    );
    const started = message(
      "start",
      "writer",
      "system",
      "开始「剧本改编」。",
      "adaptation",
    );
    const entries = buildActivityLog(
      evidenceProject([
        approved,
        message("invite", "system", "system", "总制片邀请了 编剧 加入项目群"),
        started,
        message("error", "writer", "error", "请求失败", "adaptation"),
        message("retry", "writer", "system", "开始「剧本改编」。", "adaptation"),
      ]),
      agents,
    );
    const handoffs = entries.filter((entry) => entry.kind === "handoff");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      source: "history",
      sourceMessageIds: [approved.id, started.id],
      createdAt: started.createdAt,
    });
    expect(entries.indexOf(handoffs[0])).toBeLessThan(
      entries.findIndex((entry) => entry.id === started.id),
    );
    expect(
      filterActivity(entries, {
        agentId: "writer",
        nodeId: "analysis",
        kind: "handoff",
      }),
    ).toHaveLength(1);
    expect(
      filterActivity(entries, {
        agentId: "producer",
        nodeId: "adaptation",
        kind: "handoff",
      }),
    ).toHaveLength(1);
    expect(filterActivity(entries, { agentId: "writer", kind: "system" })[0].id).toBe(
      "invite",
    );
  });

  it("does not infer a handoff from a sample, a rejected result, or a failed rerun", () => {
    const entries = buildActivityLog(
      evidenceProject([
        message(
          "pilot",
          "user",
          "text",
          "采用「长生」角色样板，继续制作其余角色。",
          "characters",
        ),
        message("same", "character", "system", "开始「角色定妆」。", "characters"),
        message("result", "character", "result", "角色结果", "characters"),
        message(
          "revision",
          "user",
          "text",
          "请返修「角色定妆」：请改衣袖。",
          "characters",
        ),
        message("board", "director", "system", "开始「分镜设计」。", "storyboard"),
        message("approved", "user", "text", "已确认「角色定妆」。", "characters"),
        message("retry", "character", "system", "开始「角色定妆」。", "characters"),
        message("error", "character", "error", "角色生成失败", "characters"),
        message(
          "board-again",
          "director",
          "system",
          "开始「分镜设计」。",
          "storyboard",
        ),
      ]),
      agents,
    );
    expect(entries.filter((entry) => entry.kind === "handoff")).toHaveLength(0);
  });

  it("requires preserved automatic completion evidence for a legacy compliance handoff", () => {
    const result = message(
      "compliance",
      "compliance",
      "result",
      "检查通过",
      "compliance",
    );
    const source = evidenceProject([
      result,
      message("start", "character", "system", "开始「角色定妆」。", "characters"),
    ]);
    expect(
      buildActivityLog(source).filter((entry) => entry.kind === "handoff"),
    ).toHaveLength(0);
    source.nodes[2].completedAt = result.createdAt;
    expect(
      buildActivityLog(source).filter((entry) => entry.kind === "handoff"),
    ).toHaveLength(1);
  });

  it("uses explicit event metadata, keeps run identities, and never duplicates an explicit handoff", () => {
    const entries = buildActivityLog(
      evidenceProject([
        {
          ...message("accepted", "user", "text", "采用了新写法。", "analysis"),
          event: { kind: "approved", approvalId: "approval-1" },
        },
        {
          ...message(
            "handoff",
            "producer",
            "system",
            "总制片把任务交给编剧。",
            "adaptation",
          ),
          event: {
            kind: "handoff",
            fromNodeId: "analysis",
            toNodeId: "adaptation",
            fromAgentId: "producer",
            toAgentId: "writer",
            runId: "run-2",
          },
        },
        {
          ...message("start", "writer", "system", "现在执行任务。", "adaptation"),
          event: { kind: "start", runId: "run-2" },
        },
        {
          ...message("returned", "user", "text", "需要再修改。", "adaptation"),
          event: { kind: "revision_requested" },
        },
      ]),
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "approved",
      "handoff",
      "start",
      "revision",
    ]);
    expect(entries[1].source).toBe("message");
    expect(entries[1].runId).toBe("run-2");
    expect(
      filterActivity(entries, {
        agentId: "producer",
        nodeId: "analysis",
        kind: "handoff",
      }),
    ).toHaveLength(1);
  });

  it("keeps chat executions out of workflow handoff inference", () => {
    const accepted = message(
      "accepted",
      "user",
      "text",
      "已确认「原著拆解」。",
      "analysis",
    );
    const discussion = {
      ...message("chat-start", "writer", "system", "开始答复讨论", "adaptation"),
      event: { kind: "start", scope: "chat", runId: "chat-1" } as const,
    };
    const source = evidenceProject([
      accepted,
      discussion,
      message("workflow-start", "writer", "system", "开始「剧本改编」。", "adaptation"),
    ]);
    const entries = buildActivityLog(source, agents);
    expect(entries.filter((entry) => entry.kind === "handoff")).toHaveLength(1);
    expect(entries.find((entry) => entry.kind === "handoff")?.sourceMessageIds).toEqual(
      ["accepted", "workflow-start"],
    );
    expect(entries.find((entry) => entry.id === "chat-start")?.scope).toBe("chat");
  });

  it("preserves legacy failed chat replies in the corresponding agent's workflow log", () => {
    const entries = buildActivityLog(
      {
        ...project,
        currentEpisode: undefined,
        nodes: [],
        approval: null,
        messages: [
          message(
            "failed",
            "system",
            "system",
            "反馈已保存，但「角色设计」本次回复未完成：接口连接失败",
          ),
        ],
      },
      agents,
    );
    const failed = filterActivity(entries, { agentId: "character" });
    expect(failed).toHaveLength(1);
    expect(failed[0].kind).toBe("error");
    expect(failed[0].agentId).toBe("system");
  });

  it("strips display-only Markdown markers from previews while preserving readable content", () => {
    expect(
      activityPreview(
        "### 制作暂停\n\n**模型服务错误**，请参考[错误说明](https://example.com/error)。",
      ),
    ).toBe("制作暂停 模型服务错误，请参考错误说明。");
  });
  it("scopes records to this episode and includes producer/user handoffs in the responsible agent filter", () => {
    const entries = buildActivityLog(project);
    expect(entries.some((entry) => entry.content === "第一集旧稿")).toBe(false);
    const character = filterActivity(entries, { agentId: "character" });
    expect(character.map((entry) => entry.kind)).toEqual([
      "start",
      "result",
      "approval",
      "revision",
    ]);
    expect(character.find((entry) => entry.kind === "approval")?.agentId).toBe(
      "producer",
    );
    expect(character.find((entry) => entry.kind === "revision")?.agentId).toBe("user");
    expect(filterActivity(entries, { agentId: "character", kind: "chat" })[0].id).toBe(
      "chat",
    );
  });

  it("retains missing node evidence without duplicating recorded starts or fabricating timestamps", () => {
    const entries = buildActivityLog({
      ...project,
      currentEpisode: undefined,
      nodes: [
        { ...project.nodes[0], output: "仅保存在节点中的结果", error: "接口返回 503" },
      ],
    });
    expect(entries.filter((entry) => entry.kind === "start")).toHaveLength(1);
    const retained = entries.filter((entry) => entry.source === "node");
    expect(retained.map((entry) => entry.kind)).toEqual(["result", "error"]);
    expect(retained.every((entry) => entry.createdAt === undefined)).toBe(true);
    expect(entries.some((entry) => entry.content === "第一集旧稿")).toBe(true);
    expect(activityTime("bad-date")).toBe("时间未记录");
  });

  it("distinguishes system collaboration, node progress and recorded errors", () => {
    const entries = buildActivityLog({
      ...project,
      currentEpisode: undefined,
      nodes: [],
      approval: null,
      messages: [
        message("invite", "system", "system", "邀请角色设计加入"),
        message("progress", "character", "system", "正在生成第 2 位角色", "characters"),
        message("error", "character", "error", "图片接口暂时不可用", "characters"),
      ],
    });
    expect(entries.map((entry) => entry.kind)).toEqual(["system", "progress", "error"]);
  });
});

describe("Agent activity dialog", () => {
  it("only badges agents, preserves simultaneous message order, and expands historical evidence", () => {
    const sameTime = "2026-10-13T01:00:00Z";
    render(
      <AgentActivityDialog
        project={{
          ...project,
          currentEpisode: undefined,
          approval: null,
          nodes: project.nodes.map((node) => ({
            ...node,
            output: "",
            startedAt: undefined,
          })),
          messages: [
            {
              ...message(
                "accept",
                "user",
                "text",
                "已确认「角色定妆」。全部已验收。",
                "characters",
              ),
              createdAt: sameTime,
            },
            {
              ...message(
                "start",
                "writer",
                "system",
                "开始「剧本改编」。已接收。",
                "adaptation",
              ),
              createdAt: sameTime,
            },
          ],
        }}
        agents={agents}
        onClose={vi.fn()}
      />,
    );
    const log = screen.getByRole("list", { name: "工作记录" });
    const records = within(log).getAllByRole("listitem");
    expect(within(records[0]).getByText("已确认")).toBeTruthy();
    expect(within(records[0]).getByText("历史用户")).toBeTruthy();
    expect(within(records[0]).queryByText("真人")).toBeNull();
    expect(records[0].querySelector(".studio-member-kind")?.textContent).toBe("用户");
    expect(within(records[1]).getByText("任务交接")).toBeTruthy();
    expect(within(records[1]).getByText("依据历史记录整理")).toBeTruthy();
    expect(within(records[2]).getByText("开始执行")).toBeTruthy();
    expect(within(records[2]).getByText("Agent")).toBeTruthy();
    const details = records[1].querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const evidence = within(records[1]).getByRole("region", { name: "交接依据" });
    expect(within(evidence).getByText("已确认「角色定妆」。全部已验收。")).toBeTruthy();
    expect(within(evidence).getByText("开始「剧本改编」。已接收。")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("成员"));
    fireEvent.click(screen.getByRole("option", { name: /^历史用户$/ }));
    expect(screen.getByRole("combobox", { name: "成员" }).textContent).toBe("历史用户");
    expect(within(log).getAllByRole("listitem")).toHaveLength(1);
    expect(within(log).getByText("已确认")).toBeTruthy();
  });

  it("renders long histories in batches and resets the batch when filters change", () => {
    render(
      <AgentActivityDialog
        project={{
          ...project,
          currentEpisode: undefined,
          nodes: [],
          approval: null,
          messages: Array.from({ length: 80 }, (_, index) =>
            message(
              `history-${index}`,
              "character",
              "system",
              `日志 ${index}`,
              "characters",
            ),
          ),
        }}
        agents={agents}
        onClose={vi.fn()}
      />,
    );
    const log = screen.getByRole("list", { name: "工作记录" });
    expect(within(log).getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(80);
    fireEvent.click(screen.getByLabelText("记录类型"));
    fireEvent.click(screen.getByRole("option", { name: "执行进展" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(50);
  });
  it("opens an agent's workflow history and keeps human feedback discoverable", () => {
    render(
      <AgentActivityDialog
        project={project}
        agents={agents}
        initialAgentId="character"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "成员工作日志" })).toBeTruthy();
    expect(screen.getByText(/第 2 集/)).toBeTruthy();
    const log = screen.getByRole("list", { name: "工作记录" });
    expect(within(log).getByText("@你 请确认角色")).toBeTruthy();
    expect(within(log).getByText("请返修「角色定妆」：袖口改灰色")).toBeTruthy();
    expect(within(log).queryByText("闲聊消息不会当作流程记录")).toBeNull();
    expect(screen.queryByText(agents[0].model)).toBeNull();
    fireEvent.click(screen.getByLabelText("记录类型"));
    fireEvent.click(screen.getByRole("option", { name: "普通对话" }));
    expect(screen.getByText("闲聊消息不会当作流程记录")).toBeTruthy();
    expect(screen.queryByText("@你 请确认角色")).toBeNull();
  });

  it("shows node state, supports no-match reset and lazily renders full Markdown output", () => {
    const text = `短预览${"段落内容。".repeat(60)}\n\n[原始素材](https://example.com/asset.png)`;
    render(
      <AgentActivityDialog
        project={{
          ...project,
          messages: [
            ...project.messages,
            message("full", "character", "result", text, "characters"),
          ],
        }}
        agents={agents}
        initialNodeId="characters"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "节点当前状态" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "原始素材" })).toBeNull();
    const summary = screen.getByText(/短预览/).closest("summary")!;
    const details = summary.parentElement as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(screen.getByRole("link", { name: "原始素材" }).getAttribute("href")).toBe(
      "https://example.com/asset.png",
    );
    fireEvent.click(screen.getByLabelText("成员"));
    fireEvent.click(screen.getByRole("option", { name: "编剧 · Agent" }));
    expect(screen.getByText("没有符合筛选条件的记录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByText("编剧本集结果")).toBeTruthy();
  });

  it("gives an empty episode a clear starting state", () => {
    const onClose = vi.fn();
    render(
      <AgentActivityDialog
        project={{ ...project, messages: [], nodes: [], approval: null }}
        agents={agents}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("本集尚无工作记录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回工作台" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
