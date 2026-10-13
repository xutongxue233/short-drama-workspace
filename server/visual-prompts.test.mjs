import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./seed.mjs";
import {
  buildCharacterImagePrompt,
  buildStoryboardImagePrompt,
  selectCharacterBaseReferences,
  VISUAL_PROMPT_BUDGETS,
  VISUAL_PROMPT_VERSION,
} from "./workflow/visual-prompts.mjs";

function fixture(content = "长生七岁，穿褪色蓝布衣，手里只有三张符纸。") {
  const project = createProject({ name: "借邪骨", style: "二次元动画" });
  project.productionBrief = {
    episodeCount: 1,
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
  };
  const script = {
    id: "current-script",
    name: "批准稿",
    type: "script",
    content,
    description: "批准的首集",
    locked: true,
    version: 2,
    tags: ["node:adaptation"],
  };
  project.assets = [script];
  Object.assign(
    project.nodes.find((node) => node.id === "adaptation"),
    {
      status: "completed",
      output: content,
    },
  );
  project.chapters = [{ title: "原文", content: "长生成年后持青囊尸经，与父亲见面。" }];
  const character = {
    name: "长生",
    description: "七岁男孩",
    content:
      "年龄：7岁儿童。黑短发，褪色蓝布衣，布鞋。只持三张符纸，不得携带青囊尸经。",
  };
  return { project, script, character };
}

test("short-limit character prompts preserve baseline identity and approved age without scene contamination", () => {
  const { project, character } = fixture();
  project.visualStyleGuide = "二维赛璐璐，清晰线稿、平涂色块。";
  character.characterDesign = {
    version: 1,
    subjectType: "person",
    baseAppearance: "七岁男孩，圆脸，黑短发，褪色蓝布衣，布鞋，不佩戴首饰。",
    sceneStates: [{ name: "逃离", description: "满脸血污，夜间逆光" }],
  };
  const prompt = buildCharacterImagePrompt(project, character, { compact: true });
  assert.ok(prompt.length < 1200);
  assert.ok(prompt.includes(character.characterDesign.baseAppearance));
  assert.match(prompt, /来源年龄：七岁/);
  assert.match(prompt, /二维赛璐璐/);
  assert.doesNotMatch(prompt, /满脸血污|夜间逆光/);
});

test("short-limit prompts never silently cut an overlong approved appearance", () => {
  const { project, character } = fixture();
  character.characterDesign = {
    version: 1,
    subjectType: "person",
    baseAppearance: "完整服装细节。".repeat(300) + "左脸有痣，不得移到右脸。",
    sceneStates: [],
  };
  const prompt = buildCharacterImagePrompt(project, character, { compact: true });
  assert.ok(prompt.includes(character.characterDesign.baseAppearance));
  assert.ok(prompt.length > 1500);
});

test("character prompt starts with the subject and retains age, clothing and permitted props", () => {
  const { project, character } = fixture();
  const before = JSON.stringify(project);
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /^生成一张「长生」的单一主体定妆图/);
  assert.match(prompt, /7岁儿童/);
  assert.match(prompt, /褪色蓝布衣/);
  assert.match(prompt, /只持三张符纸，不得携带青囊尸经/);
  assert.match(prompt, /二次元动画/);
  assert.match(prompt, /9:16/);
  assert.doesNotMatch(prompt, /成年后持青囊尸经/);
  assert.doesNotMatch(prompt, /当前任务|最近对话|仅输出 JSON|请确认/);
  assert.equal(JSON.stringify(project), before);
  assert.ok(prompt.length <= VISUAL_PROMPT_BUDGETS.character);
  assert.equal(VISUAL_PROMPT_VERSION, "visual-v4");
});

test("approved script facts at the end survive long source/chat and archived versions", () => {
  const { project, script, character } = fixture(
    `### 场1\n旧宅前的风声。\n${"与当前主体无关的环境解说。".repeat(3500)}\n### 场7\n长生此时七岁，只带三张符纸，禁止出现成年长生和青囊尸经。`,
  );
  project.assets.push({
    ...script,
    id: "old",
    content: "错误旧稿：长生二十岁穿盔甲。",
    tags: ["node:adaptation", "历史版本"],
  });
  project.memory.summary = "不相关的全量摘要".repeat(5000);
  project.messages.push({
    agentId: "writer",
    type: "result",
    content: "旧稿与编剧任务".repeat(5000),
  });
  project.chapters[0].content = "未来冒险".repeat(20000);
  character.content = `普通外观提案。${"装饰纹理的普通细节。".repeat(600)}\n年龄7岁儿童，不得画成成人，不能持有书本。`;
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /长生此时七岁，只带三张符纸/);
  assert.match(prompt, /不得画成成人，不能持有书本/);
  assert.doesNotMatch(prompt, /错误旧稿|盔甲|旧稿与编剧任务|未来冒险|全量摘要/);
  assert.ok(prompt.length <= VISUAL_PROMPT_BUDGETS.character);
});

test("known nicknames select the same subject's script evidence without renaming the character", () => {
  const { project, character } = fixture("阿宁八岁，在邮局拆开旧信封。");
  character.name = "林宁";
  character.description = "林宁，小名：阿宁。";
  character.content = "灰色外套和黑色短发。";
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /^生成一张「林宁」/);
  assert.match(prompt, /阿宁八岁/);
  assert.match(prompt, /小名：阿宁/);
});

test("verified kinship labels preserve script evidence after canonical name resolution", () => {
  const { project } = fixture("爷爷穿深褐旧袍，手持深色布袋。不得携带长剑。");
  const character = {
    id: "grandfather",
    name: "李半山",
    type: "character",
    locked: true,
    tags: [],
    content: "角色：李半山\n已核实称谓：爷爷\n灰白乱发，深褐旧袍。",
  };
  project.assets.push(character);
  const characterPrompt = buildCharacterImagePrompt(project, character);
  assert.match(characterPrompt, /爷爷穿深褐旧袍/);
  const storyboard = buildStoryboardImagePrompt(project);
  assert.match(storyboard, /「李半山」/);
  assert.match(storyboard, /灰白乱发/);
});

test("only matching active references from this project are named, never another character's face", () => {
  const { project, character } = fixture();
  const own = {
    id: "hero",
    name: "长生",
    type: "character",
    content: "蓝布衣",
    locked: true,
    tags: [],
    url: "data:image/png;base64,SECRET_BODY",
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance: "蓝布衣",
      sceneStates: [],
    },
  };
  const other = { ...own, id: "father", name: "父亲", content: "红胡须和铁甲" };
  const foreign = {
    ...own,
    id: "alien-project-hero",
    name: "另一个项目外星领袖",
    content: "紫色触角",
  };
  project.assets.push(own, other);
  const prompt = buildCharacterImagePrompt(project, character, {
    references: [own, other, foreign],
  });
  assert.match(prompt, /随请求附带的同名基础参考：长生/);
  assert.doesNotMatch(prompt, /红胡须|铁甲|外星领袖|紫色触角|SECRET_BODY|data:image/);
});

test("recent visual feedback is included while unrelated agent chatter and other subject feedback are not", () => {
  const { project, character } = fixture();
  project.assets.push({
    id: "dad",
    name: "父亲",
    type: "character",
    locked: true,
    tags: [],
    content: "中年男子",
  });
  project.memory.decisions = [
    "用户对「角色定妆」的返修要求：长生衣服改为灰蓝，背景用素色。",
    "父亲发型改为银白长发。",
  ];
  project.messages.push({
    agentId: "writer",
    type: "text",
    content: "应改成都市西服海报。",
  });
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /长生衣服改为灰蓝，背景用素色/);
  assert.doesNotMatch(prompt, /银白长发|都市西服/);
});

test("mixed feedback retains visual sentences and excludes writing and approval instructions", () => {
  const { project, character } = fixture();
  project.memory.decisions = [
    "用户对「剧本改编」的返修要求：口播控制在129字，给出时长核算。恐怖画面仅用剪影和音效呈现。不要新增必答问题。直接交付修订剧本及改动说明。长生衣服改为灰蓝，背景用素色。",
    "用户对「角色定妆」的返修要求：不要新增必答问题。请先给出改动说明。",
  ];
  project.messages.push({
    agentId: "user",
    type: "text",
    content: "@角色设计 不要新增必答问题。长生发型保留黑色短发。",
  });
  const characterPrompt = buildCharacterImagePrompt(project, character);
  const storyboardPrompt = buildStoryboardImagePrompt(project);
  assert.doesNotMatch(characterPrompt, /恐怖画面仅用剪影和音效呈现/);
  assert.match(storyboardPrompt, /恐怖画面仅用剪影和音效呈现/);
  for (const prompt of [characterPrompt, storyboardPrompt]) {
    assert.match(prompt, /长生衣服改为灰蓝，背景用素色/);
    assert.match(prompt, /长生发型保留黑色短发/);
    assert.doesNotMatch(prompt, /129字|时长核算|必答问题|交付修订剧本|改动说明/);
  }
});

test("statue subjects remain inanimate and multi-state cards do not turn into crowded collages", () => {
  const { project } = fixture("神像在供桌上，面部与长生相似。");
  const prompt = buildCharacterImagePrompt(project, {
    name: "神像",
    description: "泥塑神像",
    content: "旧泥塑、青灰色彩绘。三视图、夜间状态、破损状态。",
  });
  assert.match(prompt, /^生成一张「神像」的单一主体定妆图/);
  assert.match(prompt, /非人物主体保持设定中的形制、材质和静物状态，不要拟人化为真人/);
  assert.match(prompt, /一种基础造型/);
  assert.doesNotMatch(prompt, /自然站姿/);
});

test("structured baseline design excludes script, scene variants and dramatic feedback", () => {
  const { project, character } = fixture(
    "长生七岁，举符贴向母亲；母亲现形，门框背后是逆光剪影。",
  );
  project.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块";
  project.memory.facts = ["长生在追逐中跌倒，手上沾染血污。"];
  project.memory.decisions = ["恐怖画面只用剪影和音效呈现。"];
  character.content =
    "角色：长生\n角色来源：原著角色\n身份与关系：李半山的孙子\n只呈现本轮出场状态，门口举符，惊恐逃离。";
  character.characterDesign = {
    version: 1,
    subjectType: "person",
    baseAppearance:
      "7岁男孩，圆脸，短而整齐的黑发，灰蓝色棉布上衣，深灰长裤，黑布鞋，儿童身形。",
    sceneStates: [
      { name: "现形反应", description: "站在门框里，恐惧表情，月光逆光剪影。" },
    ],
  };
  const before = JSON.stringify({ project, character });
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /基础角色设计标准/);
  assert.match(prompt, /正面全身，自然站姿，双臂略微分开、双手可辨/);
  assert.match(prompt, /完整展示头顶到双脚/);
  assert.match(prompt, /浅灰纯色背景，均匀工作室光/);
  assert.match(prompt, /中性表情/);
  assert.match(prompt, /线宽稳定的线稿，平涂色块/);
  assert.match(prompt, /灰蓝色棉布上衣/);
  assert.match(prompt, /李半山的孙子/);
  assert.match(prompt, /年龄事实：七岁/);
  assert.doesNotMatch(
    prompt,
    /举符贴向母亲|门框背后|手上沾染血污|恐怖画面只用|只呈现本轮出场状态|惊恐逃离|现形反应|月光逆光剪影/,
  );
  assert.equal(JSON.stringify({ project, character }), before);
  assert.ok(prompt.length <= VISUAL_PROMPT_BUDGETS.character);
});

test("legacy baseline strips dramatic presentation while preserving age and costume", () => {
  const { project, character } = fixture("长生7岁，穿灰蓝棉布衣，在门口举符。");
  character.content =
    "7岁儿童，黑色短发，穿灰蓝棉布衣。只呈现本轮出场状态，半脸遮挡，惊恐表情，逆光剪影。";
  project.memory.decisions = ["长生衣服保留灰蓝，恐怖镜头不能直视面部。"];
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /7岁儿童/);
  assert.match(prompt, /黑色短发/);
  assert.match(prompt, /穿灰蓝棉布衣/);
  assert.match(prompt, /长生衣服保留灰蓝/);
  assert.match(prompt, /中性表情/);
  assert.doesNotMatch(
    prompt,
    /只呈现本轮出场状态|半脸遮挡|惊恐表情|不能直视面部|在门口举符/,
  );
});

test("structured source age belongs to the subject, not older relatives in the same scene", () => {
  const { project, character } = fixture("爷爷七十岁和长生七岁都站在门前。");
  character.characterDesign = {
    version: 1,
    subjectType: "person",
    baseAppearance: "7岁男孩，黑短发，灰蓝布衣。",
    sceneStates: [],
  };
  const prompt = buildCharacterImagePrompt(project, character);
  assert.match(prompt, /年龄事实：七岁/);
  assert.doesNotMatch(prompt, /七十岁/);
});

test("baseline reference selection rejects legacy portraits, stale assets and other identities", () => {
  const { project, character } = fixture();
  const base = {
    id: "hero-baseline",
    name: character.name,
    type: "character",
    locked: true,
    tags: [],
    content: "基础卡片",
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance: "7岁男孩，短黑发，蓝布衣。",
      sceneStates: [{ name: "追逐", description: "夜间惊恐状态" }],
    },
  };
  const legacy = { ...base, id: "old-image", characterDesign: undefined };
  const stale = { ...base, id: "stale-image", tags: ["待更新"] };
  const other = { ...base, id: "father-image", name: "父亲" };
  const unapproved = { ...base, id: "draft-image", locked: false };
  const foreign = { ...base, id: "foreign-image" };
  project.assets.push(base, legacy, stale, other, unapproved);
  const references = [legacy, other, foreign, stale, unapproved, base];
  assert.deepEqual(selectCharacterBaseReferences(project, character, references), [
    base,
  ]);
  const prompt = buildCharacterImagePrompt(project, character, { references });
  assert.match(prompt, /有效锁定基础标准：[\s\S]*7岁男孩，短黑发，蓝布衣/);
  assert.doesNotMatch(prompt, /夜间惊恐状态/);
});

test("structured object baseline receives neutral material study rather than human pose", () => {
  const { project } = fixture("神像静置供桌，夜间似乎看向长生。");
  project.visualStyleGuide = "二维赛璐璐：清晰线稿、平涂色块";
  const prompt = buildCharacterImagePrompt(project, {
    name: "神像",
    description: "宗祠泥塑像",
    content: "夜间睁眼，身后是恐怖逆光。",
    characterDesign: {
      version: 1,
      subjectType: "object",
      baseAppearance: "小型坐姿泥塑，灰白表面，暗红衣纹，木制方底座。",
      sceneStates: [{ name: "夜间", description: "夜间睁眼，瞳孔全黑" }],
    },
  });
  assert.match(prompt, /完整展示物体，结构与材质清楚/);
  assert.match(prompt, /木制方底座/);
  assert.doesNotMatch(prompt, /自然站姿|双臂略微分开|视线平视|夜间睁眼|瞳孔全黑/);
});

test("storyboard uses the approved first episode, preserves ending and excludes later episodes", () => {
  const { project } = fixture(
    `## 第一集完整剧本\n### 场1\n长生在门口接过符纸。\n${"夜色里的空镜。".repeat(1000)}\n### 场7\n长生逃离屋子，发现老道士脖颈的暗斑。\n## 第二集完整剧本\n成年长生进入宇宙飞船。`,
  );
  project.assets.push({
    id: "hero",
    name: "长生",
    type: "character",
    locked: true,
    tags: [],
    content: "七岁男孩，蓝布衣。不得持有书本。",
  });
  const prompt = buildStoryboardImagePrompt(project);
  assert.match(prompt, /^生成当前短剧本集的分镜画面板/);
  assert.match(prompt, /门口接过符纸/);
  assert.match(prompt, /发现老道士脖颈的暗斑/);
  assert.match(prompt, /七岁男孩，蓝布衣/);
  assert.doesNotMatch(prompt, /宇宙飞船|当前任务|剧本改编提案：/);
  assert.ok(prompt.length <= VISUAL_PROMPT_BUDGETS.storyboard);
});

test("storyboard refuses unapproved or stale scripts instead of inventing a generic genre poster", () => {
  for (const invalid of ["unlocked", "历史版本", "待更新"]) {
    const { project, script } = fixture();
    if (invalid === "unlocked") script.locked = false;
    else script.tags.push(invalid);
    assert.throws(() => buildStoryboardImagePrompt(project), /当前已批准剧本/);
  }
});

test("storyboard recognizes a current-episode script heading without treating other sections as scenes", () => {
  const { project } = fixture(
    "## 本集范围\n提供的两段原文。\n## 本集完整剧本\n### 场1\n长生站在门口听铃声。\n## 原文与改编对照\nOUTSIDE_SCRIPT_ONLY",
  );
  const prompt = buildStoryboardImagePrompt(project);
  assert.match(prompt, /长生站在门口听铃声/);
  assert.doesNotMatch(prompt, /OUTSIDE_SCRIPT_ONLY/);
});

test("essential restrictions are never silently truncated to satisfy the budget", () => {
  const { project, character } = fixture();
  character.content = Array.from(
    { length: 100 },
    (_, index) => `禁止添加第${index}种无依据的剧情物件和装饰。`,
  ).join("\n");
  assert.throws(() => buildCharacterImagePrompt(project, character), /明确约束过长/);
});

test("six detailed locked character cards remain bounded storyboard summaries", () => {
  const names = ["林宁", "阿元", "张叔", "母亲", "父亲", "邮差"];
  const { project } = fixture(names.map((name) => `${name}依次走入邮局。`).join("\n"));
  for (const name of names)
    project.assets.push({
      id: name,
      name,
      type: "character",
      locked: true,
      tags: [],
      content: `${name}，蓝色外套。\n${Array.from({ length: 15 }, (_, index) => `不得添加第${index}类与本集无关的物品或装饰，保持本角色独立身份。`).join("\n")}`,
    });
  const prompt = buildStoryboardImagePrompt(project);
  for (const name of names) assert.ok(prompt.includes(`「${name}」`));
  assert.ok(prompt.length <= VISUAL_PROMPT_BUDGETS.storyboard);
});
