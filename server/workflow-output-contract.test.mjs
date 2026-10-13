import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createApproval, OUTPUT_GUIDELINES, TASKS } from "./workflow/templates.mjs";

test("the model's advertised form fields match the actual approval card", () => {
  const project = createProject({ name: "提问与表单契约", style: "二次元动画" });
  const advertised = Array.from(
    OUTPUT_GUIDELINES.matchAll(/「([^」]+)」\(([a-zA-Z]+)\)/g),
    ([, label, id]) => ({ id, label }),
  );
  const analysisCard = createApproval(project, project.nodes[0]);
  assert.deepEqual(
    advertised,
    analysisCard.fields.map(({ id, label }) => ({ id, label })),
    "Model instructions must not invent fields or omit fields shown by the UI",
  );
  assert.match(OUTPUT_GUIDELINES, /可选的「补充要求」文本框/);
  assert.match(OUTPUT_GUIDELINES, /该框可留空，不是开始创作的前置条件/);
  for (const node of project.nodes.slice(1)) {
    const approval = createApproval(project, node);
    assert.equal(approval?.fields, undefined);
    assert.ok(TASKS[node.id], `Missing task instructions for ${node.id}`);
  }
  for (const id of ["compliance", "video"]) {
    assert.equal(
      createApproval(
        project,
        project.nodes.find((node) => node.id === id),
      ),
      null,
    );
    assert.match(TASKS[id], /本节点没有独立确认卡/);
  }
});

test("live analysis and adaptation receive the real form contract and confirmed creative decisions", async (t) => {
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "## 创作产物\n\n沿用已确认的创作取舍。" } }],
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
  const project = createProject({
    name: "审批提示回归",
    style: "二次元动画",
  });
  project.chapters = [
    {
      id: "chapter",
      title: "第一章",
      content: "长生听见屋外的铃声。家书中的数字与村人说法不一致。",
    },
  ];
  const state = createSeedState();
  state.projects = [project];
  state.providers = [
    {
      id: "mock-text",
      kind: "text",
      protocol: "openai",
      enabled: true,
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      model: "test-model",
      apiKey: "",
    },
  ];
  for (const agent of state.agents) agent.providerId = "mock-text";
  const workflow = createWorkflow({ getState: () => state, save() {} });
  t.after(workflow.close);
  workflow.start(project);
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(requests.length, 1);
  assert.equal(project.approval.kind, "style");
  assert.match(requests[0].messages[0].content, /不得虚构确认卡字段/);
  assert.match(requests[0].messages[1].content, /## 原文疑点与本轮处理/);
  assert.doesNotMatch(TASKS.analysis, /## 待核实项/);

  const feedback = "以剪影音效呈现，主角称长生，胎数不写台词。";
  workflow.approve(project, {
    approvalId: project.approval.id,
    decision: "approve",
    answers: {
      style: "二次元动画",
      episodeCount: "1",
      durationSeconds: "90",
      aspectRatio: "9:16",
      platform: "抖音",
    },
    feedback,
  });
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(requests.length, 2);
  assert.equal(project.approval.kind, "script");
  const [system, prompt] = requests[1].messages.map((message) => message.content);
  assert.match(system, /不把先前建议或旧疑点重新变成必答问题/);
  assert.match(system, /非必要数量冲突不写进对白或画面/);
  assert.match(system, /后续剧本、角色、分镜和交付确认卡只审核当前产物/);
  assert.ok(prompt.includes(feedback));
  assert.match(prompt, /用户已确认.*本集 90 秒 · 9:16 · 抖音/);
  assert.ok(prompt.includes(TASKS.adaptation));
  assert.equal(project.approval.fields, undefined);
});
