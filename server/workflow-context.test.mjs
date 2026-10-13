import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./seed.mjs";
import { buildContext } from "./workflow/memory.mjs";

function fixture(content) {
  const project = createProject({
    name: "已批准剧本交接",
    style: "二次元动画",
  });
  project.productionBrief = {
    episodeCount: 1,
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
  };
  project.chapters = [
    { id: "one", title: "第一章", content: "原著事实：长生七岁，门外来了老道士。" },
  ];
  project.memory.decisions = [
    "用户确认：剪影与音效呈现，不直接展示血腥，争议胎数不写入台词。",
  ];
  const script = {
    id: "approved-script",
    name: "短剧改编提案",
    type: "script",
    description: "用户批准的首集修订稿",
    content,
    locked: true,
    version: 2,
    tags: ["node:adaptation"],
    createdAt: "",
  };
  project.assets = [script];
  Object.assign(
    project.nodes.find((node) => node.id === "adaptation"),
    { status: "completed", output: content },
  );
  project.messages.push({
    id: "script-message",
    agentId: "writer",
    type: "result",
    nodeId: "adaptation",
    content,
    createdAt: "",
  });
  return { project, script };
}

test("downstream context includes the approved script ending and timing table exactly once", () => {
  const content = `## 已批准首集唯一开头\n${"前六场镜头与对白。".repeat(400)}\n### 场7｜1:22–1:30\n脖颈处的尸斑揭示救人者的疑点。\n## 时长与口播预算核对\n全片90秒，口播194字，留白33秒。`;
  const { project, script } = fixture(content);
  project.assets.push({
    ...script,
    id: "old-script",
    content: "过时草稿人物年龄十六岁",
    locked: true,
    version: 1,
    tags: ["node:adaptation", "历史版本"],
  });
  project.messages.unshift(
    {
      agentId: "producer",
      type: "text",
      content: "未确认的早期聊天提案".repeat(200),
    },
    ...Array.from({ length: 10 }, () => ({
      agentId: "system",
      type: "system",
      content: "流程交接",
    })),
  );
  const before = JSON.stringify(project);
  const context = buildContext(project);
  assert.ok(context.prompt.includes(content));
  assert.equal(context.prompt.split("已批准首集唯一开头").length - 1, 1);
  assert.match(context.prompt, /场7｜1:22–1:30/);
  assert.match(context.prompt, /时长与口播预算核对/);
  assert.match(context.prompt, /长生七岁/);
  assert.match(context.prompt, /不直接展示血腥/);
  assert.match(context.prompt, /用户已确认.*本集 90 秒 · 9:16 · 抖音/);
  assert.doesNotMatch(context.prompt, /过时草稿人物年龄|未确认的早期聊天提案/);
  const reference = context.references.find((item) => item.id === script.id);
  assert.equal(reference.version, 2);
  assert.match(reference.content, /当前已批准剧本/);
  assert.ok(!JSON.stringify(context.references).includes("已批准首集唯一开头"));
  const lines = context.prompt.split("\n");
  const assetHeading = lines.findIndex((line) => line.startsWith("锁定资产（"));
  const assetList = JSON.parse(lines[assetHeading + 1]);
  assert.equal(assetList.length, 1);
  assert.deepEqual(
    {
      id: assetList[0].id,
      name: assetList[0].name,
      type: assetList[0].type,
      version: assetList[0].version,
      locked: assetList[0].locked,
    },
    { id: script.id, name: script.name, type: "script", version: 2, locked: true },
  );
  assert.match(assetList[0].content, /当前已批准剧本/);
  assert.ok(!assetList[0].content.includes("已批准首集唯一开头"));
  assert.equal(JSON.stringify(project), before);
});

test("oversized approved scripts keep beginning and ending with explicit truncation while protecting source and character references", () => {
  const { project } = fixture(`SCRIPT_HEAD\n${"分场对白。".repeat(15000)}\nSCRIPT_END`);
  project.assets.push({
    id: "hero",
    name: "长生",
    type: "character",
    description: "七岁男孩",
    content: "锁定蓝色布衣、黑发和年龄七岁的角色标准",
    version: 3,
    locked: true,
    tags: ["node:characters"],
    url: "https://example.test/hero.png",
  });
  const context = buildContext(project);
  assert.match(context.prompt, /SCRIPT_HEAD/);
  assert.match(context.prompt, /SCRIPT_END/);
  assert.match(context.prompt, /已批准剧本超过上下文预算，中间内容已省略/);
  assert.match(context.prompt, /原著事实：长生七岁/);
  assert.match(context.prompt, /争议胎数不写入台词/);
  assert.equal(
    context.references.find((asset) => asset.id === "hero").content,
    "锁定蓝色布衣、黑发和年龄七岁的角色标准",
  );
  assert.ok(context.prompt.length < 22000);
});

test("unapproved or invalidated script versions never become the current approved standard", () => {
  for (const state of ["unlocked", "stale", "archived"]) {
    const { project, script } = fixture("未批准的剧本修改");
    if (state === "unlocked") script.locked = false;
    if (state === "stale") script.tags.push("待更新");
    if (state === "archived") script.tags.push("历史版本");
    const context = buildContext(project);
    assert.doesNotMatch(context.prompt, /当前已批准剧本（短剧改编提案/);
    assert.ok(!context.references.some((asset) => asset.id === script.id));
  }
});

test("the approved script reallocates the existing artifact budget instead of expanding long-project context", () => {
  const { project } = fixture(
    `APPROVED_FULL_START\n${"本轮确认对白。".repeat(2300)}\nAPPROVED_FULL_END`,
  );
  for (let index = 0; index < 35; index++)
    project.assets.push({
      id: `character-${index}`,
      name: `锁定角色${index}`,
      type: "character",
      description: "原文角色",
      content: "标准".repeat(2500),
      locked: true,
      version: 1,
      tags: ["node:characters"],
    });
  for (const node of project.nodes)
    if (node.id !== "adaptation") {
      node.status = "completed";
      node.output = "上游信息".repeat(4000);
    }
  const context = buildContext(project);
  assert.match(context.prompt, /APPROVED_FULL_START/);
  assert.match(context.prompt, /APPROVED_FULL_END/);
  assert.equal(context.references[0].id, "approved-script");
  assert.equal(context.references.length, 30);
  assert.ok(context.references.slice(1).every((asset) => asset.type === "character"));
  assert.ok(context.prompt.length < 30000);
});
