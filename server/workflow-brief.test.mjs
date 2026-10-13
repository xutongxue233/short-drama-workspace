import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createApproval } from "./workflow/templates.mjs";
import { buildContext, compressMemory } from "./workflow/memory.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";
import {
  confirmedBrief,
  suggestedBrief,
  validateBriefAnswers,
} from "./workflow/brief.mjs";

async function fixture(t, { style = "国风动画" } = {}) {
  const state = createSeedState();
  const project = createProject({ name: "原著改编", style });
  project.chapters = [
    {
      id: "chapter-one",
      title: "第一章",
      content: "林晚在旧邮局收到一封信。陈渡说，信上的日期是明天。",
    },
  ];
  state.projects = [project];
  const model = await createLocalModel(t);
  model.bind(state);
  const workflow = createWorkflow({ getState: () => state, save() {} });
  t.after(workflow.close);
  async function idle() {
    await workflow.jobs.get(project.id)?.promise;
    assert.equal(project.running, false);
    return project;
  }
  function approve(extra = {}) {
    return workflow.approve(project, {
      approvalId: project.approval.id,
      decision: "approve",
      ...extra,
    });
  }
  return { state, project, workflow, idle, approve, requests: model.requests };
}

test("the analysis card reuses the project style and presents explicit, editable production suggestions", () => {
  const project = createProject({ name: "已选风格", style: "动态漫画", episodes: 20 });
  const approval = createApproval(project, project.nodes[0]);
  const values = Object.fromEntries(
    approval.fields.map((field) => [field.id, field.value]),
  );
  assert.deepEqual(values, {
    style: "动态漫画",
    durationSeconds: "90",
    aspectRatio: "9:16",
    platform: "抖音",
  });
  assert.ok(approval.fields.every((field) => field.required));
  assert.deepEqual(approval.nextStep, { name: "剧本改编", agentId: "writer" });
  assert.match(approval.description, /自动/);
  assert.equal(project.productionBrief, undefined);
  assert.equal(project.episodes, undefined);
});

test("structured approval saves the production brief and automatically advances only to the next human gate", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.equal(fx.project.approval.kind, "style");
  fx.approve({
    answers: {
      style: "动态漫画",
      durationSeconds: "120",
      aspectRatio: "16:9",
      platform: "哔哩哔哩",
    },
  });
  await fx.idle();
  assert.deepEqual(fx.project.productionBrief, {
    episodeCount: 1,
    durationSeconds: 120,
    aspectRatio: "16:9",
    platform: "哔哩哔哩",
  });
  assert.equal(fx.project.style, "动态漫画");
  assert.equal(fx.project.episodes, undefined);
  assert.equal(fx.project.nodes[0].status, "completed");
  assert.equal(fx.project.nodes[1].status, "waiting");
  assert.equal(fx.project.nodes[2].status, "pending");
  assert.equal(fx.project.approval.kind, "script");
  assert.doesNotMatch(fx.project.nodes[1].output, /第 2 集/);
  assert.doesNotMatch(fx.project.nodes[1].output, /第 3 集/);
  assert.match(fx.project.memory.summary, /本集 120 秒 · 16:9 · 哔哩哔哩/);
  assert.match(buildContext(fx.project).prompt, /用户已确认.*本集 120 秒/);

  fx.approve();
  await fx.idle();
  assert.equal(fx.project.approval.kind, "character");
  fx.approve();
  await fx.idle();
  assert.equal(fx.project.approval.kind, "storyboard");
  assert.match(fx.requests.at(-1).body.messages.at(-1).content, /本集 120 秒 · 16:9/);
});

test("invalid approval fields cannot partially mutate project settings or advance the workflow", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  const before = JSON.stringify(fx.project);
  for (const answers of [
    { style: "动态漫画", episodeCount: "0" },
    { episodeCount: "1.5" },
    { episodeCount: "61" },
    { episodeCount: "2" },
    { durationSeconds: "14" },
    { durationSeconds: "601" },
    { aspectRatio: "2:3" },
    { platform: "未知平台" },
    { style: "未知风格" },
    { episodeCount: 2 },
    { episodeCount: "" },
    { ignored: "value" },
    [],
    null,
  ]) {
    assert.throws(
      () => fx.approve({ answers }),
      (error) => error.status === 400,
    );
    assert.equal(JSON.stringify(fx.project), before);
  }
  assert.throws(() => validateBriefAnswers("not an object"), /JSON 对象/);
});

test("legacy style-only approvals retain compatibility and produce one suggested episode instead of the entire season", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  fx.approve({ value: "二次元动画" });
  await fx.idle();
  assert.equal(fx.project.style, "二次元动画");
  assert.deepEqual(fx.project.productionBrief, {
    episodeCount: 1,
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
  });
  assert.doesNotMatch(fx.project.nodes[1].output, /第 2 集/);
  assert.equal(fx.project.episodes, undefined);
  assert.deepEqual(
    confirmedBrief(fx.project).productionBrief,
    fx.project.productionBrief,
  );
});

test("old multi-episode settings are single-episode suggestions until approved, never silently reconfirmed", () => {
  const project = createProject({ name: "旧多集方案" });
  project.productionBrief = {
    episodeCount: 12,
    durationSeconds: 120,
    aspectRatio: "16:9",
    platform: "视频号",
  };
  project.memory.decisions = ["全剧规划24集，本轮确认12集"];
  const before = JSON.stringify(project);
  assert.equal(suggestedBrief(project).episodeCount, 1);
  const card = createApproval(project, project.nodes[0]);
  assert.ok(!card.fields.some((field) => field.id === "episodeCount"));
  const { prompt } = buildContext(project);
  assert.match(prompt, /待确认建议，不得视为用户决策.*本集 120 秒/);
  assert.match(prompt, /总集数、多集规划仅作历史记录，不约束当前任务/);
  assert.match(prompt, /当前提供原文只制作一集/);
  assert.equal(JSON.stringify(project), before);
  assert.equal(
    confirmedBrief(project, { episodeCount: "1" }).productionBrief.episodeCount,
    1,
  );
  assert.throws(() => confirmedBrief(project, { episodeCount: "12" }), /只制作一集/);
});

test("recent long chat proposals remain bounded, explicitly unconfirmed context for workflow recovery", () => {
  const project = createProject({ name: "旧项目" });
  project.messages.push(
    { agentId: "writer", type: "text", content: "较早提案".repeat(200) },
    { agentId: "producer", type: "text", content: "首集镜头依据".repeat(1600) },
    ...Array.from({ length: 12 }, (_, index) => ({
      agentId: "user",
      type: "text",
      content: `反馈 ${index}`,
    })),
  );
  compressMemory(project);
  const { prompt } = buildContext(project);
  assert.match(prompt, /未确认聊天提案（仅作创作参考，不作为锁定事实或审批结果/);
  assert.match(prompt, /首集镜头依据/);
  assert.doesNotMatch(prompt, /较早提案/);
  assert.match(prompt, /聊天提案超过预算/);
  assert.ok(prompt.length < 12000);
});

test("live workflow requests the same structured deliverables and pauses for an actual approval card", async (t) => {
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "## 原著要点\n\n首集以明日来信为钩子。\n\n## 制作建议\n\n沿用项目风格。",
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.close(resolve);
        upstream.closeAllConnections();
      }),
  );
  const fx = await fixture(t);
  fx.state.providers = [
    {
      id: "mock",
      kind: "text",
      protocol: "openai",
      enabled: true,
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      model: "test-model",
      apiKey: "",
    },
  ];
  fx.state.agents.find((agent) => agent.id === "producer").providerId = "mock";
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /使用简洁 Markdown/);
  assert.match(requests[0].messages[0].content, /不要只回复接单话术、问卷或计划/);
  assert.match(requests[0].messages[1].content, /待确认建议，不得视为用户决策/);
  assert.match(requests[0].messages[1].content, /已填项目风格应直接沿用/);
  assert.equal(fx.project.approval.kind, "style");
  assert.equal(fx.project.approval.fields.length, 4);
  assert.equal(fx.project.nodes[1].status, "pending");
});

test("workflow failure is attributed to its agent and node so the conversation can show a visible retry", async (t) => {
  const fx = await fixture(t);
  fx.state.agents.find((agent) => agent.id === "producer").providerId = "";
  fx.workflow.start(fx.project);
  await fx.idle();
  const failure = fx.project.messages.at(-1);
  assert.equal(failure.type, "error");
  assert.equal(failure.agentId, "producer");
  assert.equal(failure.nodeId, "analysis");
  assert.match(failure.content, /重试节点/);
  assert.equal(fx.project.nodes[0].status, "failed");
});

test("approval HTTP routes reject malformed answers and pass valid selections into automatic production", async (t) => {
  const state = createSeedState();
  const project = createProject({
    name: "接口确认测试",
    style: "动态漫画",
  });
  project.chapters = [
    { id: "one", title: "第一章", content: "林晚在旧邮局收到陈渡交来的信。" },
  ];
  state.projects = [project];
  (await createLocalModel(t)).bind(state);
  const store = createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({ store });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  const current = store.getState().projects[0];
  service.workflow.start(current);
  await service.workflow.jobs.get(current.id).promise;
  const approvalId = current.approval.id;
  const url = `http://127.0.0.1:${server.address().port}/api/projects/${current.id}/approval`;
  async function post(answers) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, decision: "approve", answers }),
    });
  }
  for (const answers of [
    [],
    { durationSeconds: 120 },
    { extra: "value" },
    { aspectRatio: "2:3" },
  ]) {
    const response = await post(answers);
    assert.equal(response.status, 400, JSON.stringify(await response.json()));
    assert.equal(current.approval.id, approvalId);
    assert.equal(current.productionBrief, undefined);
  }
  const response = await post({
    style: "国风动画",
    durationSeconds: "180",
    platform: "视频号",
  });
  assert.equal(response.status, 200);
  await service.workflow.jobs.get(current.id)?.promise;
  assert.equal(current.productionBrief.durationSeconds, 180);
  assert.equal(current.productionBrief.platform, "视频号");
  assert.equal(current.approval.kind, "script");
});
