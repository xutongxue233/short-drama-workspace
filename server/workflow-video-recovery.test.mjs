import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createProject, createSeedState } from "./seed.mjs";
import { createWorkflow } from "./workflow.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";

function videoProject() {
  const project = createProject({ name: "指定镜头恢复", style: "二次元动画" });
  project.materials = [];
  project.chapters = [{ id: "chapter", title: "片段", content: "长生站在门边。" }];
  project.productionBrief = {
    style: "二次元动画",
    aspectRatio: "9:16",
    durationSeconds: 90,
  };
  project.assets = [
    {
      id: "asset-lead",
      name: "长生",
      type: "character",
      version: 2,
      locked: true,
      tags: ["node:characters"],
      url: "https://example.test/lead.png",
      materialId: "material-lead",
      content: "长生的固定外观",
    },
    {
      id: "asset-board",
      name: "本集分镜",
      type: "storyboard",
      version: 1,
      locked: true,
      tags: ["node:storyboard"],
      content:
        "| 镜号 | 时间 | 时长 | 画面 | 出镜人物 | 制作方式 |\n|---|---|---|---|---|---|\n|01|0–3|3|全黑字卡|无|后期制作|\n|02|3–7|4|烛火晃动|无|模型生成|\n\n### 门边\n| 镜号 | 时间 | 时长 | 画面 | 出镜人物 |\n|---|---|---|---|---|\n|08|39–44|5|长生站在门边|长生 asset-lead / v2|",
    },
  ];
  for (const node of project.nodes) {
    if (node.id === "video") break;
    node.status = "completed";
  }
  project.nodes.find((node) => node.id === "video").status = "failed";
  return project;
}

test("invalid requested shots never mutate workflow state or invalidate approved assets", () => {
  const project = videoProject();
  const state = { ...createSeedState(), projects: [project] };
  const workflow = createWorkflow({ getState: () => state, save() {} });
  const before = JSON.stringify(project);
  for (const input of [
    { nodeId: "characters", shotId: "08" },
    { nodeId: "video", shotId: "01" },
    { shotId: "99" },
  ])
    assert.throws(() => workflow.start(project, input), /仅适用于|后期制作|未找到/);
  assert.equal(JSON.stringify(project), before);
});

test("an obsolete paid task blocks changed storyboards until explicit archival then permits a new generation", async (t) => {
  const model = await createLocalModel(t);
  const project = videoProject();
  project.assets.find((asset) => asset.type === "storyboard").version = 2;
  project.nodes.find((node) => node.id === "delivery").status = "completed";
  const state = { ...createSeedState(), projects: [project] };
  model.bind(state);
  const node = project.nodes.find((node) => node.id === "video");
  node.videoGeneration = {
    taskId: "old-paid-task",
    providerId: "previous-minimax-provider",
    baseUrl: "https://example.test",
    model: "MiniMax-H3",
    shotId: "08",
    requestKey: "storyboard-v1",
  };
  const saved = [];
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      saved.push(structuredClone(project));
    },
  });
  t.after(workflow.close);
  const run = async () => {
    workflow.start(project, { nodeId: "video", shotId: "08" });
    await workflow.jobs.get(project.id)?.promise;
  };
  await run();
  assert.equal(node.status, "failed");
  assert.match(node.error, /尚未取回/);
  assert.equal(model.requests.length, 0);
  workflow.archiveVideoTask(project, {
    taskId: "old-paid-task",
    acknowledgement: "archive-without-cancelling",
  });
  assert.equal(model.requests.length, 0);
  assert.ok(
    saved.some(
      (checkpoint) =>
        checkpoint.nodes.find((item) => item.id === "video").videoTaskHistory?.[0]
          ?.taskId === "old-paid-task",
    ),
  );
  await run();
  assert.equal(
    model.requests.filter((request) => request.path === "/videos").length,
    1,
  );
  const video = project.assets.find((asset) => asset.type === "video");
  assert.equal(video.videoShot.id, "08");
  assert.equal(video.videoShot.storyboardVersion, 2);
  assert.equal(node.videoTaskHistory[0].taskId, "old-paid-task");
});

test("MiniMax resumes transient failures but archives terminal failures before an explicit new generation", async (t) => {
  let project = videoProject();
  project.assets.find((asset) => asset.type === "storyboard").content +=
    `\n\n${"中段分镜细节。".repeat(1200)}\n\n| 镜号 | 起止秒数 | 时长 | 画面 |\n|---|---|---|---|\n|18|86–90秒|4秒|末镜完整标记：脖颈处斑块|`;
  const state = { ...createSeedState(), projects: [project] };
  const calls = [];
  let queryCount = 0;
  let taskCount = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({
      method: req.method,
      path: req.url,
      body: raw ? JSON.parse(raw) : null,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v2/video_generation") {
      taskCount++;
      return res.end(
        JSON.stringify({
          task_id: taskCount === 1 ? "persisted-mini-task" : "new-mini-task",
          base_resp: { status_code: 0 },
        }),
      );
    }
    if (req.url.startsWith("/v2/query/video_generation/")) {
      queryCount++;
      if (queryCount === 1) {
        res.statusCode = 503;
        return res.end(
          JSON.stringify({ error: { message: "Temporary query outage" } }),
        );
      }
      if (queryCount === 2)
        return res.end(
          JSON.stringify({
            task: {
              id: "persisted-mini-task",
              status: "failed",
              error: { message: "Generation failed" },
            },
            base_resp: { status_code: 0 },
          }),
        );
      return res.end(
        JSON.stringify({
          task: {
            id: "new-mini-task",
            status: "succeeded",
            duration: 5,
            ratio: "9:16",
            content: { url: "https://example.test/shot08.mp4" },
          },
          base_resp: { status_code: 0 },
        }),
      );
    }
    if (req.url === "/v1/chat/completions")
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "## 本轮资料包\n已保存镜头08，其余镜头与剪辑待制作。",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const videoProvider = {
    id: "video-provider",
    name: "MiniMax test",
    kind: "video",
    protocol: "minimax",
    model: "MiniMax-H3",
    baseUrl,
    apiKey: "fixture-key",
    enabled: true,
  };
  state.providers.push(videoProvider, {
    id: "text-provider",
    name: "Text test",
    kind: "text",
    protocol: "openai",
    model: "fixture-text",
    baseUrl: `${baseUrl}/v1`,
    apiKey: "fixture-key",
    enabled: true,
  });
  Object.assign(
    state.agents.find((agent) => agent.id === "video"),
    { providerId: "video-provider", model: "" },
  );
  Object.assign(
    state.agents.find((agent) => agent.id === "editor"),
    { providerId: "text-provider", model: "" },
  );
  const captures = [];
  const checkpoints = [];
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      const checkpoint = project.nodes.find(
        (node) => node.id === "video",
      ).videoGeneration;
      if (checkpoint) checkpoints.push(structuredClone(checkpoint));
    },
    materials: {
      references: (refs) => refs,
      async capture(activeProject, input) {
        captures.push(input);
        const material = {
          ...input,
          id: "material-shot08",
          status: "local",
          url: "/api/media/material-shot08/file",
        };
        activeProject.materials.push(material);
        return material;
      },
    },
  });
  t.after(workflow.close);
  const approvedBefore = JSON.stringify(project.assets);
  workflow.start(project, { nodeId: "video", shotId: "08" });
  const initialJob = workflow.jobs.get(project.id);
  for (let attempt = 0; attempt < 100 && !checkpoints.length; attempt++) await sleep(5);
  assert.ok(
    checkpoints.length,
    "remote task must be persisted before waiting for video generation",
  );
  workflow.stop(project);
  await initialJob.promise;
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(checkpoints.at(-1).taskId, "persisted-mini-task");
  assert.equal(checkpoints.at(-1).shotId, "08");
  assert.match(checkpoints.at(-1).requestKey, /^[a-f0-9]{64}$/u);
  project = JSON.parse(JSON.stringify(project));
  state.projects[0] = project;
  const pausedBefore = JSON.stringify(project);
  assert.throws(
    () => workflow.start(project, { nodeId: "video", shotId: "02" }),
    /请先取回该任务/,
  );
  assert.equal(JSON.stringify(project), pausedBefore);
  delete project.nodes.find((node) => node.id === "video").videoShotId;
  videoProvider.model = "MiniMax-H3-Max";
  workflow.start(project, { nodeId: "video" });
  await workflow.jobs.get(project.id)?.promise;
  assert.match(
    project.nodes.find((node) => node.id === "video").error,
    /已阻止重新提交/,
  );
  assert.equal(calls.length, 1);
  videoProvider.model = "MiniMax-H3";
  workflow.start(project, { nodeId: "video" });
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(project.nodes.find((node) => node.id === "video").status, "failed");
  assert.equal(
    project.nodes.find((node) => node.id === "video").videoGeneration.taskId,
    "persisted-mini-task",
  );
  workflow.start(project);
  await workflow.jobs.get(project.id)?.promise;
  const video = project.nodes.find((node) => node.id === "video");
  assert.equal(video.status, "failed");
  assert.equal(video.videoGeneration, undefined);
  assert.equal(video.videoTaskHistory.length, 1);
  assert.equal(video.videoTaskHistory[0].taskId, "persisted-mini-task");
  assert.equal(video.videoTaskHistory[0].status, "failed");
  assert.match(video.error, /将提交一个新任务/);
  assert.equal(
    taskCount,
    1,
    "terminal failures must not automatically submit another paid request",
  );
  assert.equal(captures.length, 0);
  workflow.start(project, { nodeId: "video" });
  const secondJob = workflow.jobs.get(project.id);
  for (
    let attempt = 0;
    attempt < 100 && video.videoGeneration?.taskId !== "new-mini-task";
    attempt++
  )
    await sleep(5);
  assert.equal(video.videoGeneration.taskId, "new-mini-task");
  workflow.stop(project);
  await secondJob.promise;
  workflow.start(project);
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(video.status, "completed", video.error);
  assert.equal(video.videoGeneration, undefined);
  assert.match(video.output, /指定镜头素材已生成/);
  assert.match(video.output, /不能视为整集完成/);
  assert.equal(project.approval.nodeId, "delivery");
  const deliveryRequest = calls.find((call) => call.path === "/v1/chat/completions");
  const deliveryPrompt = deliveryRequest.body.messages.at(-1).content;
  assert.ok(
    deliveryPrompt.includes(
      project.assets.find((asset) => asset.type === "storyboard").content,
    ),
  );
  assert.match(deliveryPrompt, /18\|86–90秒\|4秒\|末镜完整标记/);
  assert.equal(
    calls.filter((call) => call.path === "/v2/video_generation").length,
    2,
    "only an explicit retry after the terminal failure may create a second task",
  );
  assert.equal(calls.filter((call) => call.path.startsWith("/v2/query/")).length, 3);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].providerTaskId, "new-mini-task");
  assert.equal(captures[0].videoShot.id, "08");
  assert.deepEqual(
    captures[0].referenceAssets.map((ref) => ref.id),
    ["asset-lead"],
  );
  assert.equal(JSON.stringify(project.assets.slice(0, 2)), approvedBefore);
  const handoffs = project.messages.filter(
    (message) => message.event?.kind === "handoff",
  );
  assert.deepEqual(
    handoffs.map((message) => [message.event.fromNodeId, message.event.toNodeId]),
    [
      ["storyboard", "video"],
      ["video", "delivery"],
    ],
  );
  assert.ok(
    project.messages.some((message) => /正在取回已有视频任务/.test(message.content)),
  );
  const submitted = project.messages.filter(
    (message) => message.event?.phase === "video-task",
  );
  assert.equal(
    submitted.length,
    2,
    "task submission is recorded once per newly created remote task, never per poll or resume",
  );
  assert.match(submitted[0].content, /persisted-mini-task/);
  assert.match(submitted[1].content, /new-mini-task/);
  assert.equal(
    project.assets.find((asset) => asset.type === "video").materialId,
    "material-shot08",
  );
});
