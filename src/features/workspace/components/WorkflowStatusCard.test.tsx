import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Asset, Project } from "../../../types";
import { WorkflowStatusCard } from "./WorkflowStatusCard";

const project: Project = {
  id: "handoff",
  name: "项目",
  description: "",
  genre: "悬疑",
  style: "二次元动画",
  createdAt: "",
  updatedAt: "",
  members: ["producer"],
  running: false,
  approval: null,
  nodes: [
    {
      id: "analysis",
      name: "原著拆解",
      agentId: "producer",
      status: "pending",
      description: "",
      output: "",
    },
  ],
  chapters: [{ id: "source", title: "第一章", content: "小说素材", createdAt: "" }],
  messages: [
    {
      id: "proposal",
      agentId: "producer",
      type: "text",
      content: "聊天提案".repeat(80),
      createdAt: "",
    },
  ],
  assets: [],
  memory: { summary: "", decisions: [], facts: [], compressedCount: 0 },
};

describe("workflow handoff from chat", () => {
  it("gives a legacy conversation a concrete workflow entry without marking its draft approved", () => {
    const onAction = vi.fn();
    render(
      <WorkflowStatusCard
        project={project}
        agents={[]}
        busy={false}
        onAction={onAction}
      />,
    );
    expect(screen.getByText(/尚未进入正式制作节点/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "启动制作流程" }));
    expect(onAction).toHaveBeenCalledWith("/projects/handoff/run");
    expect(project.nodes[0].status).toBe("pending");
  });

  it("shows the failed node cause with a resumable retry", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...project,
          nodes: [{ ...project.nodes[0], status: "failed", error: "服务已停用" }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("服务已停用")).toBeTruthy();
    expect(screen.getByText(/展开错误详情查看具体原因/)).toBeTruthy();
    expect(screen.queryByText(/模型接入和 Agent 中心/)).toBeNull();
    expect(screen.getByRole("button", { name: "重试当前节点" })).toBeTruthy();
  });

  it("does not offer another start during production or an approval", () => {
    const view = render(
      <WorkflowStatusCard
        project={{ ...project, running: true }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(
      <WorkflowStatusCard
        project={{
          ...project,
          approval: {
            id: "review",
            nodeId: "analysis",
            kind: "style",
            title: "审核",
            description: "",
          },
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const runningCharacters: Project = {
  ...project,
  running: true,
  nodes: [
    {
      ...project.nodes[0],
      id: "characters",
      name: "角色定妆",
      agentId: "character",
      status: "running",
      startedAt: "2026-10-12T09:00:00Z",
      characterGeneration: {
        id: "current-plan",
        key: "current-context",
        plan: [
          { name: "林砚", description: "主角", content: "长衫少年" },
          { name: "阿婆", description: "长辈", content: "布衣老人" },
        ],
      },
    },
  ],
};
const draft: Asset = {
  id: "draft-1",
  name: "林砚",
  type: "character",
  description: "主角",
  content: "长衫少年",
  version: 1,
  createdAt: "2026-10-12T09:01:00Z",
  locked: false,
  url: "https://example.test/character.png",
  tags: ["generation:current-plan", "待确认"],
};

describe("character generation progress", () => {
  it("explains that batch generation reuses a pilot saved before the current node start", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          assets: [{ ...draft, createdAt: "2026-10-11T09:00:00Z" }],
          nodes: [
            {
              ...runningCharacters.nodes[0],
              characterGeneration: {
                ...runningCharacters.nodes[0].characterGeneration!,
                stage: "batch",
                pilotName: "林砚",
                outputKind: "image",
              },
            },
          ],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("已保存 1 / 2 项角色资产");
    expect(screen.getByText(/样板已确认，正在继续制作其余角色/)).toBeTruthy();
    expect(screen.queryByText(/等待首张结果/)).toBeNull();
  });

  it.each([
    "角色「林砚」的基础外观包含备选方案。",
    "角色「林砚」的基础设计格式不完整。请提供 characterDesign。",
    "角色「林砚」的基础外观混入了镜头状态。",
  ])("gives actionable baseline-design guidance for %s", (error) => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          running: false,
          nodes: [{ ...runningCharacters.nodes[0], status: "failed", error }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/五官、发型、服装和配色各选一个明确方案/)).toBeTruthy();
    expect(screen.getByText(/剧情状态单独放入 sceneStates/)).toBeTruthy();
    expect(screen.getByText(/无需上传整本小说，也无需修改模型接口配置/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试当前节点" })).toBeTruthy();
  });

  it("sets the single-pilot expectation while a project with a style guide is still planning", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          visualStyleGuide: "二维赛璐璐：清晰线稿、平涂色块",
          nodes: [{ ...runningCharacters.nodes[0], characterGeneration: undefined }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("正在整理基础角色设计")).toBeTruthy();
    expect(screen.getByText(/样板通过后才继续其余角色/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "计划确定后先生成一位角色样板",
    );
    expect(screen.queryByText(/全部处理完成后/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains that the remaining cast waits for a single pilot rather than reporting missing drafts", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          nodes: [
            {
              ...runningCharacters.nodes[0],
              characterGeneration: {
                ...runningCharacters.nodes[0].characterGeneration!,
                stage: "pilot",
                pilotName: "林砚",
              },
            },
          ],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("正在制作首位角色样板")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("角色样板：林砚 · 制作中");
    expect(screen.getByRole("status").textContent).toContain(
      "其余 1 位将在样板确认后继续制作",
    );
    expect(screen.queryByText(/计划中尚无草稿|全部处理完成后/)).toBeNull();
  });

  it("reports a saved pilot as awaiting visual review instead of marking other roles as failed", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          running: false,
          assets: [
            {
              ...draft,
              characterDesign: {
                version: 1,
                subjectType: "person",
                baseAppearance: "蓝色长衫",
                sceneStates: [],
              },
            },
          ],
          nodes: [
            {
              ...runningCharacters.nodes[0],
              status: "pending",
              characterGeneration: {
                ...runningCharacters.nodes[0].characterGeneration!,
                stage: "pilot",
                pilotName: "林砚",
              },
            },
          ],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("角色样板：林砚 · 已保存");
    expect(screen.getByText(/画风与基础造型仍需你目视验收/)).toBeTruthy();
    expect(screen.queryByText(/计划中尚无草稿|制作需要处理/)).toBeNull();
  });

  it.each([
    "角色「爷爷（李半山）」未在已提供原文或锁定资产中出现，请核对姓名后重试。",
    "角色规划无法确认「新角色」的来源，请先补充人物依据。",
    "角色「新角色」尚未出现在原著、已批准剧本或有效锁定角色中。请让编剧补充人物依据，或先批准新增角色后重试。",
    "角色「爷爷（李半山）」的称谓与姓名缺少明确的同一人物依据，请让编剧补充人物关系，或先批准新增角色设定后重试。",
  ])(
    "directs a character source failure to source review and automatic asset creation: %s",
    (error) => {
      const onAction = vi.fn();
      render(
        <WorkflowStatusCard
          project={{
            ...runningCharacters,
            running: false,
            nodes: [{ ...runningCharacters.nodes[0], status: "failed", error }],
          }}
          agents={[]}
          busy={false}
          onAction={onAction}
        />,
      );
      expect(screen.getByText(/角色名单需要核对来源/)).toBeTruthy();
      expect(screen.getByText(/角色姓名、称谓/)).toBeTruthy();
      expect(screen.getByText(/当前已批准剧本或有效角色资产/)).toBeTruthy();
      expect(screen.getByText(/请编剧补充人物依据/)).toBeTruthy();
      expect(screen.getByText(/通过剧本审批确认新增角色/)).toBeTruthy();
      expect(screen.getByText(/自动创建设定，无需手动新建/)).toBeTruthy();
      expect(screen.queryByText(/在模型接入|供应商控制台|API/)).toBeNull();
      const details = screen.getByText("查看原始错误详情").closest("details");
      expect(details?.textContent).toContain(error);
      expect(details?.hasAttribute("open")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "重试当前节点" }));
      expect(onAction).toHaveBeenCalledWith("/projects/handoff/run");
    },
  );

  it("keeps malformed role-plan guidance separate from provider setup", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          running: false,
          nodes: [
            {
              ...runningCharacters.nodes[0],
              status: "failed",
              error: "角色规划模型未返回有效 JSON。",
            },
          ],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/核对人物称谓或出场描述/)).toBeTruthy();
    expect(screen.getByText(/只需提供本集小说片段，无需上传完整小说/)).toBeTruthy();
    expect(screen.queryByText(/模型接入|供应商控制台/)).toBeNull();
  });

  it("counts only current matching saved drafts and excludes old, stale, historical and mismatched assets", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          assets: [
            draft,
            {
              ...draft,
              id: "duplicate",
              tags: ["generation:current-plan", "历史版本"],
            },
            {
              ...draft,
              id: "previous",
              name: "阿婆",
              content: "布衣老人",
              tags: ["generation:previous-plan"],
            },
            {
              ...draft,
              id: "stale",
              name: "阿婆",
              content: "布衣老人",
              tags: ["generation:current-plan", "待更新"],
            },
            { ...draft, id: "edited", name: "阿婆", content: "尚未确认的新设定" },
          ],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("已保存 1 / 2 项角色资产");
    expect(status.textContent).toContain("计划中尚无草稿：阿婆");
    expect(status.textContent).toContain("按本次已落盘的角色计划统计");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("labels an existing checkpoint as stored information until a draft from this run is saved", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          assets: [{ ...draft, createdAt: "2026-10-11T09:00:00Z" }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("已保存 1 / 2 项角色资产");
    expect(screen.getByText("已存角色计划，正在校验或等待首张结果。")).toBeTruthy();
    expect(screen.queryByText(/按本次已落盘/)).toBeNull();
  });

  it("shows planning without inventing a total before a saved plan is available", () => {
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          nodes: [{ ...runningCharacters.nodes[0], characterGeneration: undefined }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "正在整理角色名单与设定，计划确定后逐项保存资产。",
    );
    expect(screen.queryByText(/已保存.*项角色资产/)).toBeNull();
  });

  it("explains model activation failures in Chinese while keeping the full diagnostic in collapsed details", () => {
    const error =
      "HTTP 404: The model is not activated for your account. Request ID: request-123";
    render(
      <WorkflowStatusCard
        project={{
          ...runningCharacters,
          running: false,
          nodes: [{ ...runningCharacters.nodes[0], status: "failed", error }],
        }}
        agents={[]}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/模型尚未开通或当前账号无调用权限/)).toBeTruthy();
    const details = screen.getByText("查看原始错误详情").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain(error);
    expect(screen.getByRole("button", { name: "重试当前节点" })).toBeTruthy();
    expect(screen.getByText("按已存角色计划统计，恢复制作时会重新校验。")).toBeTruthy();
  });
});
