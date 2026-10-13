import test from "node:test";
import assert from "node:assert/strict";
import { createEpisode, createProject, createSeedState } from "./seed.mjs";
import { migrateProjectEpisodes } from "./episode-migration.mjs";
import { beginNextEpisode } from "./services/episodes.mjs";
import { buildContext, remember } from "./workflow/memory.mjs";
import { episodeDecisions, episodeMessages } from "./workflow/episode-scope.mjs";
import { characterCheckpointKey } from "./workflow/character-checkpoint.mjs";
import { createStore } from "./store.mjs";
import { resolveCharacterIdentity } from "./workflow/character-identity.mjs";
import { buildCharacterPlanningPrompt } from "./workflow/character-planning.mjs";
import { buildCharacterImagePrompt } from "./workflow/visual-prompts.mjs";

function completedProject() {
  const project = createProject({ name: "持续创作的短剧", style: "二次元动画" });
  project.nodes.forEach((node) => {
    node.status = "completed";
    node.output = `第1集${node.name}已确认产物`;
  });
  project.chapters.push({
    id: "first-source",
    title: "第一段",
    content: "本集独有的完整原文",
    createdAt: "2026-10-13T00:00:00Z",
  });
  project.productionBrief = {
    episodeCount: 1,
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
  };
  project.memory.facts = ["主角名为林晚"];
  project.memory.decisions = ["人工确认：原著拆解。", "本集只改编旧邮局来信"];
  project.assets.push(
    {
      id: "shared-person",
      name: "林晚",
      type: "character",
      content: "蓝色风衣",
      description: "主角",
      version: 2,
      locked: true,
      tags: ["node:characters"],
      url: "/api/media/person.png",
      materialId: "person-image",
    },
    {
      id: "shared-scene",
      name: "旧邮局",
      type: "scene",
      content: "绿色窗框",
      description: "场景标准",
      version: 1,
      locked: true,
      tags: [],
      url: "/api/media/scene.png",
      materialId: "scene-image",
    },
    {
      id: "first-script",
      name: "本集剧本",
      type: "script",
      content: project.nodes[1].output,
      version: 1,
      locked: true,
      tags: ["node:adaptation"],
    },
    {
      id: "unused-draft",
      name: "待选人物",
      type: "character",
      content: "未采用",
      version: 1,
      locked: false,
      tags: [],
    },
  );
  project.materials = [
    { id: "person-image", url: "/api/media/person.png", status: "local" },
    { id: "scene-image", url: "/api/media/scene.png", status: "local" },
    { id: "first-video", url: "/api/media/first.mp4", status: "local" },
  ];
  return project;
}

test("episode migration is idempotent and does not invalidate the live approval or character checkpoint", () => {
  const project = completedProject();
  delete project.currentEpisode;
  delete project.episodeArchive;
  project.approval = { id: "existing-approval", nodeId: "characters" };
  project.nodes[3].characterGeneration = {
    id: "generation-existing",
    key: "existing-key",
    stage: "batch",
    plan: [],
  };
  const before = structuredClone(project);
  const state = createSeedState();
  const key = () =>
    characterCheckpointKey(
      project,
      state.agents[3],
      state.providers[1],
      state.agents[1],
      state.providers[0],
      "原任务",
    );
  const beforeKey = key();
  assert.equal(migrateProjectEpisodes({ projects: [project] }), true);
  for (const [field, value] of Object.entries(before))
    assert.deepEqual(project[field], value);
  assert.equal(key(), beforeKey);
  assert.equal(project.currentEpisode.number, 1);
  assert.equal(project.currentEpisode.createdAt, project.createdAt);
  assert.deepEqual(project.episodeArchive, []);
  const migrated = structuredClone(project);
  assert.equal(migrateProjectEpisodes({ projects: [project] }), false);
  assert.deepEqual(project, migrated);
});

test("store migrates a legacy project without mutating its live production data", () => {
  const project = completedProject();
  delete project.currentEpisode;
  delete project.episodeArchive;
  const store = createStore({
    filename: ":memory:",
    seed: () => ({ ...createSeedState(), projects: [project] }),
  });
  try {
    assert.equal(store.getState().projects[0].currentEpisode.number, 1);
    assert.equal(
      store.getState().projects[0].nodes[1].output,
      "第1集剧本改编已确认产物",
    );
  } finally {
    store.close();
  }
});

test("archive is a detached snapshot and the new episode isolates source, decisions and artifacts while retaining standards", () => {
  const project = completedProject();
  const old = structuredClone(project);
  beginNextEpisode(project, { title: "失踪的寄信人" });
  assert.equal(project.currentEpisode.number, 2);
  assert.equal(project.currentEpisode.title, "失踪的寄信人");
  assert.notEqual(project.currentEpisode.id, old.currentEpisode.id);
  assert.deepEqual(project.chapters, []);
  assert.equal(project.productionBrief, undefined);
  assert.equal(project.approval, null);
  assert.ok(
    project.nodes.every((node) => node.status === "pending" && node.output === ""),
  );
  assert.deepEqual(project.members, old.members);
  assert.deepEqual(project.materials, old.materials);
  assert.deepEqual(project.assets[0], old.assets[0]);
  assert.deepEqual(project.assets[1], old.assets[1]);
  assert.ok(project.assets[2].tags.includes("历史版本"));
  assert.ok(project.assets[3].tags.includes("历史版本"));
  assert.deepEqual(project.memory.facts, old.memory.facts);
  assert.deepEqual(project.memory.decisions, old.memory.decisions);
  const archive = project.episodeArchive[0];
  for (const field of [
    "nodes",
    "chapters",
    "productionBrief",
    "assets",
    "materials",
    "messages",
    "memory",
  ])
    assert.deepEqual(archive[field], old[field]);
  assert.ok(archive.archivedAt);
  assert.deepEqual(
    episodeMessages(project),
    project.messages.slice(old.messages.length),
  );
  assert.equal(episodeMessages(project).length, 1);
  assert.deepEqual(episodeDecisions(project), []);
  const context = buildContext(project);
  assert.ok(context.references.some((asset) => asset.id === "shared-person"));
  assert.ok(context.references.some((asset) => asset.id === "shared-scene"));
  assert.ok(!context.references.some((asset) => asset.id === "first-script"));
  assert.doesNotMatch(context.prompt, /当前已批准剧本（/);
  assert.doesNotMatch(context.prompt, /本集独有的完整原文/);
  assert.match(context.prompt, /历集连续性摘要（仅为历史背景/);
  project.assets[0].content = "下一集修改的风衣";
  project.materials[0].status = "failed";
  project.nodes[0].output = "下一集拆解";
  assert.equal(archive.assets[0].content, "蓝色风衣");
  assert.equal(archive.materials[0].status, "local");
  assert.equal(archive.nodes[0].output, "第1集原著拆解已确认产物");
});

test("incomplete, awaiting approval, running and pending-chat episodes cannot be archived", () => {
  for (const change of [
    (project) => {
      project.nodes[2].status = "failed";
    },
    (project) => {
      project.nodes.pop();
    },
    (project) => {
      project.approval = { id: "pending" };
    },
    (project) => {
      project.running = true;
    },
    (project) => {
      project.chatPending = { agentId: "writer" };
    },
  ]) {
    const project = completedProject();
    change(project);
    const before = structuredClone(project);
    assert.throws(
      () => beginNextEpisode(project),
      (error) => error.status === 409,
    );
    assert.deepEqual(project, before);
  }
  assert.throws(
    () => beginNextEpisode(completedProject(), { chatPending: true }),
    (error) => error.status === 409,
  );
});

test("repeated approvals belong to the new episode even after the bounded decision history rolls over", () => {
  const project = completedProject();
  project.memory.decisions = Array.from({ length: 60 }, (_, i) => `旧决策${i}`);
  project.currentEpisode = {
    ...createEpisode(2),
    startDecisions: [...project.memory.decisions],
  };
  remember(project, "旧决策59");
  assert.equal(project.memory.decisions.length, 60);
  assert.deepEqual(episodeDecisions(project), ["旧决策59"]);
  remember(project, "旧决策59");
  assert.deepEqual(episodeDecisions(project), ["旧决策59"]);
  remember(project, "本集新反馈");
  assert.deepEqual(episodeDecisions(project), ["旧决策59", "本集新反馈"]);
});

test("a later fragment can reuse a locked character alias but an archived script cannot authorize an unregistered role", () => {
  const project = completedProject();
  project.assets[0].content += "\n已核实称谓：邮差";
  project.assets[2].content += "\n临时客服来到邮局。";
  beginNextEpisode(project);
  project.chapters = [{ title: "部分新原文", content: "邮差伸手拿起信封。" }];
  const identity = resolveCharacterIdentity("邮差", project);
  assert.equal(identity.name, "林晚");
  assert.equal(identity.source, "locked");
  assert.ok(identity.aliases.includes("邮差"));
  assert.throws(() => resolveCharacterIdentity("临时客服", project), /尚未出现在/);
  project.assets.push({
    id: "second-approved-script",
    name: "本集剧本",
    type: "script",
    locked: true,
    tags: ["node:adaptation"],
    version: 1,
    content: "邮差与本集配角来到邮局。",
  });
  project.nodes[1].output = "邮差与本集配角来到邮局。";
  assert.equal(resolveCharacterIdentity("本集配角", project).source, "adaptation");
  assert.throws(() => resolveCharacterIdentity("临时客服", project), /尚未出现在/);
});

test("cast and image prompts isolate episode feedback while retaining approved shared design standards", () => {
  const project = completedProject();
  const oldFeedback = "请将林晚服装改为荧光玫红斗篷。";
  project.messages.push({ agentId: "user", type: "text", content: oldFeedback });
  project.memory.decisions.push(`用户对「角色定妆」的确认备注：${oldFeedback}`);
  beginNextEpisode(project);
  project.chapters = [{ title: "本集", content: "林晚走进旧邮局。" }];
  const newFeedback = "请将林晚服装改为浅蓝长袖上衣。";
  project.messages.push({ agentId: "user", type: "text", content: newFeedback });
  remember(project, `用户对「角色定妆」的返修要求：${newFeedback}`);
  for (const prompt of [
    buildCharacterPlanningPrompt(project),
    buildCharacterImagePrompt(project, project.assets[0]),
  ]) {
    assert.doesNotMatch(prompt, /荧光玫红斗篷/);
    assert.match(prompt, /浅蓝长袖上衣/);
    assert.match(prompt, /蓝色风衣/);
    assert.doesNotMatch(prompt, /第1集剧本改编已确认产物/);
  }
});
