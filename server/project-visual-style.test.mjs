import { authenticatedFetch } from "./test-support/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";

async function fixture(t) {
  const state = createSeedState();
  const project = createProject({ name: "视觉标准更新", style: "二次元动画" });
  project.visualStyleGuide = "细线稿、低饱和土色、赛璐璐阴影";
  project.nodes.forEach((node) => {
    node.status = "completed";
    node.output = `${node.name}的已批准结果`;
    node.completedAt = "2026-10-12T00:00:00.000Z";
  });
  project.nodes.find((node) => node.id === "characters").status = "waiting";
  project.nodes.find((node) => node.id === "characters").characterGeneration = {
    key: "old-key",
    plan: [],
  };
  project.assets = [
    ["script", "adaptation", "已批准剧本"],
    ["character", "characters", "父亲"],
    ["storyboard", "storyboard", "已批准分镜"],
    ["video", "video", "旧视频"],
  ].map(([type, node, name]) => ({
    id: `asset-${node}`,
    name,
    type,
    description: "已批准资产",
    content: `${name}内容`,
    version: 1,
    locked: true,
    tags: [`node:${node}`],
  }));
  project.approval = {
    id: "old-approval",
    kind: "character",
    nodeId: "characters",
    title: "确认基础形象",
  };
  state.projects = [project];
  const store = createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({ store, stepDelay: 0 });
  const server = await new Promise((resolve) => {
    const listener = service.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { fetch } = await authenticatedFetch(base);
  t.after(async () => {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: path.endsWith("/messages") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return {
    ...service,
    project,
    state,
    request,
    patch: (body) => request(`/projects/${project.id}`, body),
  };
}

test("project style guide updates invalidate only characters and downstream approvals", async (t) => {
  const fx = await fixture(t);
  const upstream = structuredClone(fx.project.nodes.slice(0, 3));
  const script = structuredClone(fx.project.assets[0]);
  const result = await fx.patch({ visualStyleGuide: "  细线稿、统一灰绿配色  " });
  assert.equal(result.status, 200);
  assert.equal(result.body.visualStyleGuide, "细线稿、统一灰绿配色");
  assert.deepEqual(result.body.nodes.slice(0, 3), upstream);
  assert.deepEqual(result.body.assets[0], script);
  assert.ok(result.body.nodes.slice(3).every((node) => node.status === "pending"));
  assert.ok(result.body.nodes.slice(3).every((node) => node.output === ""));
  assert.equal(result.body.nodes[3].characterGeneration, undefined);
  assert.equal(result.body.approval, null);
  assert.equal(result.body.assets.length, 4);
  assert.ok(
    result.body.assets.slice(1).every((asset) => asset.tags.includes("待更新")),
  );
  assert.ok(result.body.assets.every((asset) => asset.locked));
  assert.match(result.body.memory.decisions.at(-1), /统一视觉标准已更新.*灰绿配色/);
  assert.match(
    result.body.messages.at(-1).content,
    /已批准的原著拆解、剧本和合规结果保留/,
  );
});

test("clearing a guide is supported and effective no-op updates preserve the current approval", async (t) => {
  const fx = await fixture(t);
  const before = structuredClone(fx.project);
  let result = await fx.patch({ visualStyleGuide: ` ${fx.project.visualStyleGuide} ` });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.nodes, before.nodes);
  assert.deepEqual(result.body.approval, before.approval);
  assert.deepEqual(result.body.messages, before.messages);
  result = await fx.patch({ visualStyleGuide: " " });
  assert.equal(result.body.visualStyleGuide, "");
  assert.equal(result.body.approval, null);
  assert.match(result.body.memory.decisions.at(-1), /已清除，重新沿用项目已选视觉风格/);
  const messages = structuredClone(result.body.messages);
  delete fx.project.visualStyleGuide;
  result = await fx.patch({ visualStyleGuide: "" });
  assert.deepEqual(result.body.messages, messages);
});

test("combined narrative and visual updates invalidate once and do not preserve old role references", async (t) => {
  const fx = await fixture(t);
  const invalidate = fx.workflow.invalidateFrom;
  const calls = [];
  fx.workflow.invalidateFrom = (...args) => {
    calls.push([args[1], args[2]]);
    return invalidate(...args);
  };
  const count = fx.project.messages.length;
  const result = await fx.patch({
    description: "本集主角回到村子",
    visualStyleGuide: "统一灰绿色细线稿",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [[0, { preserveCharacters: false }]]);
  assert.ok(result.body.nodes.every((node) => node.status === "pending"));
  assert.ok(result.body.assets.every((asset) => asset.tags.includes("待更新")));
  assert.equal(result.body.messages.length, count + 1);
  assert.match(result.body.messages.at(-1).content, /工作流已回到原著拆解/);
});

test("visual style guide input rejects invalid types and excessive size atomically", async (t) => {
  const fx = await fixture(t);
  const before = JSON.stringify(fx.project);
  for (const visualStyleGuide of [null, {}, [], 42, "色".repeat(4001)]) {
    const result = await fx.patch({ visualStyleGuide, name: "不应保存的名称" });
    assert.equal(result.status, 400);
    assert.equal(JSON.stringify(fx.project), before);
  }
  const result = await fx.patch({ visualStyleGuide: "色".repeat(4000) });
  assert.equal(result.status, 200);
  assert.equal(result.body.visualStyleGuide.length, 4000);
});

test("visual guide changes are blocked during both node execution and an in-flight agent reply", async (t) => {
  const fx = await fixture(t);
  const previousGuide = fx.project.visualStyleGuide;
  fx.project.running = true;
  assert.equal((await fx.patch({ visualStyleGuide: "新标准" })).status, 409);
  fx.project.running = false;

  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) {
      // Consume the local mock request before reporting that generation started.
      void chunk;
    }
    entered.resolve();
    await finish.promise;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "本地测试回复" } }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    finish.resolve();
    await new Promise((resolve) => {
      upstream.close(resolve);
      upstream.closeAllConnections();
    });
  });
  fx.project.mode = "live";
  fx.state.providers = [
    {
      id: "local-test-text",
      name: "本地测试模型",
      kind: "text",
      protocol: "openai",
      model: "mock",
      enabled: true,
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    },
  ];
  fx.state.agents.find((agent) => agent.id === "producer").providerId =
    "local-test-text";
  const reply = fx.request(`/projects/${fx.project.id}/messages`, {
    content: "讨论一下人物色彩",
    intent: "discussion",
  });
  await entered.promise;
  const result = await fx.patch({ visualStyleGuide: "新标准" });
  finish.resolve();
  assert.equal((await reply).status, 201);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /Agent 回复仍在生成/);
  assert.equal(fx.project.visualStyleGuide, previousGuide);
  assert.equal((await fx.patch({ visualStyleGuide: "新标准" })).status, 200);
});
