import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { createStore } from "./store.mjs";
import { mentionedAgent } from "./services/chat-mentions.mjs";
import { productionCommand } from "./services/chat-commands.mjs";
import { workflowReadiness } from "./workflow/readiness.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function stop(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

async function fixture(t, { onGenerate } = {}) {
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push({ path: request.url, body: input });
    response.setHeader("Content-Type", "application/json");
    if (onGenerate) return onGenerate(response, input);
    response.end(
      JSON.stringify({ choices: [{ message: { content: "本地测试创作回复" } }] }),
    );
  });
  const upstreamUrl = await listen(upstream);
  const state = createSeedState();
  const project = createProject({ name: "隔离群聊测试" });
  project.members = ["producer", "writer", "director"];
  state.projects = [project];
  state.providers = [
    {
      id: "provider-text",
      name: "本地测试文本服务",
      kind: "text",
      protocol: "openai",
      baseUrl: `${upstreamUrl}/v1`,
      model: "local-chat-test",
      enabled: true,
      apiKey: "isolated-chat-secret",
    },
  ];
  for (const agent of state.agents) {
    agent.enabled = true;
    agent.providerId = "provider-text";
    agent.model = "";
  }
  const store = createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({ store });
  const server = createServer(service.app);
  const base = await listen(server);
  t.after(async () => {
    service.close();
    await Promise.all([stop(server), stop(upstream)]);
  });
  async function api(path, body) {
    const response = await fetch(`${base}/api${path}`, {
      ...(body ? { method: "POST" } : {}),
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  return {
    state,
    project,
    requests,
    api,
    send: (body) => api(`/projects/${project.id}/messages`, body),
    snapshot: async () => (await api("/state")).body.projects[0],
  };
}

test("mentions match enabled group members by longest literal name, excluding email and ASCII word fragments", () => {
  const agents = [
    { id: "short", name: "导演", enabled: true },
    { id: "long", name: "导演助手", enabled: true },
    { id: "writer", name: "编剧", enabled: true },
    { id: "disabled", name: "剪辑", enabled: false },
    { id: "outside", name: "摄影", enabled: true },
    { id: "literal", name: "A+B", enabled: true },
  ];
  const members = ["short", "long", "writer", "disabled", "literal"];
  const resolve = (content) => mentionedAgent(content, agents, members)?.id;
  assert.equal(resolve("请 @导演助手 写分镜，@编剧 补对白"), "long");
  assert.equal(resolve("＠编剧写一集"), "writer");
  assert.equal(resolve("（@导演），写分镜"), "short");
  assert.equal(resolve("mail@导演.com user_@编剧"), undefined);
  assert.equal(resolve("@编剧abc @导演2 @导演_"), undefined);
  assert.equal(resolve("@剪辑 @摄影 @编剧"), "writer");
  assert.equal(resolve("@A+B，检查对白"), "literal");
  assert.equal(resolve("没有点名"), undefined);
});

test("configured model replies visibly from the resolved agent and preserves explicit recipient priority", async (t) => {
  const fx = await fixture(t);
  for (const [input, expectedAgent] of [
    [{ content: "先创作一集", intent: "discussion" }, "producer"],
    [{ content: "@编剧写一集" }, "writer"],
    [{ content: "＠分镜导演，请拆镜头" }, "director"],
    [{ content: "@编剧 调整对白", agentId: "director" }, "director"],
  ]) {
    const sent = await fx.send(input);
    assert.equal(sent.status, 201);
    const reply = fx.project.messages.at(-1);
    assert.equal(reply.agentId, expectedAgent);
    assert.equal(reply.type, "text");
    assert.equal(reply.replyTo, sent.body.id);
    assert.equal(reply.content, "本地测试创作回复");
  }
  assert.equal(fx.requests.length, 4);
  assert.ok(fx.project.nodes.every((node) => node.status === "pending"));
  assert.equal((await fx.snapshot()).chatPending, null);
  assert.equal(Object.hasOwn(fx.project, "chatPending"), false);
});

test("disabled or outside mentions use the coordinator while invalid explicit recipients reject before saving", async (t) => {
  const fx = await fixture(t);
  fx.state.agents.find((agent) => agent.id === "writer").enabled = false;
  const sent = await fx.send({ content: "@编剧 @角色设计 设计开场" });
  assert.equal(sent.status, 201);
  assert.equal(fx.project.messages.at(-1).agentId, "producer");
  const before = fx.project.messages.length;
  for (const agentId of ["writer", "missing"]) {
    const rejected = await fx.send({ content: "不应保存", agentId });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /不存在或未启用/);
  }
  assert.equal(fx.project.messages.length, before);
});

test("disabled and missing bindings produce actionable agent errors without silently switching providers", async (t) => {
  const fx = await fixture(t);
  fx.state.providers[0].enabled = false;
  const disabled = await fx.send({
    content: "先创作一集符合抖音节奏的短剧",
    intent: "discussion",
  });
  assert.equal(disabled.status, 201);
  let reply = fx.project.messages.at(-1);
  assert.equal(reply.type, "error");
  assert.equal(reply.agentId, "producer");
  assert.equal(reply.replyTo, disabled.body.id);
  assert.match(reply.content, /已停用/);
  assert.match(reply.content, /模型中心启用/);
  assert.equal((await fx.snapshot()).chatPending, null);

  const producer = fx.state.agents.find((agent) => agent.id === "producer");
  producer.providerId = "missing";
  fx.state.providers[0].enabled = true;
  await fx.send({ content: "服务未绑定时也要明确回复" });
  reply = fx.project.messages.at(-1);
  assert.equal(reply.type, "error");
  assert.match(reply.content, /尚无可用的文本对话接口/);
  assert.equal(fx.requests.length, 0);

  producer.providerId = "provider-text";
  const restored = await fx.send({ content: "修复配置后重试创作" });
  assert.equal(restored.status, 201);
  reply = fx.project.messages.at(-1);
  assert.equal(reply.type, "text");
  assert.equal(reply.replyTo, restored.body.id);
  assert.equal(reply.content, "本地测试创作回复");
  assert.equal(fx.requests.length, 1);
  assert.ok(!JSON.stringify(fx.project).includes("isolated-chat-secret"));
});

test("only direct coordinator commands dispatch production, never quoted questions or discussion mode", () => {
  const producer = { id: "producer", name: "总制片" };
  for (const content of [
    "总制片，先创作一集短剧吧",
    "@总制片 请开始制作",
    "继续制作",
    "恢复流程",
    "继续",
  ])
    assert.equal(productionCommand(content, producer), "start", content);
  assert.equal(productionCommand("暂停制作", producer), "stop");
  for (const content of [
    "不要开始制作",
    "怎么继续制作",
    "开始制作是什么意思？",
    "比如开始制作",
    "请解释“继续制作”",
    "先讨论一下剧情",
    "制作短剧的预算是多少",
    "生成一部短剧不可以",
    "总制片，先创作一集符合抖音爆款的短剧吧",
    "制作短剧需要多少钱",
    "创作一集以后再说",
  ])
    assert.equal(productionCommand(content, producer), null, content);
  assert.equal(productionCommand("开始制作", producer, "discussion"), null);
  assert.equal(productionCommand("开始制作", { id: "writer", name: "编剧" }), null);
});

test("workflow readiness exposes upcoming disabled bindings without changing models or bypassing diagnostics", () => {
  const state = createSeedState();
  const project = createProject({ name: "配置检查" });
  const before = JSON.stringify(state);
  const issues = workflowReadiness(project, state);
  assert.ok(
    issues.some(
      (issue) => issue.agentId === "compliance" && issue.message.includes("已停用"),
    ),
  );
  assert.equal(JSON.stringify(state), before);
  assert.ok(issues.length > 0);
});

async function waitForApproval(fx, nodeId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const project = await fx.snapshot();
    if (!project.running && project.approval?.nodeId === nodeId)
      return project.approval;
    if (project.nodes.some((node) => node.status === "failed"))
      assert.fail(JSON.stringify(project.nodes));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Approval ${nodeId} did not arrive`);
}

test("a complete creation command starts the pipeline and approval automatically hands off to the writer", async (t) => {
  const fx = await fixture(t);
  fx.project.style = "二次元动画";
  fx.project.chapters.push({
    id: "source",
    title: "第一章",
    content: "长生在家门口发现一张奇怪的字条。",
    createdAt: new Date().toISOString(),
  });
  fx.project.members = ["producer"];
  const sent = await fx.send({ content: "总制片，请开始制作" });
  assert.equal(sent.status, 201);
  const approval = await waitForApproval(fx, "analysis");
  assert.ok(fx.project.members.includes("writer"));
  assert.ok(
    fx.project.messages.some(
      (message) => message.type === "result" && message.nodeId === "analysis",
    ),
  );
  assert.ok(approval.fields.some((field) => field.id === "durationSeconds"));
  await fx.send({ content: "继续制作" });
  assert.equal(
    fx.project.approval.id,
    approval.id,
    "chat must not silently approve a review",
  );
  assert.equal(fx.project.nodes[1].status, "pending");
  const approved = await fx.api(`/projects/${fx.project.id}/approval`, {
    approvalId: approval.id,
    decision: "approve",
    value: "二次元动画",
    answers: {
      style: "二次元动画",
      episodeCount: "1",
      durationSeconds: "90",
      aspectRatio: "9:16",
      platform: "抖音",
    },
  });
  assert.equal(approved.status, 200);
  await waitForApproval(fx, "adaptation");
  assert.ok(fx.project.assets.some((asset) => asset.type === "script"));
  assert.equal(fx.project.nodes[0].status, "completed");
  assert.equal(fx.project.nodes[1].status, "waiting");
  assert.equal(fx.project.productionBrief.episodeCount, 1);
  assert.equal(fx.requests.length, 2);
});

test("a production request without chapters gives a concrete next step and does not call a model", async (t) => {
  const fx = await fixture(t);
  const response = await fx.send({ content: "开始制作" });
  assert.equal(response.status, 201);
  assert.match(fx.project.messages.at(-1).content, /导入小说章节或片段/);
  assert.equal(fx.requests.length, 0);
  assert.equal(fx.project.running, false);
  const count = fx.project.messages.length;
  assert.equal((await fx.send({ content: "开始制作", intent: "invalid" })).status, 400);
  assert.equal(fx.project.messages.length, count);
});

test("new-episode discussion and automatic start use only this episode's chat and stop at its own approval", async (t) => {
  const fx = await fixture(t);
  fx.project.nodes.forEach((node) => {
    node.status = "completed";
    node.output = "前一集产物";
  });
  fx.project.messages.push(
    {
      id: "old-user",
      agentId: "user",
      type: "text",
      content: "只属于上集的聊天暗号金甲虫",
    },
    {
      id: "old-proposal",
      agentId: "writer",
      type: "text",
      content: "未采用的上集聊天方案".repeat(80),
    },
  );
  const created = await fx.api(`/projects/${fx.project.id}/episodes`, {});
  assert.equal(created.status, 201);
  assert.equal(
    (await fx.send({ content: "先讨论本集新方向", intent: "discussion" })).status,
    201,
  );
  const discussion = fx.requests.at(-1).body.messages.at(-1).content;
  assert.match(discussion, /当前制作：第 2 集/);
  assert.doesNotMatch(discussion, /只属于上集的聊天暗号金甲虫|未采用的上集聊天方案/);
  assert.equal(
    (
      await fx.api(`/projects/${fx.project.id}/chapters`, {
        title: "本集片段",
        content: "长生拾起当前片段中的铜钥匙。",
      })
    ).status,
    201,
  );
  assert.equal((await fx.send({ content: "继续制作" })).status, 201);
  const approval = await waitForApproval(fx, "analysis");
  const production = fx.requests.at(-1).body.messages.at(-1).content;
  assert.match(production, /当前制作：第 2 集/);
  assert.match(production, /当前片段中的铜钥匙/);
  assert.doesNotMatch(production, /只属于上集的聊天暗号金甲虫|未采用的上集聊天方案/);
  const requests = fx.requests.length;
  await fx.send({ content: "继续制作" });
  assert.equal(fx.requests.length, requests);
  assert.equal(fx.project.approval.id, approval.id);
  assert.equal(fx.project.nodes[1].status, "pending");
});

test("live mention failures stay attached to the recipient and recover on the next request without leaking keys", async (t) => {
  let failing = true;
  const fx = await fixture(t, {
    onGenerate(response) {
      if (failing) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({ error: { message: "Denied isolated-chat-secret" } }),
        );
      } else {
        response.end(
          JSON.stringify({ choices: [{ message: { content: "已调整开场冲突" } }] }),
        );
      }
    },
  });
  const failed = await fx.send({ content: "@编剧，请强化开场冲突" });
  let reply = fx.project.messages.at(-1);
  assert.equal(reply.agentId, "writer");
  assert.equal(reply.type, "error");
  assert.equal(reply.replyTo, failed.body.id);
  assert.match(reply.content, /HTTP 401/);
  assert.ok(!JSON.stringify(fx.project).includes("isolated-chat-secret"));
  assert.match(fx.requests[0].body.messages.at(-1).content, /当前用户对「编剧」/);
  assert.ok(fx.project.memory.decisions.some((item) => item.includes("强化开场")));

  failing = false;
  const recovered = await fx.send({ content: "@编剧，请继续" });
  reply = fx.project.messages.at(-1);
  assert.equal(reply.agentId, "writer");
  assert.equal(reply.type, "text");
  assert.equal(reply.replyTo, recovered.body.id);
  assert.equal(reply.content, "已调整开场冲突");
  assert.ok(fx.project.nodes.every((node) => node.status === "pending"));
});

test("state projects pending agent replies without persisting controllers and rejects duplicate in-flight messages", async (t) => {
  let announceRequest;
  const received = new Promise((resolve) => {
    announceRequest = resolve;
  });
  let releaseResponse;
  const fx = await fixture(t, {
    onGenerate(response) {
      releaseResponse = () =>
        response.end(
          JSON.stringify({ choices: [{ message: { content: "镜头拆解已回复" } }] }),
        );
      announceRequest();
    },
  });
  t.after(() => releaseResponse?.());
  const sending = fx.send({ content: "@分镜导演 请拆解第一场" });
  await received;
  const pending = (await fx.snapshot()).chatPending;
  assert.equal(pending.agentId, "director");
  assert.equal(
    pending.messageId,
    fx.project.messages.findLast((message) => message.agentId === "user").id,
  );
  assert.equal(fx.project.messages.at(-1).event.kind, "start");
  assert.equal(fx.project.messages.at(-1).replyTo, pending.messageId);
  assert.ok(Number.isFinite(Date.parse(pending.startedAt)));
  assert.equal(Object.hasOwn(fx.project, "chatPending"), false);
  const duplicate = await fx.send({ content: "不要重复生成" });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /仍在生成/);
  assert.equal(fx.requests.length, 1);
  assert.ok(!fx.project.messages.some((message) => message.content === "不要重复生成"));
  releaseResponse();
  const sent = await sending;
  assert.equal(sent.status, 201);
  assert.equal((await fx.snapshot()).chatPending, null);
  assert.equal(fx.project.messages.at(-1).replyTo, sent.body.id);
});
