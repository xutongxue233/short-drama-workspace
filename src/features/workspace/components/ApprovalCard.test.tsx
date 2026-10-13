import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent, Approval, Asset, Project } from "../../../types";
import { ApprovalCard } from "./ApprovalCard";

const approval: Approval = {
  id: "approval-1",
  nodeId: "analysis",
  kind: "style",
  title: "确认本轮制作方案",
  description: "沿用已有风格，确认本轮范围后自动进入短剧改编。",
  options: ["真人", "二次元", "漫画"],
  fields: [
    {
      id: "style",
      label: "视觉风格",
      type: "select",
      options: ["真人", "二次元", "漫画"],
      value: "真人",
      required: true,
    },
    {
      id: "durationSeconds",
      label: "单集时长（秒）",
      type: "text",
      value: "90",
      required: true,
    },
    {
      id: "aspectRatio",
      label: "画幅",
      type: "select",
      options: ["9:16", "16:9", "1:1"],
      value: "9:16",
      required: true,
    },
    {
      id: "platform",
      label: "发布平台",
      type: "select",
      options: ["抖音", "快手"],
      value: "抖音",
      required: true,
    },
  ],
  nextStep: { name: "短剧改编", agentId: "writer" },
};
const project: Project = {
  id: "approval-project",
  name: "借邪骨",
  description: "",
  genre: "悬疑",
  style: "二次元",
  createdAt: "",
  updatedAt: "",
  members: [],
  messages: [],
  nodes: [
    {
      id: "analysis",
      name: "原著分析",
      agentId: "producer",
      description: "",
      output: "",
      status: "waiting",
    },
  ],
  assets: [],
  chapters: [],
  memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
  approval,
  running: false,
};
const agents: Agent[] = [
  {
    id: "writer",
    name: "改编编剧",
    role: "编剧",
    description: "",
    color: "#7160cf",
    enabled: true,
    providerId: "",
    model: "",
    systemPrompt: "",
  },
];

function setup(onAction = vi.fn().mockResolvedValue(true), data = project) {
  const onAssets = vi.fn();
  return {
    ...render(
      <ApprovalCard
        project={data}
        agents={agents}
        busy={false}
        onAction={onAction}
        onAssets={onAssets}
      />,
    ),
    onAction,
    onAssets,
  };
}

describe("structured workflow approvals", () => {
  it("ignores obsolete episode-count questions in saved approvals while submitting the current episode settings", async () => {
    const data = {
      ...project,
      approval: {
        ...approval,
        fields: [
          ...approval.fields!,
          {
            id: "episodeCount",
            label: "本轮集数",
            type: "text" as const,
            value: "12",
            required: true,
          },
        ],
      },
    };
    const { onAction } = setup(vi.fn().mockResolvedValue(true), data);
    expect(screen.queryByRole("textbox", { name: "本轮集数" })).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "确认并继续" })),
    );
    expect(onAction.mock.calls[0][1].answers).not.toHaveProperty("episodeCount");
    expect(onAction.mock.calls[0][1].answers.durationSeconds).toBe("90");
  });
  it("shows the current review and the next agent, preserving the existing style without a duplicate select", () => {
    setup();
    expect(screen.getByText("审核 · 原著分析")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "二次元" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("combobox", { name: "视觉风格" })).toBeNull();
    expect(screen.getByText("改编编剧 · 短剧改编")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /集数/ })).toBeNull();
    expect(
      (screen.getByRole("combobox", { name: "发布平台" }) as HTMLSelectElement).value,
    ).toBe("抖音");
  });

  it("submits editable production answers and optional approval notes together", async () => {
    const { onAction } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "单集时长（秒）" }), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "画幅" }));
    fireEvent.click(screen.getByRole("option", { name: "16:9" }));
    fireEvent.change(screen.getByRole("textbox", { name: /补充要求/ }), {
      target: { value: "  保留主角身份悬念  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/approval-project/approval",
      {
        approvalId: "approval-1",
        decision: "approve",
        value: "二次元",
        answers: {
          style: "二次元",
          durationSeconds: "120",
          aspectRatio: "16:9",
          platform: "抖音",
        },
        feedback: "保留主角身份悬念",
      },
      "已确认，团队继续创作",
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "已提交" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it("blocks missing or invalid required answers and focuses the first field needing attention", () => {
    const { onAction } = setup();
    const duration = screen.getByRole("textbox", { name: "单集时长（秒）" });
    fireEvent.change(duration, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(duration);
    expect(screen.getByText("请填写单集时长（秒）")).toBeTruthy();
    fireEvent.change(duration, {
      target: { value: "0" },
    });
    expect(screen.getByText("请输入 15–600 秒的整数")).toBeTruthy();
    fireEvent.change(duration, { target: { value: "90.5" } });
    expect(screen.getByText("请输入 15–600 秒的整数")).toBeTruthy();
  });

  it("requires revision feedback but does not block revisions on production fields", async () => {
    const { onAction } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "单集时长（秒）" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提出修改" }));
    fireEvent.click(screen.getByRole("button", { name: "提交修改" }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("请填写修改意见")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "修改意见" }), {
      target: { value: "根据第二章重做分析" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交修改" }));
    expect(onAction.mock.calls[0][1]).toEqual({
      approvalId: "approval-1",
      decision: "revise",
      feedback: "根据第二章重做分析",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it("sends only revision feedback when unfinished production fields are empty or invalid", async () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "漫画" }));
    fireEvent.change(screen.getByRole("textbox", { name: "单集时长（秒）" }), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提出修改" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改意见" }), {
      target: { value: "请先补充原文依据，再确定制作范围" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交修改" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/approval-project/approval",
      {
        approvalId: "approval-1",
        decision: "revise",
        feedback: "请先补充原文依据，再确定制作范围",
      },
      "修改意见已提交",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it("locks every control and prevents duplicate approval requests while a response is pending", async () => {
    let finish!: (value: boolean) => void;
    const onAction = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    setup(onAction);
    const button = screen.getByRole("button", { name: "确认并继续" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "确认本轮制作方案" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    for (const control of [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ]) {
      expect((control as HTMLInputElement).disabled).toBe(true);
    }
    await act(async () => finish(false));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("填写内容已保留");
  });

  it("preserves answers after a failed save and resets drafts for a different approval", async () => {
    const { onAction, rerender } = setup(vi.fn().mockResolvedValue(false));
    fireEvent.change(screen.getByRole("textbox", { name: /补充要求/ }), {
      target: { value: "保留原著设定" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(
      (screen.getByRole("textbox", { name: /补充要求/ }) as HTMLTextAreaElement).value,
    ).toBe("保留原著设定");
    rerender(
      <ApprovalCard
        project={{ ...project, approval: { ...approval, id: "approval-2" } }}
        busy={false}
        onAction={onAction}
      />,
    );
    expect(
      (screen.getByRole("textbox", { name: /补充要求/ }) as HTMLTextAreaElement).value,
    ).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps legacy approvals usable and respects an externally busy workspace", async () => {
    const legacyProject = {
      ...project,
      approval: { ...approval, fields: undefined, nextStep: undefined },
    };
    const { onAction, rerender } = setup(
      vi.fn().mockResolvedValue(true),
      legacyProject,
    );
    rerender(<ApprovalCard project={legacyProject} busy onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onAction).not.toHaveBeenCalled();
    rerender(<ApprovalCard project={legacyProject} busy={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "漫画" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    expect(onAction.mock.calls[0][1]).toMatchObject({
      value: "漫画",
      answers: { style: "漫画" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });
});

function characterProject(assets: Asset[]): Project {
  return {
    ...project,
    assets,
    approval: {
      id: "character-approval",
      nodeId: "characters",
      kind: "character",
      title: "确认角色定妆",
      description: "核对角色形象后锁定标准。",
    },
  };
}

const character: Asset = {
  id: "current-character",
  name: "林砚",
  type: "character",
  description: "角色设定",
  content: "长衫少年",
  url: "https://example.test/character.png",
  locked: false,
  version: 2,
  createdAt: "",
  tags: ["node:characters", "待确认"],
};

describe("character approval previews", () => {
  it("shows current character assets only and opens the library without locking or approving them", () => {
    const data = characterProject([
      character,
      { ...character, id: "text-character", name: "阿婆", url: undefined },
      { ...character, id: "old-character", name: "旧版形象", tags: ["历史版本"] },
      { ...character, id: "stale-character", name: "待重做形象", tags: ["待更新"] },
      { ...character, id: "scene", name: "祠堂", type: "scene" },
    ]);
    const { onAction, onAssets } = setup(vi.fn(), data);
    const list = screen.getByRole("list", { name: "本轮角色资产" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByRole("img", { name: "林砚" }).getAttribute("src")).toBe(
      character.url,
    );
    expect(within(list).getByText("v2 · 定妆图")).toBeTruthy();
    expect(within(list).getByText("仅文字设定，暂无图片")).toBeTruthy();
    expect(within(list).getByText("v2 · 文字卡 · 无图片")).toBeTruthy();
    expect(screen.queryByText("旧版形象")).toBeNull();
    expect(screen.queryByText("待重做形象")).toBeNull();
    expect(screen.queryByText("祠堂")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看项目资产" }));
    expect(onAssets).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    expect(data.assets.every((asset) => asset.locked === false)).toBe(true);
  });

  it("makes image loading failures visible while retaining the asset name and review actions", () => {
    setup(vi.fn(), characterProject([character]));
    fireEvent.error(screen.getByRole("img", { name: "林砚" }));
    expect(screen.queryByRole("img", { name: "林砚" })).toBeNull();
    expect(screen.getByText(/素材暂时无法加载/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("林砚")).toBeTruthy();
    expect(screen.getByRole("button", { name: "提出修改" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看项目资产" })).toBeTruthy();
  });

  it("explains when no current character assets can be reviewed", () => {
    setup(vi.fn(), characterProject([{ ...character, tags: ["历史版本"] }]));
    expect(screen.queryByRole("list", { name: "本轮角色资产" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("当前没有有效的角色资产");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("separates base designs from unmade scene states and states the manual acceptance criteria", () => {
    const data = characterProject([
      {
        ...character,
        characterDesign: {
          version: 1,
          subjectType: "person",
          baseAppearance: "深色短发，灰蓝长衫，棕色布鞋。",
          sceneStates: [
            { name: "逆光现形", description: "剪影与冷光，不改变基础五官和服装。" },
          ],
        },
      },
    ]);
    data.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块";
    setup(vi.fn(), data);
    expect(screen.getByText("基础设定")).toBeTruthy();
    expect(screen.getByText("含 1 种待制作状态")).toBeTruthy();
    expect(screen.getByText(/五官可辨、头脚完整、服装固定、画风统一/)).toBeTruthy();
    expect(screen.getByText(/剧情状态另行制作，不作为基础身份设定/)).toBeTruthy();
    expect(screen.getByText(/图片已生成不代表验收通过/)).toBeTruthy();
    expect(screen.getByText(data.visualStyleGuide)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeTruthy();
  });

  it("shows replacement drafts instead of duplicating the old locked portrait in final review", () => {
    setup(
      vi.fn(),
      characterProject([
        {
          ...character,
          id: "old-standard",
          locked: true,
          url: "https://example.test/old.png",
        },
        {
          ...character,
          id: "new-standard",
          tags: [...character.tags, "replaces:old-standard"],
        },
      ]),
    );
    const list = screen.getByRole("list", { name: "本轮角色资产" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "林砚" }).getAttribute("src")).toBe(
      character.url,
    );
    expect(screen.queryByText("已锁定标准")).toBeNull();
  });

  it("keeps an old locked portrait visible when its replacement is stale", () => {
    setup(
      vi.fn(),
      characterProject([
        {
          ...character,
          id: "old-standard",
          locked: true,
          url: "https://example.test/old.png",
        },
        {
          ...character,
          id: "stale-replacement",
          tags: ["replaces:old-standard", "待更新"],
        },
      ]),
    );
    expect(screen.getByRole("img", { name: "林砚" }).getAttribute("src")).toBe(
      "https://example.test/old.png",
    );
    expect(screen.getByText("已锁定标准")).toBeTruthy();
  });

  it("opens each portrait in a read-only dialog and restores focus after keyboard dismissal", () => {
    const { onAction } = setup(
      vi.fn(),
      characterProject([
        character,
        {
          ...character,
          id: "second-character",
          name: "阿婆",
          url: "https://example.test/grandmother.png",
        },
      ]),
    );
    const expand = screen.getByRole("button", { name: "放大查看 阿婆" });
    expand.focus();
    fireEvent.click(expand);
    const dialog = screen.getByRole("dialog", { name: "角色大图 · 阿婆" });
    expect(within(dialog).getByRole("img", { name: "阿婆" }).getAttribute("src")).toBe(
      "https://example.test/grandmother.png",
    );
    expect(within(dialog).queryByRole("button", { name: /确认|采用|提交/ })).toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(expand);
    fireEvent.click(screen.getByRole("button", { name: "放大查看 林砚" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

function pilotProject(assets: Asset[]): Project {
  const data = characterProject(assets);
  return {
    ...data,
    nodes: [
      {
        id: "characters",
        name: "角色定妆",
        description: "",
        agentId: "character",
        status: "waiting",
        output: "",
        characterGeneration: {
          id: "current-generation",
          key: "generation-key",
          outputKind: "image",
          stage: "pilot",
          pilotName: "林砚",
          plan: [
            { name: "林砚", description: "少年", content: "长衫少年" },
            { name: "阿婆", description: "老人", content: "蓝衫老人" },
          ],
        },
      },
    ],
    approval: { ...data.approval!, phase: "character-pilot" },
  };
}

describe("character pilot approval", () => {
  const pilot: Asset = {
    ...character,
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance: "深色短发，灰蓝长衫，棕色布鞋。",
      sceneStates: [],
    },
    tags: [...character.tags, "generation:current-generation"],
  };

  it("shows only the current generated pilot and submits its approval without suggesting other roles are missing", async () => {
    const data = pilotProject([
      pilot,
      { ...pilot, id: "historical", name: "历史样板", tags: ["历史版本"] },
      { ...pilot, id: "other", name: "阿婆" },
      { ...pilot, id: "old-generation", url: "https://example.test/old.png", tags: [] },
    ]);
    const { onAction } = setup(vi.fn().mockResolvedValue(true), data);
    const list = screen.getByRole("list", { name: "本轮角色资产" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("img", { name: "林砚" }).getAttribute("src")).toBe(
      pilot.url,
    );
    expect(screen.queryByText("阿婆")).toBeNull();
    expect(screen.queryByText("仅文字设定，暂无图片")).toBeNull();
    expect(screen.getByText("本轮样板预览")).toBeTruthy();
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(screen.getByText(/其余角色生成后仍需逐张验收/)).toBeTruthy();
    expect(screen.getByText(/请目视检查画风与基础造型/)).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(pilot.locked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "采用样板并继续" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/approval-project/approval",
      expect.objectContaining({
        approvalId: "character-approval",
        decision: "approve",
      }),
      "已确认，团队继续创作",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it("keeps revisions available when the actual pilot is missing and never substitutes an earlier image", async () => {
    setup(
      vi.fn().mockResolvedValue(true),
      pilotProject([{ ...pilot, tags: ["generation:old-generation"] }]),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("本轮样板尚未就绪");
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "修改样板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改意见" }), {
      target: { value: "请重做清晰的正面基础设定，去掉剧情逆光。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交修改" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it("does not guess a pilot when a checkpoint has no explicit pilot name", () => {
    const data = pilotProject([pilot]);
    delete data.nodes[0].characterGeneration!.pilotName;
    setup(vi.fn(), data);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("本轮样板尚未就绪");
  });

  it("collects pilot feedback only through revision and clears cancelled changes before acceptance", async () => {
    const { onAction } = setup(vi.fn().mockResolvedValue(true), pilotProject([pilot]));
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(screen.queryByRole("textbox", { name: /补充要求/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改样板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改意见" }), {
      target: { value: "全部角色服装改为低饱和度" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "采用样板并继续" }));
    expect(onAction).toHaveBeenCalledWith(
      "/projects/approval-project/approval",
      expect.objectContaining({ decision: "approve", feedback: "" }),
      "已确认，团队继续创作",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it.each([
    ["edited content", { content: "改过但未重生成的新设定" }],
    ["manually locked", { locked: true }],
    ["legacy image", { characterDesign: undefined }],
  ] as const)("excludes a same-generation pilot with %s", (_label, changes) => {
    setup(vi.fn(), pilotProject([{ ...pilot, ...changes }]));
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("requires the pilot image to load before acceptance and blocks a failed preview without blocking revision or the library", () => {
    const { onAction, onAssets } = setup(vi.fn(), pilotProject([pilot]));
    const approve = screen.getByRole("button", {
      name: "采用样板并继续",
    }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText(/样板图片加载中/)).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "确认角色定妆" }));
    expect(onAction).not.toHaveBeenCalled();
    const portrait = screen.getByRole("img", { name: "林砚" });
    fireEvent.load(portrait);
    expect(approve.disabled).toBe(false);
    fireEvent.error(portrait);
    expect(approve.disabled).toBe(true);
    expect(screen.getByText(/样板图片未能加载/)).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "确认角色定妆" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看项目资产" }));
    expect(onAssets).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "修改样板" }));
    expect(screen.getByRole("textbox", { name: "修改意见" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "提交修改" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("requires a fresh load when the current pilot image changes under the same approval", () => {
    const { onAction, rerender } = setup(vi.fn(), pilotProject([pilot]));
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    rerender(
      <ApprovalCard
        project={pilotProject([
          { ...pilot, version: 3, url: "https://example.test/new-pilot.png" },
        ])}
        busy={false}
        onAction={onAction}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("retries a failed preview in place while retaining revision feedback", () => {
    setup(vi.fn(), pilotProject([pilot]));
    fireEvent.error(screen.getByRole("img", { name: "林砚" }));
    fireEvent.click(screen.getByRole("button", { name: "修改样板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改意见" }), {
      target: { value: "保留这条未提交意见" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重试加载 林砚" }));
    expect(screen.getByText(/样板图片加载中/)).toBeTruthy();
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(
      (screen.getByRole("textbox", { name: "修改意见" }) as HTMLTextAreaElement).value,
    ).toBe("保留这条未提交意见");
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    expect(
      (screen.getByRole("button", { name: "采用样板并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps the pilot approval image-load gate independent of its enlarged preview", () => {
    const { onAction } = setup(vi.fn(), pilotProject([pilot]));
    const approve = screen.getByRole("button", {
      name: "采用样板并继续",
    }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "放大查看 林砚" }));
    const dialog = screen.getByRole("dialog", { name: "角色大图 · 林砚" });
    const design = within(dialog).getByText("查看基础外观设定").closest("details");
    expect(design?.hasAttribute("open")).toBe(false);
    expect(
      within(dialog).getByText(pilot.characterDesign!.baseAppearance),
    ).toBeTruthy();
    fireEvent.load(within(dialog).getByRole("img", { name: "林砚" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭预览" }));
    expect(approve.disabled).toBe(true);
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(approve.disabled).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps the long style guide below the pilot image and collapsed by default", () => {
    const data = pilotProject([pilot]);
    data.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块。".repeat(30);
    setup(vi.fn(), data);
    const guide = screen.getByText("验收标准与项目画风").closest("details")!;
    expect(guide.hasAttribute("open")).toBe(false);
    expect(within(guide).getByText(data.visualStyleGuide)).toBeTruthy();
    const preview = screen.getByText("本轮样板预览").closest("details")!;
    expect(preview.hasAttribute("open")).toBe(true);
    expect(
      preview.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

const finalDesign: NonNullable<Asset["characterDesign"]> = {
  version: 1,
  subjectType: "person",
  baseAppearance: "黑色短发，灰蓝长衫，棕色布鞋。",
  sceneStates: [],
};
const finalCharacters: Asset[] = [
  {
    ...character,
    tags: [...character.tags, "generation:current-generation"],
    characterDesign: finalDesign,
  },
  {
    ...character,
    id: "grandmother",
    name: "阿婆",
    content: "蓝衫老人",
    url: "https://example.test/grandmother.png",
    tags: [...character.tags, "generation:current-generation"],
    characterDesign: finalDesign,
  },
];

function finalCharacterProject(
  assets: Asset[],
  outputKind: "image" | "text" = "image",
) {
  const data = pilotProject(assets);
  data.approval = { ...data.approval!, phase: undefined };
  data.nodes[0].characterGeneration = {
    ...data.nodes[0].characterGeneration!,
    stage: outputKind === "image" ? "batch" : undefined,
    outputKind,
    plan: finalCharacters.map((asset) => ({
      name: asset.name,
      description: asset.description,
      content: asset.content,
      characterDesign: asset.characterDesign,
    })),
  };
  return data;
}

describe("final character approval", () => {
  it("reviews only current matching planned drafts and reusable locked standards, requiring every image to load", async () => {
    const data = finalCharacterProject([
      { ...finalCharacters[0], id: "old-generation", tags: ["generation:previous"] },
      { ...finalCharacters[0], id: "edited", content: "已经不同的外观" },
      {
        ...finalCharacters[0],
        id: "other-design",
        characterDesign: { ...finalDesign, baseAppearance: "红色长衫" },
      },
      { ...finalCharacters[0], id: "unplanned", name: "上一集的路人" },
      finalCharacters[0],
      { ...finalCharacters[1], locked: true, tags: ["node:characters"] },
    ]);
    const { onAction } = setup(vi.fn().mockResolvedValue(true), data);
    const list = screen.getByRole("list", { name: "本轮角色资产" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("上一集的路人")).toBeNull();
    const confirm = screen.getByRole("button", {
      name: "确认并继续",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/已显示 1 \/ 2/)).toBeTruthy();
    fireEvent.load(screen.getByRole("img", { name: "阿婆" }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith(
      "/projects/approval-project/approval",
      expect.objectContaining({
        approvalId: "character-approval",
        decision: "approve",
      }),
      "已确认，团队继续创作",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
  });

  it("blocks a missing planned role rather than substituting an old-generation image", () => {
    const { onAction } = setup(
      vi.fn(),
      finalCharacterProject([
        finalCharacters[0],
        { ...finalCharacters[1], tags: ["generation:previous"] },
      ]),
    );
    fireEvent.load(screen.getByRole("img", { name: "林砚" }));
    expect(screen.queryByRole("img", { name: "阿婆" })).toBeNull();
    expect(screen.getByText(/缺少本轮角色资产：阿婆/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "确认角色定妆" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "提出修改" }));
    expect(
      (screen.getByRole("button", { name: "提交修改" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("requires image outputs when a live image checkpoint contains only a text draft", () => {
    setup(
      vi.fn(),
      finalCharacterProject([
        finalCharacters[0],
        { ...finalCharacters[1], url: undefined },
      ]),
    );
    expect(screen.getByText(/以下角色缺少图片：阿婆/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("blocks final acceptance after an image fails without removing the revision or asset controls", () => {
    const { onAction, onAssets } = setup(
      vi.fn(),
      finalCharacterProject(finalCharacters),
    );
    for (const image of screen.getAllByRole("img")) fireEvent.load(image);
    const confirm = screen.getByRole("button", {
      name: "确认并继续",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.error(screen.getByRole("img", { name: "阿婆" }));
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/以下角色图片无法加载：阿婆/)).toBeTruthy();
    fireEvent.submit(screen.getByRole("form", { name: "确认角色定妆" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看项目资产" }));
    expect(onAssets).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "提出修改" }));
    expect(screen.getByRole("textbox", { name: "修改意见" })).toBeTruthy();
  });

  it("allows complete text-bound character drafts without image-load requirements", async () => {
    const { onAction } = setup(
      vi.fn().mockResolvedValue(true),
      finalCharacterProject(
        finalCharacters.map((asset) => ({ ...asset, url: undefined })),
        "text",
      ),
    );
    expect(screen.queryByText(/正在加载本轮角色图片|以下角色缺少图片/)).toBeNull();
    const confirm = screen.getByRole("button", {
      name: "确认并继续",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已提交" })).toBeTruthy(),
    );
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("reuses a compatible locked image when a newer same-plan draft has no picture", () => {
    setup(
      vi.fn(),
      finalCharacterProject([
        finalCharacters[0],
        { ...finalCharacters[1], id: "text-upgrade", url: undefined },
        {
          ...finalCharacters[1],
          id: "existing-standard",
          locked: true,
          content: "附有旧版文字注释但基础设计相同",
          tags: ["node:characters"],
        },
      ]),
    );
    expect(screen.getByRole("img", { name: "阿婆" }).getAttribute("src")).toBe(
      finalCharacters[1].url,
    );
    expect(screen.queryByText(/以下角色缺少图片/)).toBeNull();
    for (const image of screen.getAllByRole("img")) fireEvent.load(image);
    expect(
      (screen.getByRole("button", { name: "确认并继续" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
