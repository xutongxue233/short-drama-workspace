import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { readConfig } from "./config.mjs";
import { beginProjectTask } from "./services/project-tasks.mjs";

const timestamp = "2026-10-13T00:00:00.000Z";
const message = (index) => ({
  id: `message-${index}`,
  agentId: "producer",
  type: "text",
  content: `消息 ${index}`,
  createdAt: timestamp,
});
const material = (id, projectId, changes = {}) => ({
  id,
  projectId,
  name: id,
  type: "image",
  status: "remote",
  createdAt: timestamp,
  sourceUrl: "https://example.test/image.png",
  url: "https://example.test/image.png",
  ...changes,
});
const asset = (id, changes = {}) => ({
  id,
  name: id,
  type: "character",
  description: "角色资产",
  content: "",
  tags: [],
  version: 1,
  locked: false,
  createdAt: timestamp,
  ...changes,
});

async function fixture(t, { synthetic = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "frameflow-read-api-"));
  const state = { ...createSeedState(), projects: [] };
  const store = synthetic
    ? { getState: () => state, save() {}, close() {} }
    : createStore({ filename: ":memory:", seed: () => state });
  const primary = createProject({ name: "主项目" });
  const other = createProject({ name: "其他项目" });
  primary.id = "primary";
  other.id = "other";
  primary.messages = Array.from({ length: 120 }, (_, index) => message(index));
  primary.currentEpisode.startMessageIndex = 3;
  primary.currentEpisode.number = 2;
  primary.episodeArchive = [
    { id: "first-episode", messages: primary.messages.slice(0, 3) },
  ];
  primary.materials = [
    material("image-a", primary.id, {
      status: "local",
      model: "Canvas-V2",
      nodeId: "characters",
    }),
    material("image-b", primary.id, {
      name: "山间 Portrait",
      prompt: "portrait on cliff",
    }),
    material("video-z", primary.id, {
      type: "video",
      prompt: "海边",
      createdAt: "2026-10-14T00:00:00.000Z",
    }),
    material("image-percent", primary.id, { name: "100%_literal" }),
  ];
  primary.assets = [
    asset("character-a"),
    asset("scene-b", { type: "scene", name: "海边", description: "Cliff at DAWN" }),
    asset("character-c", { name: "主角" }),
  ];
  other.messages = [{ ...message(999), content: "另一项目私有记录" }];
  other.materials = [
    material("foreign", other.id, { name: "Portrait", status: "local" }),
  ];
  other.assets = [asset("foreign-character")];
  state.projects.push(primary, other);
  state.providers[0].apiKey = "secret-do-not-disclose";
  store.save();
  const service = createApp({
    store,
    config: readConfig({ WORKBENCH_DATA_DIR: dataDir }),
  });
  const server = await new Promise((resolve) => {
    const listener = service.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    rmSync(dataDir, { force: true, recursive: true });
  });
  const api = async (path) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
    );
    return { status: response.status, body: await response.json() };
  };
  return { api, store, state, primary, other };
}

test("compact state returns one current project and bounded history with summaries", async (t) => {
  const { api, primary } = await fixture(t);
  const finishTask = beginProjectTask(primary, "image-test");
  t.after(finishTask);
  const response = await api("/state?compact=1&projectId=primary");
  assert.equal(response.status, 200);
  assert.equal(response.body.projects.length, 1);
  const project = response.body.projects[0];
  assert.equal(project.id, "primary");
  assert.equal(project.messages.length, 50);
  assert.equal(project.messages[0].id, "message-70");
  assert.deepEqual(project.messagePage, {
    total: 117,
    nextBefore: 70,
    startIndex: 70,
    episodeId: primary.currentEpisode.id,
  });
  assert.deepEqual(project.materials, []);
  assert.deepEqual(project.episodeArchive, []);
  assert.equal(project.assets.length, 3);
  assert.equal(project.backgroundTask, "image-test");
  assert.deepEqual(project.snapshot, { history: "recent" });
  assert.deepEqual(project.counts, {
    assets: 3,
    materials: 4,
    savedMaterials: 1,
    episodes: 2,
    messages: 120,
  });
  assert.equal(response.body.projectSummaries.length, 2);
  const summary = response.body.projectSummaries[0];
  assert.deepEqual(summary.counts, project.counts);
  assert.equal(summary.backgroundTask, "image-test");
  assert.equal(summary.currentEpisode.number, 2);
  assert.equal(summary.currentEpisode.startAssetIds, undefined);
  assert.equal(summary.messages, undefined);
  assert.equal(response.body.providers[0].hasKey, true);
  assert.ok(!JSON.stringify(response.body).includes("secret-do-not-disclose"));
  assert.ok(!JSON.stringify(response.body).includes("另一项目私有记录"));
  assert.equal((await api("/state?compact=1")).body.projects[0].id, "primary");
});

test("full state stays compatible, selected history and full project detail are available", async (t) => {
  const { api } = await fixture(t);
  const full = (await api("/state")).body;
  assert.equal(full.projects.length, 2);
  assert.equal(full.projects[0].messages.length, 120);
  assert.equal(full.projects[0].materials.length, 4);
  assert.equal(full.projects[0].episodeArchive.length, 1);
  assert.equal(full.projectSummaries, undefined);
  assert.ok(!JSON.stringify(full).includes("secret-do-not-disclose"));
  const history = (await api("/state?compact=1&projectId=primary&history=full")).body;
  assert.equal(history.projects.length, 1);
  assert.equal(history.projects[0].messages.length, 120);
  assert.equal(history.projects[0].episodeArchive.length, 1);
  assert.deepEqual(history.projects[0].snapshot, { history: "full" });
  assert.equal(history.projects[0].messagePage, undefined);
  const detail = (await api("/projects/primary")).body;
  assert.equal(detail.materials.length, 4);
  assert.equal(detail.messages.length, 120);
  assert.ok(Array.isArray(detail.workflowIssues));
  assert.equal(detail.chatPending, null);
});

test("missing selected project does not silently load another project", async (t) => {
  const { api } = await fixture(t);
  const response = await api("/state?compact=1&projectId=missing");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.projects, []);
  assert.equal(response.body.projectSummaries.length, 2);
  for (const suffix of ["", "/messages", "/materials", "/assets"])
    assert.equal((await api(`/projects/missing${suffix}`)).status, 404);
});

test("message cursor stays stable after appends and cannot cross episode boundary", async (t) => {
  const { api, primary, store } = await fixture(t);
  const first = (await api("/projects/primary/messages")).body;
  assert.equal(first.total, 117);
  assert.equal(first.nextBefore, 70);
  primary.messages.push(message(120));
  store.save();
  const second = (await api(`/projects/primary/messages?before=${first.nextBefore}`))
    .body;
  assert.deepEqual(
    second.items.map((item) => item.id),
    Array.from({ length: 50 }, (_, i) => `message-${i + 20}`),
  );
  assert.equal(second.total, 118);
  assert.equal(second.nextBefore, 20);
  const third = (await api("/projects/primary/messages?before=20")).body;
  assert.equal(third.items.length, 17);
  assert.equal(third.items[0].id, "message-3");
  assert.equal(third.startIndex, 3);
  assert.equal(third.nextBefore, null);
  const beforeEpisode = (await api("/projects/primary/messages?before=2")).body;
  assert.deepEqual(beforeEpisode.items, []);
  assert.equal(beforeEpisode.nextBefore, null);
  assert.equal(beforeEpisode.episodeId, primary.currentEpisode.id);
});

test("material queries scope before filtering, page deterministically, and search literally", async (t) => {
  const { api } = await fixture(t);
  const first = (await api("/projects/primary/materials?limit=2")).body;
  assert.deepEqual(
    first.items.map((item) => item.id),
    ["video-z", "image-percent"],
  );
  assert.equal(first.total, 4);
  assert.equal(first.projectTotal, 4);
  assert.equal(first.savedCount, 1);
  assert.equal(first.hasMore, true);
  const second = (await api("/projects/primary/materials?offset=2&limit=2")).body;
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["image-b", "image-a"],
  );
  assert.equal(second.items[1].nodeName, "角色定妆");
  assert.equal(second.hasMore, false);
  const search = (await api("/projects/primary/materials?type=image&q=PORTRAIT")).body;
  assert.deepEqual(
    search.items.map((item) => item.id),
    ["image-b"],
  );
  assert.equal(search.total, 1);
  assert.equal(search.projectTotal, 4);
  const saved = (await api("/projects/primary/materials?status=local&q=canvas-v2"))
    .body;
  assert.deepEqual(
    saved.items.map((item) => item.id),
    ["image-a"],
  );
  const literal = (await api("/projects/primary/materials?q=%25_")).body;
  assert.deepEqual(
    literal.items.map((item) => item.id),
    ["image-percent"],
  );
  const empty = (await api("/projects/primary/materials?offset=999")).body;
  assert.deepEqual(empty.items, []);
  assert.equal(empty.total, 4);
  assert.equal(empty.hasMore, false);
});

test("asset queries preserve project order and filter before pagination", async (t) => {
  const { api } = await fixture(t);
  const response = (
    await api("/projects/primary/assets?type=character&limit=1&offset=1")
  ).body;
  assert.equal(response.total, 2);
  assert.deepEqual(
    response.items.map((item) => item.id),
    ["character-c"],
  );
  assert.equal(response.hasMore, false);
  const search = (await api("/projects/primary/assets?q=dawn")).body;
  assert.deepEqual(
    search.items.map((item) => item.id),
    ["scene-b"],
  );
});

test("query parameters reject invalid bounds, duplicate values and unsupported filters", async (t) => {
  const { api } = await fixture(t);
  const paths = [
    "/projects/primary/messages?limit=0",
    "/projects/primary/messages?limit=101",
    "/projects/primary/messages?before=-1",
    "/projects/primary/messages?before=1.5",
    "/projects/primary/messages?before=9007199254740992",
    "/projects/primary/messages?limit=10&limit=20",
    "/projects/primary/messages?limit=1e2",
    "/projects/primary/materials?offset=-1",
    "/projects/primary/materials?offset=0.5",
    "/projects/primary/materials?limit=101",
    "/projects/primary/materials?status=saved",
    "/projects/primary/materials?type=character",
    "/projects/primary/materials?q=a&q=b",
    "/projects/primary/assets?type=image",
    "/projects/primary/assets?limit=01",
    "/projects/primary/assets?unexpected=1",
    "/state?projectId=primary&projectId=other",
    "/state?projectId=",
    "/state?compact=true",
    "/state?compact=1&history=everything",
  ];
  for (const path of paths) assert.equal((await api(path)).status, 400, path);
});

test("production read routes use store queries and synthetic stores remain injectable", async (t) => {
  const fx = await fixture(t);
  const called = new Set();
  for (const method of [
    "listMaterials",
    "listAssets",
    "listMessages",
    "getProjectCounts",
  ]) {
    assert.equal(typeof fx.store[method], "function", `SQLite store exposes ${method}`);
    const original = fx.store[method].bind(fx.store);
    fx.store[method] = (...args) => {
      called.add(method);
      return original(...args);
    };
  }
  await fx.api("/state?compact=1");
  await fx.api("/projects/primary/materials");
  await fx.api("/projects/primary/assets");
  assert.deepEqual([...called].sort(), [
    "getProjectCounts",
    "listAssets",
    "listMaterials",
    "listMessages",
  ]);
  const fake = await fixture(t, { synthetic: true });
  assert.equal(
    (await fake.api("/state?compact=1")).body.projects[0].messages.length,
    50,
  );
  assert.equal(
    (await fake.api("/projects/primary/materials?type=image&q=portrait")).body.total,
    1,
  );
});
