import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createChatService } from "./services/chat.mjs";
import { createStore } from "./store.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";

async function fixture(t, options) {
  const state = createSeedState();
  const project = createProject({ name: "工作记录审计", style: "二次元动画" });
  project.chapters = [
    {
      id: "source",
      title: "第一段",
      content: "林晚在旧邮局收到一封信。陈渡说，信上的日期是明天。",
    },
  ];
  state.projects = [project];
  const model = await createLocalModel(t, options);
  model.bind(state);
  const workflow = createWorkflow({ getState: () => state, save() {} });
  t.after(workflow.close);
  const idle = async () => workflow.jobs.get(project.id)?.promise;
  const approve = (decision = "approve", extra = {}) =>
    workflow.approve(project, {
      approvalId: project.approval.id,
      decision,
      ...extra,
    });
  return { state, project, model, workflow, idle, approve };
}

const events = (project, nodeId) =>
  project.messages.filter(
    (message) => message.event && (!nodeId || message.nodeId === nodeId),
  );

test("execution, review, revision and downstream handoff preserve their actual order and identifiers", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  const firstApproval = fx.project.approval.id;
  assert.deepEqual(
    events(fx.project).map((message) => message.event.kind),
    ["start", "result", "approval_requested"],
  );
  fx.approve("revise", { feedback: "开场先展示失踪姐姐的信封" });
  await fx.idle();
  const revisedApproval = fx.project.approval.id;
  assert.notEqual(firstApproval, revisedApproval);
  assert.deepEqual(
    events(fx.project).map((message) => message.event.kind),
    [
      "start",
      "result",
      "approval_requested",
      "revision_requested",
      "start",
      "result",
      "approval_requested",
    ],
  );
  const firstRun = events(fx.project)[0].event.runId;
  const secondRun = events(fx.project)[4].event.runId;
  assert.notEqual(firstRun, secondRun);
  assert.ok(
    events(fx.project)
      .slice(0, 4)
      .every((message) => message.event.runId === firstRun),
  );
  assert.equal(events(fx.project)[3].event.approvalId, firstApproval);
  fx.approve();
  await fx.idle();
  const tail = events(fx.project).slice(7);
  assert.deepEqual(
    tail.map((message) => message.event.kind),
    ["approved", "handoff", "start", "result", "approval_requested"],
  );
  assert.equal(tail[0].event.approvalId, revisedApproval);
  assert.equal(tail[0].event.runId, secondRun);
  assert.deepEqual(tail[1].event, {
    kind: "handoff",
    scope: "workflow",
    runId: tail[2].event.runId,
    fromAgentId: "producer",
    toAgentId: "writer",
    fromNodeId: "analysis",
    toNodeId: "adaptation",
  });
  assert.equal(tail[1].nodeId, "adaptation");
  assert.match(fx.project.nodes[1].output, /开场先展示失踪姐姐的信封/);
});

test("automatic compliance completion is recorded before the character handoff without inventing approval", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  fx.approve();
  await fx.idle();
  fx.approve();
  await fx.idle();
  assert.deepEqual(
    events(fx.project, "compliance").map((message) => message.event.kind),
    ["handoff", "start", "result", "completed"],
  );
  const complianceEnd = fx.project.messages.findIndex(
    (message) => message.nodeId === "compliance" && message.event?.kind === "completed",
  );
  const characterHandoff = fx.project.messages.findIndex(
    (message) => message.nodeId === "characters" && message.event?.kind === "handoff",
  );
  assert.ok(complianceEnd < characterHandoff);
  assert.equal(fx.project.messages[characterHandoff].event.fromAgentId, "compliance");
  assert.equal(fx.project.approval.nodeId, "characters");
});

test("failed configuration records the attempted node but no successful handoff until a valid dispatch", async (t) => {
  const fx = await fixture(t);
  fx.workflow.start(fx.project);
  await fx.idle();
  fx.state.agents.find((agent) => agent.id === "writer").providerId = "missing";
  fx.approve();
  await fx.idle();
  const failed = events(fx.project, "adaptation");
  assert.deepEqual(
    failed.map((message) => message.event.kind),
    ["error"],
  );
  assert.ok(failed[0].event.runId);
  assert.equal(fx.project.nodes[1].startedAt, undefined);
  fx.state.agents.find((agent) => agent.id === "writer").providerId = "fixture-text";
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.deepEqual(
    events(fx.project, "adaptation").map((message) => message.event.kind),
    ["error", "handoff", "start", "result", "approval_requested"],
  );
  assert.notEqual(
    events(fx.project, "adaptation")[1].event.runId,
    failed[0].event.runId,
  );
});

test("missing approved storyboard records no video handoff and does not call the provider", async (t) => {
  const fx = await fixture(t);
  for (const node of fx.project.nodes.slice(0, 5)) node.status = "completed";
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.deepEqual(
    events(fx.project, "video").map((message) => message.event.kind),
    ["error"],
  );
  assert.equal(fx.model.requests.length, 0);
});

test("failed model output preserves its execution and a retry stays with the same receiving agent", async (t) => {
  let fail = true;
  const fx = await fixture(t, { respond: () => (fail ? "" : "修复后的本集产物") });
  fx.project.nodes[0].status = "completed";
  fx.workflow.start(fx.project);
  await fx.idle();
  const failed = events(fx.project, "adaptation");
  assert.deepEqual(
    failed.map((message) => message.event.kind),
    ["handoff", "start", "error"],
  );
  assert.equal(failed[1].event.runId, failed[2].event.runId);
  fail = false;
  fx.workflow.start(fx.project);
  await fx.idle();
  const log = events(fx.project, "adaptation");
  assert.deepEqual(
    log.map((message) => message.event.kind),
    ["handoff", "start", "error", "start", "result", "approval_requested"],
  );
  assert.notEqual(log[3].event.runId, failed[1].event.runId);
});

test("paused work retains its node and execution id and retry does not repeat the same handoff", async (t) => {
  const fx = await fixture(t, { delay: 60 });
  fx.project.nodes[0].status = "completed";
  fx.workflow.start(fx.project);
  for (
    let attempt = 0;
    attempt < 50 &&
    !events(fx.project, "adaptation").some((message) => message.event.kind === "start");
    attempt++
  )
    await sleep(5);
  const job = fx.workflow.jobs.get(fx.project.id);
  fx.workflow.stop(fx.project);
  await job.promise;
  assert.deepEqual(
    events(fx.project, "adaptation").map((message) => message.event.kind),
    ["handoff", "start", "paused"],
  );
  const pausedRun = events(fx.project, "adaptation")[2].event.runId;
  assert.equal(events(fx.project, "adaptation")[1].event.runId, pausedRun);
  fx.workflow.start(fx.project);
  await fx.idle();
  assert.deepEqual(
    events(fx.project, "adaptation").map((message) => message.event.kind),
    ["handoff", "start", "paused", "start", "result", "approval_requested"],
  );
  assert.notEqual(events(fx.project, "adaptation")[3].event.runId, pausedRun);
});

test("discussion execution and replies are auditable without becoming workflow handoffs", async (t) => {
  const fx = await fixture(t);
  const chat = createChatService({
    getState: () => fx.state,
    save() {},
    workflow: fx.workflow,
  });
  t.after(chat.close);
  const input = await chat.sendMessage(fx.project, {
    content: "请分析开场悬念",
    agentId: "writer",
    intent: "discussion",
  });
  const log = events(fx.project);
  assert.deepEqual(
    log.map((message) => message.event.kind),
    ["start", "result"],
  );
  assert.ok(
    log.every(
      (message) => message.event.scope === "chat" && message.replyTo === input.id,
    ),
  );
  assert.equal(log[0].event.runId, log[1].event.runId);
  assert.equal(fx.project.nodes[0].status, "pending");
});

test("process recovery keeps the interrupted node attribution without changing historical messages", () => {
  const state = createSeedState();
  const project = createProject({ name: "恢复日志" });
  state.projects = [project];
  project.running = true;
  project.nodes[0].status = "running";
  project.messages.push({
    id: "started",
    agentId: "producer",
    content: "开始",
    type: "system",
    nodeId: "analysis",
    createdAt: "2026-10-13T00:00:00Z",
    event: { kind: "start", scope: "workflow", runId: "run-one" },
  });
  const before = JSON.stringify(project.messages);
  const store = createStore({ filename: ":memory:", seed: () => state });
  try {
    assert.equal(JSON.stringify(project.messages.slice(0, -1)), before);
    assert.deepEqual(project.messages.at(-1).event, {
      kind: "paused",
      scope: "workflow",
      phase: "recovered",
      runId: "run-one",
    });
    assert.equal(project.messages.at(-1).nodeId, "analysis");
    assert.equal(project.nodes[0].status, "pending");
  } finally {
    store.close();
  }
});

test("closing a pending discussion persists its interruption before the store is released", async (t) => {
  const fx = await fixture(t, { delay: 60 });
  const saved = [];
  const chat = createChatService({
    getState: () => fx.state,
    save() {
      saved.push(JSON.stringify(fx.project.messages));
    },
    workflow: fx.workflow,
  });
  const sending = chat.sendMessage(fx.project, {
    content: "分析本集",
    agentId: "writer",
    intent: "discussion",
  });
  for (
    let attempt = 0;
    attempt < 50 &&
    !events(fx.project).some((message) => message.event.kind === "start");
    attempt++
  )
    await sleep(5);
  chat.close();
  await sending;
  const log = events(fx.project);
  assert.deepEqual(
    log.map((message) => message.event.kind),
    ["start", "paused"],
  );
  assert.equal(log[0].event.runId, log[1].event.runId);
  assert.equal(log[0].replyTo, log[1].replyTo);
  assert.equal(JSON.parse(saved.at(-1)).at(-1).event.kind, "paused");
});

test("abrupt restart closes a persisted discussion execution without fabricating a reply", () => {
  const state = createSeedState();
  const project = createProject({ name: "讨论恢复" });
  state.projects = [project];
  project.messages.push({
    id: "chat-start",
    agentId: "writer",
    content: "正在回复",
    type: "system",
    replyTo: "user-message",
    createdAt: "2026-10-13T00:00:00Z",
    event: { kind: "start", scope: "chat", runId: "chat-run" },
  });
  const before = JSON.stringify(project.messages);
  const store = createStore({ filename: ":memory:", seed: () => state });
  try {
    assert.equal(JSON.stringify(project.messages.slice(0, -1)), before);
    assert.deepEqual(project.messages.at(-1).event, {
      kind: "paused",
      scope: "chat",
      phase: "recovered",
      runId: "chat-run",
    });
    assert.equal(project.messages.at(-1).replyTo, "user-message");
    assert.equal(project.nodes[0].status, "pending");
  } finally {
    store.close();
  }
});
