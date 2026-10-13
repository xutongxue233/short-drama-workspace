import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createProject, createSeedState } from "./seed.mjs";
import { createStore } from "./store.mjs";
import { migrateProjectScope, PROJECT_MIGRATION } from "./project-migration.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function legacyProject(mode = "live") {
  const project = createProject({ name: "已有的短剧" });
  Object.assign(project, { mode, episodes: 24 });
  project.chapters = [{ id: "ch1", title: "本集片段", content: "已有原文" }];
  project.productionBrief = {
    episodeCount: 1,
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
  };
  project.nodes[0].status = "completed";
  project.nodes[0].output = "已确认的真实模型拆解";
  project.nodes[3].characterGeneration = { id: "checkpoint-keep", key: "keep-key" };
  project.assets = [
    {
      id: "character-real",
      name: "长生",
      type: "character",
      version: 2,
      locked: true,
      content: "已确认的角色标准",
      tags: ["真实接口", "node:characters"],
      url: "/api/media/saved.png",
      materialId: "saved-image",
    },
  ];
  project.materials = [
    { id: "saved-image", status: "local", url: "/api/media/saved.png" },
  ];
  project.approval = { id: "approval-keep", nodeId: "characters", kind: "character" };
  return project;
}

test("new workspaces and projects have no demo projects, mode or total episode count", () => {
  const state = createSeedState();
  assert.deepEqual(state.projects, []);
  const project = createProject({ name: "本集创作", episodes: 99, mode: "demo" });
  assert.equal(Object.hasOwn(project, "episodes"), false);
  assert.equal(Object.hasOwn(project, "mode"), false);
  assert.match(project.messages[0].content, /每轮创作一集/);
});

test("real single-episode migration preserves approvals, character checkpoints and local media", () => {
  const project = legacyProject();
  const before = structuredClone(project);
  const state = { projects: [project] };
  assert.equal(migrateProjectScope(state), true);
  assert.equal(Object.hasOwn(project, "mode"), false);
  assert.equal(Object.hasOwn(project, "episodes"), false);
  for (const field of [
    "assets",
    "materials",
    "nodes",
    "approval",
    "productionBrief",
    "chapters",
  ])
    assert.deepEqual(project[field], before[field]);
  assert.deepEqual(project.memory.decisions, before.memory.decisions);
  const migrated = structuredClone(state);
  assert.equal(migrateProjectScope(state), false);
  assert.deepEqual(state, migrated);
});

test("legacy template work restarts without deleting source, historical assets or downloaded media", () => {
  const project = legacyProject("demo");
  project.assets.push({
    id: "template-asset",
    name: "旧模板",
    type: "script",
    content: "模板正文",
    tags: ["演示提案"],
    locked: true,
    version: 1,
  });
  const originalMessages = structuredClone(project.messages);
  assert.equal(migrateProjectScope({ projects: [project] }), true);
  assert.ok(project.nodes.every((node) => node.status === "pending"));
  assert.equal(project.approval, null);
  assert.equal(project.productionBrief, undefined);
  assert.equal(project.chapters[0].content, "已有原文");
  assert.deepEqual(
    project.messages.slice(0, originalMessages.length),
    originalMessages,
  );
  assert.equal(project.assets[0].locked, true);
  assert.equal(project.assets[0].url, "/api/media/saved.png");
  assert.equal(project.materials.length, 1);
  assert.ok(project.assets[1].tags.includes("历史版本"));
  assert.equal(project.assets[1].locked, false);
  const count = project.messages.length;
  assert.equal(migrateProjectScope({ projects: [project] }), false);
  assert.equal(project.messages.length, count);
});

test("multi-episode briefs need a new approval rather than silently treating the old script as one episode", () => {
  const project = legacyProject();
  project.productionBrief.episodeCount = 3;
  project.assets.push({
    id: "multi-script",
    type: "script",
    locked: true,
    version: 1,
    content: "三集剧本",
    tags: ["真实接口", "node:adaptation"],
  });
  migrateProjectScope({ projects: [project] });
  assert.equal(project.productionBrief, undefined);
  assert.equal(project.approval, null);
  assert.equal(project.nodes[0].status, "pending");
  assert.equal(project.assets[0].locked, true);
  assert.ok(project.assets[1].tags.includes("待更新"));
  assert.equal(project.assets[1].content, "三集剧本");
});

test("legacy analysis approval keeps its identity while removing the editable episode count", () => {
  const project = legacyProject();
  project.approval = {
    id: "old-approval",
    kind: "style",
    nodeId: "analysis",
    fields: [
      { id: "episodeCount", value: "1" },
      { id: "durationSeconds", value: "90" },
    ],
  };
  migrateProjectScope({ projects: [project] });
  assert.equal(project.approval.id, "old-approval");
  assert.deepEqual(
    project.approval.fields.map((field) => field.id),
    ["durationSeconds"],
  );
});

test("SQLite keeps the original migration snapshot once and persists the upgraded checkpoint", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-scope-migration-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "state.sqlite");
  const project = legacyProject();
  const store = createStore({
    filename,
    seed: () => ({ ...createSeedState(), projects: [project] }),
  });
  const id = store.getState().projects[0].id;
  assert.equal(store.getState().projects[0].mode, undefined);
  store.close();
  const database = new DatabaseSync(filename);
  const backup = database
    .prepare("SELECT value FROM migration_backups WHERE id = ?")
    .get(PROJECT_MIGRATION);
  assert.equal(JSON.parse(backup.value).projects[0].mode, "live");
  database.close();
  const reopened = createStore({ filename });
  assert.equal(reopened.getState().projects[0].id, id);
  assert.equal(reopened.getState().projects[0].approval.id, "approval-keep");
  reopened.close();
  const after = new DatabaseSync(filename);
  assert.equal(after.prepare("SELECT count(*) AS n FROM migration_backups").get().n, 1);
  assert.equal(
    after
      .prepare("SELECT value FROM migration_backups WHERE id = ?")
      .get(PROJECT_MIGRATION).value,
    backup.value,
  );
  after.close();
});
