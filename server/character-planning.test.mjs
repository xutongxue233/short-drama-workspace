import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./seed.mjs";
import { addMessage, remember } from "./workflow/memory.mjs";
import {
  buildCharacterPlanningPrompt,
  characterDesignFeedback,
  CHARACTER_DESIGN_FEEDBACK_BUDGET,
  CHARACTER_PLANNING_VERSION,
} from "./workflow/character-planning.mjs";

function fixture() {
  const project = createProject({ name: "片段改编", style: "二次元动画" });
  project.chapters = [
    { id: "fragment", title: "本次片段", content: "林晚见到母亲，母亲拉住她的衣袖。" },
  ];
  const card = (
    id,
    name,
    content,
    type = "script",
    version = 1,
    tags = ["node:adaptation"],
  ) => ({ id, name, content, type, version, tags, locked: true });
  project.assets = [
    card("current", "当前一集", "林晚与母亲在门口对话。", "script", 2),
    card("old", "旧版剧本", "废弃侦探人物不应混入当前集。"),
    card("draft", "未批准稿", "未批准飞行员人物不应混入当前集。"),
    card("locked-role", "母亲", "既有母亲外观：蓝色布衣。", "character", 1, [
      "node:characters",
    ]),
    card("old-role", "归档角色", "历史角色外观不应混入当前集。", "character", 1, [
      "node:characters",
      "历史版本",
    ]),
  ];
  project.assets.find((asset) => asset.id === "draft").locked = false;
  project.nodes.find((node) => node.id === "adaptation").output =
    project.assets[0].content;
  project.messages = [
    { agentId: "producer", type: "text", content: "旧聊天杀手人物不应混入当前集。" },
  ];
  project.memory.summary = "旧摘要间谍人物不应混入当前集。";
  return project;
}

test("cast planning uses only the current approved script, uploaded fragment and effective role standards", () => {
  const prompt = buildCharacterPlanningPrompt(fixture());
  assert.match(prompt, /林晚与母亲在门口对话/);
  assert.match(prompt, /母亲拉住她的衣袖/);
  assert.match(prompt, /既有母亲外观：蓝色布衣/);
  assert.doesNotMatch(
    prompt,
    /废弃侦探|未批准飞行员|历史角色外观|旧聊天杀手|旧摘要间谍/,
  );
  assert.match(prompt, /用户只需上传本次改编片段，不需要整本小说/);
  assert.match(prompt, /1 至 12/);
  assert.match(prompt, /群体成员的实名、亲属或人数/);
});

test("cast planning falls back to the uploaded fragment and does not treat chapter titles as a full novel", () => {
  const project = fixture();
  project.assets = [];
  const prompt = buildCharacterPlanningPrompt(project);
  assert.match(prompt, /尚无锁定剧本/);
  assert.match(prompt, /暂无；应从当前出场人物开始创建/);
  assert.doesNotMatch(prompt, /林晚与母亲在门口对话/);
});

test("cast correction includes the validation problem and previous proposal as untrusted repair material", () => {
  const prompt = buildCharacterPlanningPrompt(fixture(), {
    previous: '{"characters":[{"name":"家人"}]}',
    error: "家人是群体，请分开父亲、母亲和奶奶",
  });
  assert.match(prompt, /唯一一次自动校正/);
  assert.match(prompt, /家人是群体，请分开父亲、母亲和奶奶/);
  assert.match(prompt, /上次输出（仅供修正，不是人物来源）/);
  assert.match(prompt, /通过校验后才会开始生图/);
});

test("planning asks for a neutral production design with explicit episode state separation", () => {
  const prompt = buildCharacterPlanningPrompt(fixture());
  assert.match(prompt, /characterDesign\.baseAppearance/);
  assert.match(
    prompt,
    /年龄或明确年龄段、脸型及五官、发型、体型、固定服装版型、主辅配色、可辨识特征/,
  );
  assert.match(prompt, /不得把本集逆光、剪影、全黑眼球、尸斑、半脸遮挡/);
  assert.match(prompt, /不写入基础设定/);
  assert.match(prompt, /"characterDesign":\{"version":1,"subjectType":"person"/);
  assert.match(prompt, /"sceneStates":\[/);
  assert.doesNotMatch(prompt, /"appearance":/);
  assert.notEqual(CHARACTER_PLANNING_VERSION, "episode-cast-v1");
});

test("planning applies one shared project style guide without inventing a locked default", () => {
  const project = fixture();
  project.visualStyleGuide = "统一细线稿、低饱和土色、两级赛璐璐阴影。";
  const prompt = buildCharacterPlanningPrompt(project);
  assert.match(prompt, /统一细线稿、低饱和土色、两级赛璐璐阴影/);
  assert.match(prompt, /所有角色共同遵循/);
  assert.doesNotMatch(prompt, /项目尚未细化统一视觉标准/);
  delete project.visualStyleGuide;
  const fallback = buildCharacterPlanningPrompt(project);
  assert.match(fallback, /仅沿用已选「二次元动画」风格/);
  assert.match(fallback, /不把尚未确认的画师、画法或色彩规范冒充锁定标准/);
  assert.doesNotMatch(fallback, /低饱和土色/);
});

test("planning incorporates current role revisions as proposals without turning feedback into source facts", () => {
  const project = fixture();
  project.memory.decisions = [
    "用户对「角色定妆」的返修要求：母亲服装换成暗青色，降低服装饱和度。",
    "用户对「角色定妆」的返修要求：母亲发型改为低发髻。",
  ];
  project.messages.push(
    { agentId: "character", type: "error", content: "旧结果：母亲服装采用紫色盔甲。" },
    { agentId: "writer", type: "text", content: "母亲发型改为银色长发。" },
  );
  const prompt = buildCharacterPlanningPrompt(project);
  assert.match(prompt, /母亲服装换成暗青色/);
  assert.match(prompt, /降低服装饱和度/);
  assert.match(prompt, /母亲发型改为低发髻/);
  assert.match(prompt, /属于待确认设计要求，不是人物来源，也不是新的原著事实/);
  assert.match(prompt, /已确认年龄及出场范围仍以上述批准资料为准/);
  assert.match(prompt, /与已锁定标准有冲突时列为待确认的新设计/);
  assert.doesNotMatch(prompt, /紫色盔甲|银色长发/);
  assert.ok(
    prompt.indexOf("母亲服装换成暗青色") < prompt.indexOf("母亲发型改为低发髻"),
  );
});

test("explicit user visual standards are included but compliance and failed model diagnostics are excluded", () => {
  const project = fixture();
  project.messages.push(
    {
      agentId: "user",
      type: "text",
      content: "画风：二维赛璐璐，清晰线稿，平涂色块。",
    },
    {
      agentId: "user",
      type: "text",
      content: "请把母亲的发型改为低发髻，服装采用暗青色。",
    },
    {
      agentId: "user",
      type: "text",
      content: "生图模型请求失败，错误详情：衣服颜色解析错误。",
    },
  );
  project.memory.decisions = [
    "用户对「合规校对」的返修要求：家人的恐怖画面只用逆光剪影与音效。",
    "用户反馈（交给总制片）：恐怖画面使用剪影和音效，口播控制在200字。",
    "母亲定妆采用金色盔甲（没有用户来源的旧摘要）。",
  ];
  const feedback = characterDesignFeedback(project);
  assert.match(feedback, /画风：二维赛璐璐/);
  assert.match(feedback, /清晰线稿/);
  assert.match(feedback, /平涂色块/);
  assert.match(feedback, /发型改为低发髻/);
  assert.match(feedback, /服装采用暗青色/);
  assert.doesNotMatch(feedback, /逆光|剪影|音效|200字|解析错误|金色盔甲/);
});

test("explicit role state feedback is segregated from base design feedback", () => {
  const project = fixture();
  project.memory.decisions = [
    "用户对「角色定妆」的返修要求：母亲服装保持暗青色，现形镜头仍然使用逆光剪影。",
  ];
  const feedback = characterDesignFeedback(project);
  assert.match(feedback, /基础外观待确认要求：母亲服装保持暗青色/);
  assert.match(feedback, /仅镜头状态要求：现形镜头仍然使用逆光剪影/);
  const prompt = buildCharacterPlanningPrompt(project);
  assert.match(prompt, /只能写入 characterDesign.sceneStates，不得写入 baseAppearance/);
});

test("specific face and hair corrections survive without broad style keywords", () => {
  const project = fixture();
  project.memory.decisions = [
    "用户对「角色定妆」的返修要求：母亲眼睛改成深棕色，刘海不要遮住眉毛，下巴再圆一点。",
  ];
  const feedback = characterDesignFeedback(project);
  assert.match(feedback, /眼睛改成深棕色/);
  assert.match(feedback, /刘海不要遮住眉毛/);
  assert.match(feedback, /下巴再圆一点/);
});

test("feedback is bounded, keeps recent revisions and deduplicates approval messages and memory", () => {
  const project = fixture();
  const latest = "母亲服装改为灰蓝色。";
  project.messages.push({
    agentId: "user",
    type: "text",
    content: `请返修「角色定妆」：${latest}`,
  });
  project.memory.decisions = [
    ...Array.from(
      { length: 10 },
      (_, index) =>
        `用户对「角色定妆」的返修要求：服装第${index}项设计要求：${"调整服装细节".repeat(95)}。`,
    ),
    `用户对「角色定妆」的返修要求：${latest}`,
  ];
  const feedback = characterDesignFeedback(project);
  assert.ok(feedback.length <= CHARACTER_DESIGN_FEEDBACK_BUDGET);
  assert.doesNotMatch(feedback, /服装第0项设计要求/);
  assert.ok(feedback.endsWith(latest));
  assert.equal(feedback.split(latest).length - 1, 1);
});

test("another workflow node's revision cannot leak into character design through its user message", () => {
  const project = fixture();
  project.messages.push({
    agentId: "user",
    type: "text",
    content: "请返修「剧本改编」：母亲的服装改成鲜红色，让剧情更恐怖。",
  });
  assert.equal(characterDesignFeedback(project), "");
});

test("returning to an earlier design follows the original messages rather than deduplicated decisions", () => {
  const project = fixture();
  for (const content of ["服装改成红色。", "服装改成蓝色。", "服装改成红色。"]) {
    addMessage(project, "user", content);
    remember(project, `用户反馈（交给角色设计）：${content}`);
  }
  assert.equal(project.memory.decisions.length, 2);
  const feedback = characterDesignFeedback(project);
  assert.ok(feedback.indexOf("蓝色") < feedback.indexOf("红色"));
  assert.ok(feedback.endsWith("服装改成红色。"));
  assert.equal(feedback.split("服装改成红色。").length - 1, 1);
  assert.ok(buildCharacterPlanningPrompt(project).includes(feedback));
});

test("latest approval notes keep their event order and role-specific scene classification", () => {
  const project = fixture();
  addMessage(project, "user", "服装改成蓝色。");
  remember(project, "用户反馈（交给角色设计）：服装改成蓝色。");
  remember(
    project,
    "用户对「角色定妆」的确认备注：服装改成红色，现形镜头使用逆光剪影。",
  );
  addMessage(
    project,
    "user",
    "已确认「角色定妆」。服装改成红色，现形镜头使用逆光剪影。",
  );
  const feedback = characterDesignFeedback(project);
  assert.ok(feedback.indexOf("蓝色") < feedback.indexOf("红色"));
  assert.match(feedback, /仅镜头状态要求：现形镜头使用逆光剪影/);
});
