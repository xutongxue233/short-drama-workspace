import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";

const draft = {
  name: "声音顾问",
  role: "声音与配乐",
  systemPrompt: "根据本集资料提供声音建议，清楚标注尚未执行的事项。",
};

async function fixture(t, { seed = createSeedState } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-agents-"));
  const filename = join(directory, "workbench.sqlite");
  const model = await createLocalModel(t);
  const config = readConfig({ WORKBENCH_DATA_DIR: directory });
  let service;
  let server;
  let base;
  async function start() {
    const store = createStore({
      filename,
      seed() {
        const state = seed();
        model.bind(state);
        return state;
      },
    });
    service = createApp({ store, config });
    server = await new Promise((resolve) => {
      const active = service.app.listen(0, "127.0.0.1", () => resolve(active));
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
  }
  async function stop() {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
  await start();
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    model,
    filename,
    get state() {
      return service.store.getState();
    },
    save: () => service.store.save(),
    waitForWorkflow: (projectId) => service.workflow.jobs.get(projectId)?.promise,
    async restart() {
      await stop();
      await start();
    },
    async api(path, method = "GET", body) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("custom agents survive create, edit, enable, invite, mention, copy and SQLite restart", async (t) => {
  const fx = await fixture(t);
  const created = await fx.api("/agents", "POST", { ...draft, id: "producer" });
  assert.equal(created.status, 201);
  assert.match(created.body.id, /^agent-[\da-f-]{36}$/);
  assert.deepEqual(created.body, {
    ...draft,
    id: created.body.id,
    description: "",
    color: "#6e56cf",
    providerId: "",
    model: "",
    enabled: true,
  });
  const id = created.body.id;
  const path = `/agents/${id}`;
  const edited = await fx.api(path, "PATCH", {
    name: "  音效顾问  ",
    role: "  声音设计  ",
    description: "在制作群中建议声音和配乐。",
    systemPrompt: "你是声音顾问，请结合给定原文建议音效。",
    color: "#Ab12cD",
    providerId: "fixture-text",
    model: "custom-sound-model",
    enabled: false,
    id: "writer",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.id, id);
  assert.equal(edited.body.name, "音效顾问");
  assert.equal(edited.body.role, "声音设计");
  const project = (await fx.api("/projects", "POST", { name: "声音创作项目" })).body;
  const projectPath = `/projects/${project.id}`;
  const disabledInvite = await fx.api(`${projectPath}/invite`, "POST", { agentId: id });
  assert.equal(disabledInvite.status, 409);
  assert.match(disabledInvite.body.error, /启用/);
  assert.equal(
    (
      await fx.api(`${projectPath}/messages`, "POST", {
        content: "建议配乐",
        agentId: id,
      })
    ).status,
    400,
  );
  assert.equal((await fx.api(path, "PATCH", { enabled: true })).status, 200);
  assert.equal(
    (await fx.api(`${projectPath}/invite`, "POST", { agentId: id })).status,
    200,
  );
  const sent = await fx.api(`${projectPath}/messages`, "POST", {
    content: "@音效顾问 请建议雨夜场景的声音。",
    intent: "discussion",
  });
  assert.equal(sent.status, 201);
  assert.equal(fx.model.requests.length, 1);
  const request = fx.model.requests[0];
  assert.equal(request.path, "/v1/chat/completions");
  assert.equal(request.body.model, "custom-sound-model");
  assert.match(request.body.messages[0].content, /你是声音顾问/);
  const current = fx.state.projects.find((item) => item.id === project.id);
  const reply = current.messages.at(-1);
  assert.equal(reply.agentId, id);
  assert.equal(reply.type, "text");
  assert.equal(reply.replyTo, sent.body.id);
  assert.match(reply.content, /本地模型测试产物/);
  assert.ok(current.members.includes(id));
  assert.ok(current.nodes.every((node) => node.status === "pending"));
  const beforeDeletion = structuredClone(current);
  const rejected = await fx.api(path, "DELETE");
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /声音创作项目.*停用/);
  assert.deepEqual(current, beforeDeletion);
  const disabled = await fx.api(path, "PATCH", { enabled: false });
  assert.equal(disabled.status, 200);
  const copied = await fx.api("/agents", "POST", {
    ...disabled.body,
    name: "音效顾问副本",
  });
  assert.equal(copied.status, 201);
  assert.notEqual(copied.body.id, id);
  assert.equal(copied.body.enabled, false);
  assert.equal(copied.body.role, "声音设计");
  await fx.restart();
  const snapshot = (await fx.api("/state")).body;
  assert.deepEqual(
    snapshot.agents.find((agent) => agent.id === id),
    disabled.body,
  );
  assert.deepEqual(
    snapshot.agents.find((agent) => agent.id === copied.body.id),
    copied.body,
  );
  assert.ok(fx.state.projects[0].messages.some((message) => message.id === reply.id));
  assert.equal((await fx.api(path, "DELETE")).status, 409);
  const removed = await fx.api(`/agents/${copied.body.id}`, "DELETE");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { id: copied.body.id, deleted: true });
  await fx.restart();
  assert.equal(
    fx.state.agents.some((agent) => agent.id === copied.body.id),
    false,
  );
  assert.equal((await fx.api(`/agents/${copied.body.id}`, "DELETE")).status, 404);
});

test("agent fields are strictly validated before mutations and can be explicitly cleared", async (t) => {
  const fx = await fixture(t);
  const created = await fx.api("/agents", "POST", draft);
  const path = `/agents/${created.body.id}`;
  const invalid = [
    ...["name", "role", "systemPrompt"].flatMap((field) => [
      { [field]: "  " },
      { [field]: null },
      { [field]: 42 },
    ]),
    ...[
      ["name", 80],
      ["role", 80],
      ["description", 1000],
      ["systemPrompt", 12000],
      ["model", 200],
      ["providerId", 100],
    ].map(([field, max]) => ({ [field]: "a".repeat(max + 1) })),
    { description: {} },
    { model: [] },
    { providerId: null },
    { providerId: "missing-provider" },
    { enabled: "false" },
    { enabled: 0 },
    { color: null },
    { color: "red" },
    { color: "#abc" },
    { color: "#aabbccdd" },
    { color: "#aabbcz" },
    { color: "url(x)" },
  ];
  for (const patch of invalid) {
    const before = structuredClone(fx.state);
    for (const [method, url, body] of [
      ["POST", "/agents", { ...draft, name: "未保存新成员", ...patch }],
      ["PATCH", path, patch],
    ]) {
      const result = await fx.api(url, method, body);
      assert.equal(result.status, 400, `${method}: ${JSON.stringify(patch)}`);
      assert.deepEqual(fx.state, before);
    }
  }
  for (const field of ["name", "role", "systemPrompt"]) {
    const input = { ...draft };
    delete input[field];
    assert.equal((await fx.api("/agents", "POST", input)).status, 400);
  }
  for (const body of [null, [], "invalid"])
    assert.equal((await fx.api("/agents", "POST", body)).status, 400);
  const maximum = await fx.api(path, "PATCH", {
    name: "n".repeat(80),
    role: "r".repeat(80),
    description: "d".repeat(1000),
    systemPrompt: "s".repeat(12000),
    model: "m".repeat(200),
    color: "#ABCDEF",
  });
  assert.equal(maximum.status, 200);
  const cleared = await fx.api(path, "PATCH", {
    description: "",
    model: "",
    providerId: "",
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.description, "");
  assert.equal(cleared.body.model, "");
  assert.equal(cleared.body.providerId, "");
  assert.equal((await fx.api("/agents/missing", "PATCH", draft)).status, 404);
});

test("changing an agent provider clears stale model overrides unless explicitly supplied", async (t) => {
  const fx = await fixture(t);
  const created = (
    await fx.api("/agents", "POST", {
      ...draft,
      providerId: "fixture-text",
      model: "original-model-override",
    })
  ).body;
  const path = `/agents/${created.id}`;
  const same = await fx.api(path, "PATCH", { providerId: "fixture-text" });
  assert.equal(same.status, 200);
  assert.equal(same.body.model, "original-model-override");
  const invalid = await fx.api(path, "PATCH", { providerId: "missing-provider" });
  assert.equal(invalid.status, 400);
  assert.equal(
    fx.state.agents.find((agent) => agent.id === created.id).model,
    "original-model-override",
  );
  const changed = await fx.api(path, "PATCH", { providerId: "provider-text" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.model, "");
  const explicit = await fx.api(path, "PATCH", {
    providerId: "fixture-text",
    model: "new-explicit-override",
  });
  assert.equal(explicit.status, 200);
  assert.equal(explicit.body.model, "new-explicit-override");
  const unrelated = await fx.api(path, "PATCH", { description: "仅修改简介" });
  assert.equal(unrelated.status, 200);
  assert.equal(unrelated.body.model, "new-explicit-override");
  const cleared = await fx.api(path, "PATCH", { providerId: "" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.model, "");
  await fx.restart();
  assert.deepEqual(
    fx.state.agents.find((agent) => agent.id === created.id),
    cleared.body,
  );
});

test(
  "editing an agent during generation preserves the active request model and applies changes to later tasks",
  { timeout: 10000 },
  async (t) => {
    const fx = await fixture(t);
    const requests = [];
    let received;
    const dispatched = new Promise((resolve) => {
      received = resolve;
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const upstream = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      if (requests.length === 1) {
        received();
        await gate;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          text: "本地图片分镜",
          url: `${fx.model.baseUrl}/media/character.png`,
        }),
      );
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      release();
      await new Promise((resolve) => {
        upstream.close(resolve);
        upstream.closeAllConnections();
      });
    });
    fx.state.providers.push({
      id: "gated-image",
      name: "进行中的图片服务",
      kind: "image",
      protocol: "webhook",
      enabled: true,
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      model: "service-default",
      apiKey: "",
    });
    const project = createProject({ name: "维护期间生成", style: "二次元动画" });
    project.chapters.push({
      id: "source",
      title: "片段",
      content: "林晚在旧邮局见到陈渡。",
    });
    project.assets.push({
      id: "approved-script",
      name: "本集剧本",
      type: "script",
      content: "林晚在旧邮局见到陈渡。",
      description: "已批准剧本",
      version: 1,
      locked: true,
      tags: ["node:adaptation"],
    });
    for (const node of project.nodes) {
      if (node.id === "storyboard") break;
      node.status = "completed";
      node.output = "已确认的测试产物";
    }
    fx.state.projects.push(project);
    fx.save();
    assert.equal(
      (
        await fx.api("/agents/director", "PATCH", {
          providerId: "gated-image",
          model: "original-image-model",
          systemPrompt: "原始分镜指令",
        })
      ).status,
      200,
    );
    const initialAgent = fx.state.agents.find((agent) => agent.id === "director");
    const start = await fx.api(`/projects/${project.id}/run`, "POST", {});
    assert.equal(start.status, 202);
    await dispatched;
    const completion = fx.waitForWorkflow(project.id);
    assert.equal(
      (
        await fx.api("/agents/director", "PATCH", {
          model: "updated-image-model",
          systemPrompt: "下一轮分镜指令",
        })
      ).status,
      200,
    );
    release();
    await completion;
    assert.equal(requests[0].model, "original-image-model");
    assert.match(requests[0].system, /原始分镜指令/);
    assert.equal(
      project.nodes.find((node) => node.id === "storyboard").status,
      "waiting",
    );
    assert.equal(project.materials.at(-1).model, "original-image-model");
    assert.equal(initialAgent.model, "original-image-model");
    assert.notEqual(
      fx.state.agents.find((agent) => agent.id === "director"),
      initialAgent,
    );
    // A later project starts from the current maintained configuration.
    const second = createProject({ name: "维护后的新请求", style: "二次元动画" });
    second.chapters = structuredClone(project.chapters);
    second.assets = structuredClone(
      project.assets.filter((asset) => asset.id === "approved-script"),
    );
    for (const node of second.nodes) {
      if (node.id === "storyboard") break;
      node.status = "completed";
      node.output = "已确认的测试产物";
    }
    fx.state.projects.push(second);
    fx.save();
    assert.equal((await fx.api(`/projects/${second.id}/run`, "POST", {})).status, 202);
    await fx.waitForWorkflow(second.id);
    assert.equal(requests[1].model, "updated-image-model");
    assert.match(requests[1].system, /下一轮分镜指令/);
    assert.equal(second.materials.at(-1).model, "updated-image-model");
  },
);

test("duplicate names cannot make mentions ambiguous while older duplicate agents remain editable", async (t) => {
  const fx = await fixture(t);
  const original = (await fx.api("/agents", "POST", { ...draft, name: "Sound" })).body;
  for (const name of ["Sound", " sound ", "SOUND"]) {
    const before = structuredClone(fx.state.agents);
    const created = await fx.api("/agents", "POST", { ...draft, name });
    assert.equal(created.status, 409);
    assert.match(created.body.error, /名称已存在/);
    const renamed = await fx.api("/agents/writer", "PATCH", { name });
    assert.equal(renamed.status, 409);
    assert.deepEqual(fx.state.agents, before);
  }
  const legacy = { ...original, id: "legacy-duplicate" };
  delete legacy.color;
  delete legacy.model;
  legacy.providerId = "removed-legacy-provider";
  fx.state.agents.push(legacy);
  fx.save();
  await fx.restart();
  const unchangedName = await fx.api("/agents/legacy-duplicate", "PATCH", {
    name: "Sound",
    enabled: false,
  });
  assert.equal(unchangedName.status, 200);
  assert.equal(unchangedName.body.providerId, "removed-legacy-provider");
  assert.equal(Object.hasOwn(unchangedName.body, "color"), false);
  const repaired = await fx.api("/agents/legacy-duplicate", "PATCH", {
    name: "Sound legacy",
    color: "#123456",
    providerId: "fixture-text",
  });
  assert.equal(repaired.status, 200);
  await fx.restart();
  assert.deepEqual(
    fx.state.agents.find((agent) => agent.id === legacy.id),
    repaired.body,
  );
});

test("builtin identity is protected even after renaming and without project references", async (t) => {
  const fx = await fixture(t);
  for (const id of [
    "producer",
    "writer",
    "compliance",
    "character",
    "director",
    "video",
    "editor",
  ]) {
    const edited = await fx.api(`/agents/${id}`, "PATCH", {
      name: `${id} renamed`,
      role: "新的职责",
      color: "#123456",
      enabled: false,
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.role, "新的职责");
    const deleted = await fx.api(`/agents/${id}`, "DELETE");
    assert.equal(deleted.status, 409);
    assert.match(deleted.body.error, /内置.*停用/);
  }
  assert.equal(fx.state.agents.length, 7);
  assert.equal(fx.state.projects.length, 0);
});

test("deletion protects historical and nested agent references independently of project membership", async (t) => {
  const fx = await fixture(t);
  const created = (await fx.api("/agents", "POST", draft)).body;
  const id = created.id;
  const project = createProject({ name: "历史创作档案" });
  fx.state.projects.push(project);
  for (const patch of [
    { members: [id] },
    { nodes: [{ id: "custom-node", agentId: id }] },
    { messages: [{ id: "historical-reply", agentId: id, content: "旧回复" }] },
    { messages: [{ id: "handoff", event: { fromAgentId: id } }] },
    { messages: [{ id: "handoff", event: { toAgentId: id } }] },
    { approval: { nextStep: { agentId: id } } },
    { episodeArchive: [{ id: "old-episode", nodes: [{ agentId: id }] }] },
    { episodeArchive: [{ id: "old-episode", messages: [{ agentId: id }] }] },
    {
      episodeArchive: [{ id: "old-episode", messages: [{ event: { toAgentId: id } }] }],
    },
    { nodes: [{ id: "characters", imageTaskHistory: [{ planner: { agentId: id } }] }] },
  ]) {
    Object.assign(
      project,
      { members: [], messages: [], nodes: [], episodeArchive: [], approval: null },
      patch,
    );
    const before = structuredClone(fx.state);
    const removed = await fx.api(`/agents/${id}`, "DELETE");
    assert.equal(removed.status, 409, JSON.stringify(patch));
    assert.match(removed.body.error, /历史创作档案.*停用/);
    assert.deepEqual(fx.state, before);
  }
});

function persistedAgents(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    return db
      .prepare("SELECT value FROM agents ORDER BY position")
      .all()
      .map((row) => JSON.parse(row.value));
  } finally {
    db.close();
  }
}

test("SQLite failures roll back create, edit and delete while retaining live object references and retryability", async (t) => {
  for (const operation of ["INSERT", "UPDATE", "DELETE"])
    await t.test(operation, async (t) => {
      const fx = await fixture(t);
      const created = (await fx.api("/agents", "POST", draft)).body;
      const before = structuredClone(fx.state);
      const root = fx.state;
      const agents = fx.state.agents;
      const agent = agents.find((item) => item.id === created.id);
      const db = new DatabaseSync(fx.filename);
      try {
        db.exec(
          `CREATE TRIGGER fail_agent_write BEFORE ${operation} ON agents BEGIN SELECT RAISE(ABORT, 'injected agent persistence failure'); END`,
        );
        const [path, method, body, success] = {
          INSERT: ["/agents", "POST", { ...draft, name: "失败后重试创建" }, 201],
          UPDATE: [
            `/agents/${agent.id}`,
            "PATCH",
            { role: "更新后的职责", enabled: false },
            200,
          ],
          DELETE: [`/agents/${agent.id}`, "DELETE", undefined, 200],
        }[operation];
        assert.equal((await fx.api(path, method, body)).status, 500);
        assert.equal(fx.state, root);
        assert.equal(fx.state.agents, agents);
        assert.equal(
          agents.find((item) => item.id === created.id),
          agent,
        );
        assert.deepEqual(fx.state, before);
        assert.deepEqual(persistedAgents(fx.filename), before.agents);
        db.exec("DROP TRIGGER fail_agent_write");
        assert.equal((await fx.api(path, method, body)).status, success);
        const saved = structuredClone(fx.state.agents);
        assert.deepEqual(persistedAgents(fx.filename), saved);
        await fx.restart();
        assert.deepEqual(fx.state.agents, saved);
      } finally {
        db.close();
      }
    });
});
