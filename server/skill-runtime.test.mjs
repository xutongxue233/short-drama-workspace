import test from "node:test";
import assert from "node:assert/strict";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createChatService } from "./services/chat.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";

function skill(id, overrides = {}) {
  return {
    id,
    name: id,
    description: `${id} 的创作说明`,
    instructions: `技能指令唯一标记【${id}】`,
    enabled: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function fixture(t, { characterKind = "text", respond } = {}) {
  const state = createSeedState();
  const project = createProject({ name: "技能调用测试", style: "二次元动画" });
  project.chapters = [
    {
      id: "source",
      title: "第一段",
      content: "林晚在旧邮局收到一封信。陈渡说，信上的日期是明天。",
    },
  ];
  state.projects = [project];
  state.skills = [];
  for (const agent of state.agents) {
    agent.enabled = true;
    agent.skillIds = [];
  }
  const model = await createLocalModel(t, { respond });
  model.bind(state, { characterKind });
  let saves = 0;
  const options = { getState: () => state, save: () => saves++ };
  const workflow = createWorkflow(options);
  const chat = createChatService({ ...options, workflow });
  t.after(() => {
    chat.close();
    workflow.close();
  });
  return {
    state,
    project,
    model,
    workflow,
    chat,
    saves: () => saves,
    agent: (id) => state.agents.find((agent) => agent.id === id),
    idle: () => workflow.jobs.get(project.id)?.promise,
    send: (input) => chat.sendMessage(project, input),
  };
}

test("chat applies bound and explicit skills once in user context and records actual versions", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("dialogue"), skill("hook", { version: 3 })];
  fx.agent("writer").skillIds = ["dialogue"];
  const message = await fx.send({
    agentId: "writer",
    content: "用 $dialogue 和 $hook 写开场。$hook",
    skillIds: ["hook", "dialogue"],
  });
  const request = fx.model.requests[0];
  assert.equal(fx.model.requests.length, 1);
  assert.equal(request.prompt.split("技能指令唯一标记【dialogue】").length, 2);
  assert.equal(request.prompt.split("技能指令唯一标记【hook】").length, 2);
  assert.doesNotMatch(request.body.messages[0].content, /技能指令唯一标记/);
  const expected = [
    { id: "dialogue", name: "dialogue", version: 1 },
    { id: "hook", name: "hook", version: 3 },
  ];
  const events = fx.project.messages.filter((item) => item.replyTo === message.id);
  assert.deepEqual(
    events.map((item) => item.event.kind),
    ["start", "result"],
  );
  for (const event of events) assert.deepEqual(event.event.skills, expected);
  assert.ok(fx.project.nodes.every((node) => node.status === "pending"));
});

test("invalid explicit skills reject before inviting, remembering, saving or generating", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("disabled", { enabled: false })];
  for (const input of [
    { skillIds: ["missing"] },
    { skillIds: ["disabled"] },
    { content: "$missing 请改对白" },
    { content: "$disabled 请改对白" },
    { skillIds: "disabled" },
    { skillIds: [null] },
  ]) {
    const before = JSON.stringify(fx.state);
    await assert.rejects(
      fx.send({ content: "请改对白", agentId: "writer", ...input }),
      (error) => error.status === 400 && /技能|Skill/.test(error.message),
    );
    assert.equal(JSON.stringify(fx.state), before);
    assert.equal(fx.saves(), 0);
  }
  assert.equal(fx.model.requests.length, 0);
});

test("disabled and missing bindings skip; explicit calls stay in discussion, including numeric names", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("disabled", { enabled: false }), skill("123")];
  fx.agent("producer").skillIds = ["disabled", "missing"];
  await fx.send({ content: "文字讨论成本 $500，标识 price$missing 和 \\$escaped。" });
  assert.equal(fx.project.messages.at(-1).event.skills, undefined);
  await fx.send({ content: "$123 开始制作" });
  assert.equal(fx.model.requests.length, 2);
  assert.match(fx.model.requests[1].prompt, /技能指令唯一标记【123】/);
  assert.deepEqual(fx.project.messages.at(-1).event.skills, [
    { id: "123", name: "123", version: 1 },
  ]);
  assert.ok(fx.project.nodes.every((node) => node.status === "pending"));
  assert.equal(fx.project.approval, null);
});

test("bound and explicit skill limits reject without saving a message", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = Array.from({ length: 9 }, (_, index) => skill(`skill-${index}`));
  fx.agent("producer").skillIds = fx.state.skills.slice(0, 8).map((item) => item.id);
  const before = JSON.stringify(fx.state);
  await assert.rejects(fx.send({ content: "$skill-8 请写开场" }), /最多使用 8/);
  assert.equal(JSON.stringify(fx.state), before);
  assert.equal(fx.saves(), 0);
});

test("edits during chat do not alter dispatched instructions or result usage snapshots", async (t) => {
  let received;
  const dispatched = new Promise((resolve) => {
    received = resolve;
  });
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const fx = await fixture(t, {
    async respond() {
      received();
      await pending;
      return "已按调用时的技能版本生成";
    },
  });
  t.after(release);
  fx.state.skills = [skill("dialogue")];
  fx.agent("writer").skillIds = ["dialogue"];
  const sending = fx.send({ agentId: "writer", content: "改写对白" });
  await dispatched;
  Object.assign(fx.state.skills[0], {
    name: "dialogue-updated",
    version: 2,
    instructions: "后续版本指令",
  });
  release();
  const message = await sending;
  assert.match(fx.model.requests[0].prompt, /技能指令唯一标记【dialogue】/);
  assert.doesNotMatch(fx.model.requests[0].prompt, /后续版本指令/);
  for (const event of fx.project.messages.filter((item) => item.replyTo === message.id))
    assert.deepEqual(event.event.skills, [
      { id: "dialogue", name: "dialogue", version: 1 },
    ]);
});

test("workflow text stages apply their bound skills and retain approval guardrails", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("analysis"), skill("dialogue")];
  fx.agent("producer").skillIds = ["analysis"];
  fx.agent("writer").skillIds = ["dialogue"];
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.match(fx.model.requests[0].prompt, /技能指令唯一标记【analysis】/);
  assert.doesNotMatch(fx.model.requests[0].prompt, /技能指令唯一标记【dialogue】/);
  assert.equal(fx.project.approval.nodeId, "analysis");
  assert.match(fx.model.requests[0].body.messages[0].content, /不得虚构确认卡字段/);
  fx.workflow.approve(fx.project, {
    approvalId: fx.project.approval.id,
    decision: "approve",
  });
  await fx.idle();
  assert.match(fx.model.requests[1].prompt, /技能指令唯一标记【dialogue】/);
  assert.equal(fx.project.approval.nodeId, "adaptation");
  for (const [nodeId, skillId] of [
    ["analysis", "analysis"],
    ["adaptation", "dialogue"],
  ]) {
    const events = fx.project.messages.filter(
      (message) =>
        message.nodeId === nodeId && ["start", "result"].includes(message.event?.kind),
    );
    assert.equal(events.length, 2);
    for (const message of events)
      assert.deepEqual(message.event.skills, [
        { id: skillId, name: skillId, version: 1 },
      ]);
  }
});

function startAtCharacters(fx) {
  for (const node of fx.project.nodes) {
    if (node.id === "characters") break;
    node.status = "completed";
    node.output = "林晚在旧邮局见到陈渡。";
  }
  fx.workflow.start(fx.project);
  return fx.idle();
}

test("character planner combines writer and designer bindings without injecting media prompts", async (t) => {
  const fx = await fixture(t, { characterKind: "image" });
  fx.state.skills = [skill("design"), skill("cast")];
  fx.agent("character").skillIds = ["design", "cast"];
  fx.agent("writer").skillIds = ["cast"];
  await startAtCharacters(fx);
  const planning = fx.model.requests.find(
    (request) => request.path === "/v1/chat/completions",
  );
  assert.match(planning.prompt, /技能指令唯一标记【design】/);
  assert.equal(planning.prompt.split("技能指令唯一标记【cast】").length, 2);
  const images = fx.model.requests.filter((request) => request.path === "/images");
  assert.equal(images.length, 2);
  for (const image of images)
    assert.doesNotMatch(JSON.stringify(image.body), /技能指令唯一标记/);
  assert.equal(fx.project.approval.nodeId, "characters");
  const result = fx.project.messages.findLast(
    (message) => message.event?.kind === "result",
  );
  assert.deepEqual(result.event.skills, [
    { id: "design", name: "design", version: 1 },
    { id: "cast", name: "cast", version: 1 },
  ]);
});

test("skill revisions invalidate a character planning checkpoint and reject stale approval", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("design")];
  fx.agent("character").skillIds = ["design"];
  await startAtCharacters(fx);
  const node = fx.project.nodes.find((item) => item.id === "characters");
  const key = node.characterGeneration.key;
  fx.state.skills[0].version = 2;
  fx.state.skills[0].instructions = "新版本的角色设计指令";
  const before = JSON.stringify(fx.project);
  assert.throws(
    () =>
      fx.workflow.approve(fx.project, {
        approvalId: fx.project.approval.id,
        decision: "approve",
      }),
    /变化|改变|变更/,
  );
  assert.equal(JSON.stringify(fx.project), before);
  const asset = fx.project.assets.find((item) => item.type === "character");
  const previous = structuredClone(asset);
  asset.content += "\n人工补充对白备注。";
  fx.workflow.reviewEditedAsset(fx.project, asset, previous);
  assert.equal(
    node.characterGeneration.key,
    key,
    "A manual copy edit must not revalidate a plan against unused skill revisions",
  );
  assert.throws(
    () =>
      fx.workflow.approve(fx.project, {
        approvalId: fx.project.approval.id,
        decision: "approve",
      }),
    /技能/,
  );
  fx.project.approval = null;
  node.status = "pending";
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.notEqual(node.characterGeneration.key, key);
  assert.equal(fx.model.requests.length, 2);
  assert.match(fx.model.requests[1].prompt, /新版本的角色设计指令/);
  assert.deepEqual(
    fx.project.messages.findLast((item) => item.event?.kind === "result").event.skills,
    [{ id: "design", name: "design", version: 2 }],
  );
});

test("video generation ignores skill bindings and preserves the approved shot request", async (t) => {
  const fx = await fixture(t);
  fx.state.skills = [skill("video-planning")];
  fx.agent("video").skillIds = ["video-planning"];
  fx.project.productionBrief = {
    style: "二次元动画",
    aspectRatio: "9:16",
    durationSeconds: 90,
  };
  fx.project.assets = [
    {
      id: "approved-storyboard",
      name: "本集分镜",
      type: "storyboard",
      version: 1,
      locked: true,
      tags: ["node:storyboard"],
      content:
        "| 镜号 | 时间 | 时长 | 画面 | 出镜人物 | 制作方式 |\n|---|---|---|---|---|---|\n|01|0–6|6|旧邮局信箱特写|无|模型生成|",
    },
  ];
  for (const node of fx.project.nodes)
    node.status = node.id === "video" ? "pending" : "completed";
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.equal(fx.model.requests.length, 1);
  assert.equal(fx.model.requests[0].path, "/videos");
  assert.doesNotMatch(JSON.stringify(fx.model.requests[0].body), /技能指令唯一标记/);
  assert.equal(
    fx.project.nodes.find((item) => item.id === "video").status,
    "completed",
  );
  for (const message of fx.project.messages.filter(
    (item) => item.event?.kind === "start" || item.event?.kind === "result",
  ))
    assert.equal(message.event.skills, undefined);
});
