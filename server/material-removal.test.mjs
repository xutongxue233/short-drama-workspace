import { authenticatedFetch } from "./test-support/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialService } from "./services/materials.mjs";
import { mountMaterialsRoutes } from "./routes/materials.mjs";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
  "base64",
);
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "workbench-remove-material-"));
  const project = { id: "project-a", assets: [], materials: [], nodes: [] };
  const state = { projects: [project] };
  const service = createMaterialService({
    getState: () => state,
    dataDir,
    save: () => {},
    ...options,
  });
  t.after(async () => {
    service.close();
    await rm(dataDir, { force: true, recursive: true });
  });
  const material = await service.capture(project, {
    url: dataUrl,
    name: "待废弃角色",
    type: "image",
    nodeId: "characters",
    assetId: "old-asset",
  });
  const path = (await service.file(material.id)).path;
  return { dataDir, state, project, service, material, path };
}

test("material deletion saves detached records before unlink and preserves newer reused assets", async (t) => {
  let inspectSave = () => {};
  const fx = await fixture(t, { save: () => inspectSave() });
  const newer = await fx.service.capture(fx.project, { url: dataUrl, type: "image" });
  fx.project.assets.push(
    { id: "old-asset", url: newer.url, materialId: newer.id },
    { id: "draft", url: fx.material.url, materialId: fx.material.id },
    { id: "legacy-draft", url: fx.material.url },
  );
  inspectSave = () => {
    assert.ok(existsSync(fx.path));
    assert.equal(fx.project.materials.length, 1);
    assert.deepEqual(
      fx.project.assets.map((item) => item.id),
      ["old-asset"],
    );
  };
  const result = fx.service.remove(fx.project, fx.material.id);
  assert.equal(result.assets.length, 2);
  assert.equal(existsSync(fx.path), false);
  assert.deepEqual(await readFile((await fx.service.file(newer.id)).path), png);
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), { status: 404 });
});

test("locked, cross-project and busy references block material deletion", async (t) => {
  const fx = await fixture(t);
  const asset = { id: "locked", materialId: fx.material.id, locked: true };
  fx.project.assets.push(asset);
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /已锁定/);
  asset.locked = false;
  fx.state.projects.push({ id: "other", assets: [{ url: fx.material.url }] });
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /其他项目/);
  fx.state.projects.pop();
  fx.project.running = true;
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /暂停/);
  fx.project.running = false;
  fx.material.status = "downloading";
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /正在下载/);
  assert.ok(existsSync(fx.path));
  assert.equal(fx.project.assets.length, 1);
});

test("wrong-project and malformed IDs cannot delete files outside material ownership", async (t) => {
  const fx = await fixture(t);
  const other = { id: "other", assets: [], materials: [] };
  fx.state.projects.push(other);
  assert.throws(() => fx.service.remove(other, fx.material.id), { status: 404 });
  const malformed = { ...fx.material, id: "../../outside" };
  fx.project.materials.push(malformed);
  assert.throws(() => fx.service.remove(fx.project, malformed.id), { status: 404 });
  assert.ok(existsSync(fx.path));
  assert.equal(fx.project.materials.length, 2);
});

test("immutable episode archives keep referenced media files even after the live asset changes", async (t) => {
  const fx = await fixture(t);
  fx.project.episodeArchive = [{ assets: [], materials: [{ id: fx.material.id }] }];
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /已归档剧集/);
  assert.ok(existsSync(fx.path));
  assert.equal(fx.project.materials.length, 1);
});

test("save or unlink failure restores records and a missing binary remains removable", async (t) => {
  let failSave = false;
  const fx = await fixture(t, {
    save: () => {
      if (failSave) throw new Error("write failed");
    },
  });
  fx.project.assets.push({ id: "draft", materialId: fx.material.id });
  failSave = true;
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /write failed/);
  assert.ok(existsSync(fx.path));
  assert.equal(fx.project.assets.length, 1);
  failSave = false;
  await unlink(fx.path);
  await mkdir(fx.path);
  assert.throws(() => fx.service.remove(fx.project, fx.material.id), /记录已恢复/);
  assert.equal(fx.project.assets.length, 1);
  assert.equal(fx.project.materials.length, 1);
  await rm(fx.path, { recursive: true });
  fx.service.remove(fx.project, fx.material.id);
  assert.equal(fx.project.materials.length, 0);
  assert.equal(fx.project.assets.length, 0);
});

test("pending chat blocks the deletion route before it mutates materials", () => {
  let handler;
  mountMaterialsRoutes(
    {
      get() {},
      post() {},
      delete(_path, callback) {
        handler = callback;
      },
    },
    {
      findProject: () => ({ id: "project-a", running: false }),
      chat: { getPending: () => ({ agentId: "character" }) },
      materials: { remove: () => assert.fail("must not delete during chat") },
    },
  );
  assert.throws(() => handler({ params: {} }, {}), /Agent 正在回复/);
});

test("HTTP deletion resets affected workflow checkpoint and approval while preserving approved script", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "workbench-remove-api-"));
  const state = createSeedState();
  const project = createProject({ name: "删除素材测试", mode: "demo", episodes: 1 });
  state.projects = [project];
  const store = createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({
    store,
    config: { dataDir, distDir: join(dataDir, "dist"), workflowStepMs: 0 },
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
    await rm(dataDir, { recursive: true, force: true });
  });
  const material = await service.materials.capture(project, {
    url: dataUrl,
    type: "image",
    nodeId: "characters",
  });
  const path = (await service.materials.file(material.id)).path;
  project.assets = [
    { id: "script", type: "script", locked: true, tags: ["node:adaptation"] },
    {
      id: "draft",
      type: "character",
      materialId: material.id,
      tags: ["node:characters"],
    },
    { id: "board", type: "storyboard", tags: ["node:storyboard"] },
  ];
  for (const node of project.nodes) node.status = "completed";
  const characterNode = project.nodes.find((node) => node.id === "characters");
  characterNode.characterGeneration = { id: "generation", plan: [{ name: "角色" }] };
  project.approval = { id: "approval", nodeId: "storyboard" };
  const base = `http://127.0.0.1:${server.address().port}`;
  const { fetch } = await authenticatedFetch(base);
  const response = await fetch(
    `${base}/api/projects/${project.id}/materials/${material.id}`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.materials.length, 0);
  assert.deepEqual(
    updated.assets.map((asset) => asset.id),
    ["script", "board"],
  );
  assert.equal(updated.assets[0].locked, true);
  assert.ok(updated.assets[1].tags.includes("待更新"));
  assert.ok(updated.nodes.slice(0, 3).every((node) => node.status === "completed"));
  assert.ok(updated.nodes.slice(3).every((node) => node.status === "pending"));
  assert.equal(updated.nodes[3].characterGeneration, undefined);
  assert.equal(updated.approval, null);
  assert.equal(existsSync(path), false);
  assert.equal((await fetch(base + material.url)).status, 404);
});
