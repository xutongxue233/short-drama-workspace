import { randomUUID } from "node:crypto";

export const now = () => new Date().toISOString();
export const uid = (prefix) => `${prefix}-${randomUUID()}`;
export const STYLES = ["真人短剧", "二次元动画", "动态漫画", "国风动画"];

export const NODE_DEFINITIONS = [
  ["analysis", "原著拆解", "提取人物与冲突，确认改编方向和视觉风格", "producer"],
  ["adaptation", "剧本改编", "建立集纲、开场钩子、冲突与结尾悬念", "writer"],
  ["compliance", "合规校对", "检查改编授权、内容风险与角色剧情一致性", "compliance"],
  ["characters", "角色定妆", "创建设定卡与视觉资产，确认并锁定角色", "character"],
  ["storyboard", "分镜设计", "拆解镜头、对白、运镜及角色资产引用", "director"],
  ["video", "视频制作", "按确认分镜请求视频模型并记录产物", "video"],
  ["delivery", "剪辑交付", "整理成片清单、字幕脚本与交付检查", "editor"],
];

export function createNodes() {
  return NODE_DEFINITIONS.map(([id, name, description, agentId]) => ({
    id,
    name,
    description,
    agentId,
    status: "pending",
    output: "",
  }));
}

export function createEpisode(number = 1, createdAt = now(), title = "") {
  return {
    id: uid("episode"),
    number,
    title: title || `第 ${number} 集`,
    createdAt,
    startMessageIndex: 0,
    startAssetIds: [],
    startMaterialIds: [],
    startDecisions: [],
  };
}

export function createProject(input) {
  const time = now();
  return {
    id: uid("project"),
    name: input.name,
    description: input.description || "",
    genre: input.genre || "悬疑",
    style: input.style || "待确认",
    createdAt: time,
    updatedAt: time,
    currentEpisode: createEpisode(1, time),
    episodeArchive: [],
    members: ["producer"],
    messages: [
      {
        id: uid("message"),
        agentId: "producer",
        type: "text",
        createdAt: time,
        content:
          "项目群已建立。我是本项目的总制片。请导入本集要改编的小说章节或原文片段，不需要整本小说，也不需要预先确定总集数。我们每轮创作一集，先核对原文范围、风格、时长和画幅，再由编剧、合规审核、角色设计和导演接力制作。请在模型接入和 Agent 中心配置所需接口；缺少配置时会明确提示。",
      },
    ],
    nodes: createNodes(),
    assets: [],
    chapters: [],
    memory: { summary: "", facts: [], decisions: [], compressedCount: 0 },
    approval: null,
    running: false,
  };
}

export function createSeedState() {
  const agents = [
    {
      id: "producer",
      name: "总制片",
      role: "主控 Agent",
      description: "统筹创作方向、邀请协作成员、推进节点与请求人工确认。",
      color: "#b8ed76",
      providerId: "provider-text",
      systemPrompt:
        "你是短剧项目总制片。严格依据项目原文、已确认决策和锁定资产协调创作。标明未确认事项，不虚构来源或生产结果。将复杂任务拆为可审核的产物。",
    },
    {
      id: "writer",
      name: "编剧",
      role: "剧情改编",
      description: "从小说提炼戏剧冲突，设计开场钩子、集纲、对白和悬念。",
      color: "#b2a3ff",
      providerId: "provider-text",
      systemPrompt:
        "你是短剧编剧。改编必须依据给定小说原文，保持人物动机和因果一致。为每集设计开场钩子、升级冲突和结尾悬念，明确改编增补内容。不得将模板误称为实际原著情节。",
    },
    {
      id: "compliance",
      name: "合规审核",
      role: "内容审校",
      description: "排查内容风险、授权待核实项、人物设定与时间线矛盾。",
      color: "#74d8bc",
      providerId: "provider-text",
      systemPrompt:
        "你是创作内容审核助手。检查暴力、色情、未成年人、歧视和误导等风险，检查版权授权是否有证据，检查剧情和角色一致性。提供具体修改建议，不将模型检查称为法律意见或平台审核通过。",
    },
    {
      id: "character",
      name: "角色设计",
      role: "视觉资产",
      description: "建立角色设定、服装与视觉锚点，为生成提供一致性参考。",
      color: "#f1b18b",
      providerId: "provider-image",
      systemPrompt:
        "你是角色设计师。依据确认风格与人物原文设计角色。严格保留锁定资产中的年龄、面貌、服装和关键道具，输出可重复使用的视觉描述；未提供的信息明确标记为设计提案。",
    },
    {
      id: "director",
      name: "分镜导演",
      role: "镜头语言",
      description: "将剧本拆为可执行镜头，维护角色引用和场景连续性。",
      color: "#89bff5",
      providerId: "provider-text",
      systemPrompt:
        "你是短剧分镜导演。依据确认的剧本、角色资产与风格逐镜设计景别、机位、时长、对白、音效和转场。镜头必须引用角色资产标识与版本，保持动作和空间连续性。",
    },
    {
      id: "video",
      name: "视频制作",
      role: "镜头生成",
      description: "把已确认分镜和参考资产提交给视频服务并保留结果。",
      color: "#e0a4ef",
      providerId: "provider-video",
      systemPrompt:
        "你是视频制作助手。只按已批准的分镜与锁定角色参考制作镜头，保留风格、面部、服装和道具一致性。不宣称未实际生成的视频存在。",
    },
    {
      id: "editor",
      name: "剪辑师",
      role: "交付整理",
      description: "整理字幕、声音建议、镜头顺序和待人工执行的交付清单。",
      color: "#f2d27a",
      providerId: "provider-text",
      systemPrompt:
        "你是短剧剪辑与交付助手。依据实际生成的媒体、分镜和剧本整理剪辑决定表、字幕与交付清单。区分实际媒体与待执行任务；没有渲染工具时不得宣称完成成片剪辑。",
    },
  ].map((agent) => ({ ...agent, enabled: true, model: "" }));

  return {
    projects: [],
    agents,
    providers: [
      {
        id: "provider-text",
        name: "文本创作接口",
        kind: "text",
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        hasKey: false,
        apiKey: "",
        enabled: false,
      },
      {
        id: "provider-image",
        name: "角色生图接口",
        kind: "image",
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        hasKey: false,
        apiKey: "",
        enabled: false,
      },
      {
        id: "provider-video",
        name: "视频生成接口",
        kind: "video",
        protocol: "webhook",
        baseUrl: "",
        model: "",
        hasKey: false,
        apiKey: "",
        enabled: false,
      },
    ],
  };
}
