import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { mountProjectsRoutes } from "./routes/projects.mjs";
import { mountAgentsRoutes } from "./routes/agents.mjs";
import { mountAssetsRoutes } from "./routes/assets.mjs";
import { activeReference } from "./workflow/memory.mjs";

const storeUrl = new URL("./store.mjs", import.meta.url).href;
const seedUrl = new URL("./seed.mjs", import.meta.url).href;

function syntheticState() {
  const state = createSeedState();
  const project = createProject({ name: "持久化回归", style: "二次元动画" });
  state.projects.push(project);
  return state;
}

function temporaryDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-persistence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "workspace.sqlite");
}

function persisted(filename) {
  const reader = new DatabaseSync(filename, { readOnly: true });
  try {
    return ["workspace_metadata", "projects", "project_nodes", "project_messages"].map(
      (table) => reader.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  } finally {
    reader.close();
  }
}

test("a second store owner cannot recover or overwrite live work in the same process or a child", (t) => {
  const filename = temporaryDatabase(t);
  const owner = createStore({ filename, seed: syntheticState });
  try {
    const project = owner.getState().projects[0];
    project.running = true;
    project.nodes[0].status = "running";
    project.nodes[0].output = "已持久化的实时工作";
    owner.save();
    const before = persisted(filename);
    let seedCalled = false;
    assert.throws(
      () =>
        createStore({
          filename,
          seed: () => {
            seedCalled = true;
            return syntheticState();
          },
        }),
      /另一个实例占用/,
    );
    assert.equal(seedCalled, false);
    assert.deepEqual(persisted(filename), before);
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { createStore } from ${JSON.stringify(storeUrl)};
       try { const store = createStore({ filename: process.argv[1] }); store.close(); process.exitCode = 2; }
       catch (error) { if (!/另一个实例占用/.test(error.message)) throw error; process.stdout.write("ownership-rejected"); }`,
        filename,
      ],
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "ownership-rejected");
    assert.deepEqual(persisted(filename), before);
    assert.equal(project.running, true);
    assert.equal(project.nodes[0].status, "running");
  } finally {
    owner.close();
  }
  const reopened = createStore({ filename });
  try {
    const project = reopened.getState().projects[0];
    assert.equal(project.running, false);
    assert.equal(project.nodes[0].status, "pending");
    assert.equal(project.nodes[0].output, "已持久化的实时工作");
    assert.equal(
      project.messages.filter((message) => message.event?.phase === "recovered").length,
      1,
    );
  } finally {
    reopened.close();
  }
});

test(
  "a crashed owner releases its OS lock without deleting the ownership file",
  { timeout: 15000 },
  async (t) => {
    const filename = temporaryDatabase(t);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { createStore } from ${JSON.stringify(storeUrl)};
     import { createSeedState, createProject } from ${JSON.stringify(seedUrl)};
     const store = createStore({ filename: process.argv[1], seed: () => {
       const state = createSeedState(); state.projects.push(createProject({ name: "崩溃恢复" })); return state;
     } });
     const project = store.getState().projects[0];
     project.running = true; project.nodes[0].status = "running";
     project.nodes[0].output = "崩溃前检查点"; store.save();
       process.send("ready"); setInterval(() => store.getState(), 1000);`,
        filename,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      const ready = await Promise.race([
        once(child, "message").then(([message]) => message),
        once(child, "exit").then(([code]) => {
          throw new Error(`Child exited ${code}: ${stderr}`);
        }),
      ]);
      assert.equal(ready, "ready");
      assert.throws(() => createStore({ filename }), /另一个实例占用/);
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const recovered = createStore({ filename });
      try {
        assert.equal(recovered.getState().projects[0].running, false);
        assert.equal(recovered.getState().projects[0].nodes[0].output, "崩溃前检查点");
      } finally {
        recovered.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
  },
);

function snapshot(state) {
  const references = [];
  function collect(value, path = []) {
    if (!value || typeof value !== "object") return;
    references.push([path, value]);
    for (const [key, item] of Object.entries(value)) collect(item, [...path, key]);
  }
  collect(state);
  const data = structuredClone(state);
  return () => {
    assert.deepEqual(state, data);
    for (const [path, reference] of references)
      assert.equal(
        path.reduce((value, key) => value[key], state),
        reference,
        `Preserve reference at ${path.join(".")}`,
      );
  };
}

async function routeFixture(t) {
  const state = syntheticState();
  const project = state.projects[0];
  let failSave = false;
  let saves = 0;
  let reviews = 0;
  const workflow = {
    invalidateFrom(project, from) {
      for (const node of project.nodes.slice(Math.max(from, 0))) {
        node.status = "pending";
        delete node.characterGeneration;
      }
      project.approval = null;
    },
    reviewEditedAsset() {
      reviews++;
    },
  };
  const dependencies = {
    getState: () => state,
    save() {
      if (failSave) throw new Error("injected checkpoint failure");
      saves++;
    },
    findProject: () => project,
    workflow,
    chat: { getPending: () => null },
    auth: {
      audit(action) {
        (state.auditFixture ||= []).push(action);
      },
    },
  };
  const app = express();
  app.use(express.json());
  // Route-unit fixture: full authentication is exercised through createApp elsewhere.
  app.use((req, _res, next) => {
    req.auth = {
      user: {
        id: "fixture-owner",
        displayName: "测试负责人",
        kind: "human",
        role: "admin",
      },
    };
    next();
  });
  mountProjectsRoutes(app, dependencies);
  mountAgentsRoutes(app, dependencies);
  mountAssetsRoutes(app, dependencies);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return {
    state,
    project,
    workflow,
    get saves() {
      return saves;
    },
    get reviews() {
      return reviews;
    },
    set failSave(value) {
      failSave = value;
    },
    async request(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("project and agent mutations restore values and live object references when saving fails", async (t) => {
  for (const operation of ["create", "configure", "chapters", "episodes", "agent"])
    await t.test(operation, async (t) => {
      const fx = await routeFixture(t);
      for (const node of fx.project.nodes) node.status = "completed";
      fx.project.chapters.push({ id: "chapter-old", title: "第一章", content: "原文" });
      fx.project.nodes[3].characterGeneration = { plan: [{ status: "ready" }] };
      const root = `/api/projects/${fx.project.id}`;
      const [method, path, body, status] = {
        create: ["POST", "/api/projects", { name: "新项目" }, 201],
        configure: ["PATCH", root, { style: "国风动画" }, 200],
        chapters: [
          "POST",
          `${root}/chapters`,
          { title: "第二章", content: "新原文" },
          201,
        ],
        episodes: ["POST", `${root}/episodes`, { title: "下一集" }, 201],
        agent: [
          "PATCH",
          "/api/agents/producer",
          { name: "新制片", systemPrompt: "新提示", enabled: false },
          200,
        ],
      }[operation];
      const unchanged = snapshot(fx.state);
      fx.failSave = true;
      const failed = await fx.request(method, path, body);
      assert.equal(failed.status, 500);
      assert.match(failed.body.error, /injected checkpoint/);
      unchanged();
      assert.equal(fx.saves, 0);
      fx.failSave = false;
      assert.equal((await fx.request(method, path, body)).status, status);
      assert.equal(fx.saves, 1);
      if (operation === "create") assert.equal(fx.state.projects.length, 2);
      if (operation === "chapters") assert.equal(fx.project.chapters.length, 2);
      if (operation === "episodes") {
        assert.equal(fx.project.episodeArchive.length, 1);
        assert.equal(fx.project.currentEpisode.number, 2);
      }
    });
});

function addCharacter(project, image = {}) {
  const asset = {
    id: "synthetic-role",
    name: "长生",
    type: "character",
    description: "灰蓝布衣",
    content: "角色：长生\n基础外观：灰蓝布衣",
    version: 1,
    locked: false,
    tags: ["node:characters", "角色定妆"],
    ...image,
  };
  project.assets.push(asset);
  return asset;
}

test("a failed edited-asset review restores the full state and existing references", async (t) => {
  const fx = await routeFixture(t);
  const asset = addCharacter(fx.project);
  fx.project.nodes[3].characterGeneration = {
    plan: [{ name: "长生", status: "pending" }],
  };
  fx.project.approval = {
    id: "existing-review",
    nodeId: "characters",
    fields: [{ id: "style", value: "灰蓝" }],
  };
  const unchanged = snapshot(fx.state);
  fx.workflow.reviewEditedAsset = (project, changed) => {
    changed.description = "review changed description";
    project.nodes[0].output = "review changed output";
    project.assets.push({ id: "review-temporary" });
    throw new Error("injected review failure");
  };
  const result = await fx.request(
    "PATCH",
    `/api/projects/${fx.project.id}/assets/${asset.id}`,
    { content: "改为深绿布衣" },
  );
  assert.equal(result.status, 500);
  assert.match(result.body.error, /injected review/);
  unchanged();
  assert.equal(fx.saves, 0);
});

test("manually changed legacy image roles require regeneration before relocking", async (t) => {
  for (const image of [
    { url: "https://files.example/old-role.png" },
    { materialId: "old-role-material" },
    { url: "/api/media/old-role-material/file", materialId: "old-role-material" },
  ])
    await t.test(JSON.stringify(image), async (t) => {
      const fx = await routeFixture(t);
      const asset = addCharacter(fx.project, image);
      const path = `/api/projects/${fx.project.id}/assets/${asset.id}`;
      const result = await fx.request("PATCH", path, { content: "改为深绿布衣" });
      assert.equal(result.status, 200);
      assert.equal(asset.version, 2);
      assert.equal(asset.locked, false);
      assert.ok(asset.tags.includes("待重新生成"));
      assert.equal(activeReference(asset), false);
      assert.equal(fx.reviews, 0);
      for (const [key, value] of Object.entries(image)) assert.equal(asset[key], value);
      const unchanged = snapshot(fx.state);
      assert.equal((await fx.request("PATCH", path, { locked: true })).status, 409);
      unchanged();
    });
});

test("text-only legacy role proposals still enter review after manual edits", async (t) => {
  const fx = await routeFixture(t);
  const asset = addCharacter(fx.project);
  const path = `/api/projects/${fx.project.id}/assets/${asset.id}`;
  assert.equal(
    (await fx.request("PATCH", path, { content: "改为深绿布衣" })).status,
    200,
  );
  assert.equal(fx.reviews, 1);
  assert.equal(asset.tags.includes("待重新生成"), false);
});
