import { authenticatedFetch } from "./test-support/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkflow } from "./workflow.mjs";
import { createApp } from "./app.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";
import { beginProjectTask } from "./services/project-tasks.mjs";
import { createMaterialService } from "./services/materials.mjs";

function stateFor(project) {
  return { ...createSeedState(), projects: [project] };
}

test("failed workflow startup restores state and object identity without leaving a phantom job", async () => {
  const project = createProject({ name: "failed start" });
  project.chapters.push({ id: "source", title: "片段", content: "原文" });
  project.nodes[0].status = "completed";
  project.nodes[1].status = "completed";
  const asset = {
    id: "asset-script",
    type: "script",
    name: "剧本",
    content: "正文",
    locked: true,
    version: 1,
    tags: ["node:adaptation"],
  };
  project.assets.push(asset);
  const state = stateFor(project);
  let failing = true;
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      if (failing) throw new Error("storage unavailable");
    },
  });
  const before = JSON.stringify(project);
  const node = project.nodes[1];
  assert.throws(
    () => workflow.start(project, { nodeId: "adaptation" }),
    /storage unavailable/,
  );
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.nodes[1], node);
  assert.equal(project.assets[0], asset);
  assert.equal(workflow.jobs.size, 0);
  failing = false;
  workflow.start(project, { nodeId: "adaptation" });
  await workflow.jobs.get(project.id)?.promise;
  assert.equal(project.running, false);
  workflow.close();
});

test("background checkpoint failures are handled instead of terminating the Node process", () => {
  const source = `
    import {createProject,createSeedState} from ${JSON.stringify(new URL("./seed.mjs", import.meta.url).href)};
    import {createWorkflow} from ${JSON.stringify(new URL("./workflow.mjs", import.meta.url).href)};
    const project=createProject({name:'failure'});
    project.chapters=[{title:'source',content:'fiction'}];
    const state={...createSeedState(),projects:[project]};let saves=0;
    const workflow=createWorkflow({getState:()=>state,save(){if(++saves>=3)throw new Error('final-save-failure');}});
    workflow.start(project);const promise=workflow.jobs.get(project.id).promise;
    await promise;
    if(project.running||workflow.jobs.size||!project.persistenceError)process.exitCode=2;
    console.log(project.persistenceError);
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /保存失败/);
  assert.doesNotMatch(child.stderr, /unhandled|final-save-failure/);
});

test("production cannot start while an image test owns the project", () => {
  const project = createProject({ name: "task guard" });
  project.chapters.push({ title: "source", content: "source" });
  const state = stateFor(project);
  const workflow = createWorkflow({ getState: () => state, save() {} });
  const release = beginProjectTask(project, "image-test");
  try {
    const before = JSON.stringify(project);
    assert.throws(() => workflow.start(project), /已有模型测试或其他任务/);
    assert.equal(JSON.stringify(project), before);
    assert.equal(workflow.jobs.size, 0);
  } finally {
    release();
    workflow.close();
  }
});

test("approval restores unsaved edits but retains a committed approval when subsequent startup fails", () => {
  const project = createProject({ name: "approval save failure" });
  project.chapters.push({ title: "source", content: "source" });
  const node = project.nodes.find((item) => item.id === "adaptation");
  project.nodes[0].status = "completed";
  node.status = "waiting";
  const approval = { id: "approve-script", nodeId: node.id, kind: "script" };
  project.approval = approval;
  const asset = {
    id: "script",
    type: "script",
    name: "剧本",
    version: 1,
    locked: false,
    tags: ["node:adaptation", "待确认"],
  };
  project.assets.push(asset);
  const state = stateFor(project);
  let saves = 0;
  let failAt = 1;
  let durable;
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      if (++saves === failAt) throw new Error("checkpoint unavailable");
      durable = structuredClone(project);
    },
  });
  const input = { approvalId: approval.id, decision: "approve", feedback: "已核对" };
  const before = JSON.stringify(project);
  assert.throws(() => workflow.approve(project, input), /checkpoint unavailable/);
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.approval, approval);
  assert.equal(project.assets[0], asset);
  assert.equal(workflow.jobs.size, 0);
  saves = 0;
  failAt = 2;
  assert.equal(workflow.approve(project, input), project);
  assert.equal(project.approval, null);
  assert.equal(project.running, false);
  assert.equal(asset.locked, true);
  assert.equal(durable.approval, null);
  assert.equal(durable.assets[0].locked, true);
  assert.equal(workflow.jobs.size, 0);
  assert.match(project.persistenceError, /本次确认已保存.*无需重复确认/);
  assert.throws(() => workflow.approve(project, input), /确认事项已更新/);
  workflow.close();
});

test("workflow shutdown aborts every project even when each checkpoint save fails", async (t) => {
  const model = await createLocalModel(t);
  const projects = [createProject({ name: "one" }), createProject({ name: "two" })];
  for (const project of projects)
    project.chapters.push({ title: "source", content: "source" });
  const state = { ...createSeedState(), projects };
  model.bind(state);
  let failing = false;
  const workflow = createWorkflow({
    getState: () => state,
    save() {
      if (failing) throw new Error("shutdown save failed");
    },
  });
  for (const project of projects) workflow.start(project);
  const jobs = [...workflow.jobs.values()];
  failing = true;
  assert.throws(() => workflow.close(), AggregateError);
  assert.ok(jobs.every((job) => job.controller.signal.aborted));
  assert.ok(projects.every((project) => !project.running));
  assert.equal(workflow.jobs.size, 0);
  await Promise.all(jobs.map((job) => job.promise));
});

async function imageFixture(t, { holdDownload = false, actualMaterials = false } = {}) {
  const model = await createLocalModel(t, {
    respond: () =>
      JSON.stringify({
        characters: [
          {
            name: "林晚",
            description: "原文人物",
            appearance: "黑发蓝衣",
            sourceEvidence: "林晚走入邮局。",
          },
        ],
      }),
  });
  const project = createProject({ name: "image recovery" });
  project.chapters = [{ id: "source", title: "片段", content: "林晚走入邮局。" }];
  project.materials = [];
  for (const node of project.nodes)
    if (node.id !== "characters") {
      node.status = "completed";
      node.output = "已确认";
    }
  const state = stateFor(project);
  state.providers = [
    {
      id: "text",
      name: "fixture",
      kind: "text",
      protocol: "openai",
      enabled: true,
      model: "fixture",
      baseUrl: `${model.baseUrl}/v1`,
    },
    {
      id: "image",
      name: "fixture",
      kind: "image",
      protocol: "webhook",
      enabled: true,
      model: "fixture",
      baseUrl: `${model.baseUrl}/images`,
    },
  ];
  state.agents.find((agent) => agent.id === "writer").providerId = "text";
  state.agents.find((agent) => agent.id === "character").providerId = "image";
  let firstDownload = true;
  let entered;
  const downloading = new Promise((resolve) => {
    entered = resolve;
  });
  const saved = [];
  let failGeneratedSave = false;
  const save = () => {
    const current = state.projects[0];
    if (
      failGeneratedSave &&
      current.nodes
        .find((node) => node.id === "characters")
        .characterGeneration?.images?.some((image) => image.result?.url)
    )
      throw new Error("image checkpoint unavailable");
    saved.push(structuredClone(current));
  };
  const directory = actualMaterials
    ? await mkdtemp(join(tmpdir(), "workflow-image-recovery-"))
    : undefined;
  const materialService = actualMaterials
    ? createMaterialService({
        getState: () => state,
        save,
        dataDir: directory,
        async fetch(_url, { signal }) {
          if (holdDownload && firstDownload) {
            firstDownload = false;
            entered();
            await new Promise((_, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              }),
            );
          }
          return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        },
      })
    : undefined;
  const workflow = createWorkflow({
    getState: () => state,
    save,
    materials: {
      references: (refs) => refs,
      async capture(current, input, signal) {
        const image = current.nodes.find((node) => node.id === "characters")
          .characterGeneration.images[0];
        assert.equal(image.captureId, input.captureId);
        assert.ok(
          saved.some((snapshot) =>
            snapshot.nodes
              .find((node) => node.id === "characters")
              .characterGeneration?.images?.some(
                (item) => item.captureId === input.captureId && item.result?.url,
              ),
          ),
        );
        if (materialService) return materialService.capture(current, input, signal);
        let material = current.materials.find((item) => item.id === input.captureId);
        if (!material) {
          material = { id: input.captureId, url: input.url, status: "remote" };
          current.materials.push(material);
        }
        if (holdDownload && firstDownload) {
          firstDownload = false;
          entered();
          await new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
          material.status = "failed";
        } else {
          material.status = "local";
          material.url = `/api/media/${material.id}/file`;
        }
        return material;
      },
    },
  });
  t.after(async () => {
    failGeneratedSave = false;
    workflow.close();
    materialService?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  return {
    state,
    workflow,
    model,
    saved,
    downloading,
    setSaveFailure(value) {
      failGeneratedSave = value;
    },
    async run() {
      const current = state.projects[0];
      workflow.start(current, { nodeId: "characters" });
      await workflow.jobs.get(current.id)?.promise;
    },
  };
}

test("paused image download recovers its saved result after restart without another paid image request", async (t) => {
  const fx = await imageFixture(t, { holdDownload: true, actualMaterials: true });
  const running = fx.run();
  await fx.downloading;
  fx.workflow.stop(fx.state.projects[0]);
  await running;
  fx.state.projects[0] = structuredClone(fx.state.projects[0]);
  await fx.run();
  const project = fx.state.projects[0];
  assert.equal(
    fx.model.requests.filter((request) => request.path === "/images").length,
    1,
  );
  assert.equal(project.materials.length, 1);
  assert.equal(project.approval.kind, "character");
  assert.equal(
    project.assets.find((asset) => asset.type === "character").materialId,
    project.materials[0].id,
  );
});

test("a returned image survives checkpoint save failure and retries storage instead of image generation", async (t) => {
  const fx = await imageFixture(t);
  fx.setSaveFailure(true);
  await fx.run();
  const project = fx.state.projects[0];
  assert.equal(project.running, false);
  assert.match(project.persistenceError, /保存失败/);
  assert.equal(project.materials.length, 0);
  fx.setSaveFailure(false);
  await fx.run();
  assert.equal(
    fx.model.requests.filter((request) => request.path === "/images").length,
    1,
  );
  assert.equal(project.approval.kind, "character");
});

test("an image dispatch without a saved result requires explicit durable archival before generating again", async (t) => {
  const fx = await imageFixture(t);
  fx.setSaveFailure(true);
  await fx.run();
  fx.setSaveFailure(false);
  // Restore the last successful disk checkpoint, before the provider result was saved.
  fx.state.projects[0] = structuredClone(fx.saved.at(-1));
  const project = fx.state.projects[0];
  project.running = false;
  const node = project.nodes.find((item) => item.id === "characters");
  node.status = "pending";
  const image = node.characterGeneration.images[0];
  assert.equal(image.status, "submitted");
  await fx.run();
  assert.match(node.error, /不能自动重复生图/);
  assert.equal(
    fx.model.requests.filter((request) => request.path === "/images").length,
    1,
  );
  assert.throws(
    () => fx.workflow.archiveImageTask(project, { captureId: image.captureId }),
    /明确确认/,
  );
  fx.workflow.archiveImageTask(project, {
    captureId: image.captureId,
    acknowledgement: "new-image-may-charge",
  });
  assert.equal(node.imageTaskHistory[0].captureId, image.captureId);
  assert.equal(node.imageTaskHistory[0].status, "abandoned");
  await fx.run();
  assert.equal(
    fx.model.requests.filter((request) => request.path === "/images").length,
    2,
  );
});

test("video task archival rejects stale IDs, rolls back failed saves, and never submits a new task itself", async (t) => {
  const project = createProject({ name: "video archive" });
  const node = project.nodes.find((item) => item.id === "video");
  node.videoGeneration = {
    taskId: "paid-old-task",
    shotId: "01",
    model: "MiniMax-H3",
    providerId: "old",
    baseUrl: "https://example.test",
    requestKey: "previous-board-key",
  };
  node.status = "failed";
  const state = stateFor(project);
  let failed = true;
  const runtime = createApp({
    store: {
      getState: () => state,
      save() {
        if (failed) throw new Error("save failed");
      },
      close() {},
    },
  });
  const server = await new Promise((resolve) => {
    const listener = runtime.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    failed = false;
    runtime.close();
    await new Promise((resolve) => server.close(resolve));
  });
  failed = false;
  const { fetch } = await authenticatedFetch(
    `http://127.0.0.1:${server.address().port}`,
  );
  failed = true;
  const archive = async (body) =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/video-task/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  const before = JSON.stringify(project);
  const invitation = await fetch(
    `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "writer" }),
    },
  );
  assert.equal(invitation.status, 500);
  assert.equal(JSON.stringify(project), before);
  assert.equal((await archive({ taskId: "paid-old-task" })).status, 400);
  assert.equal(
    (await archive({ taskId: "stale", acknowledgement: "archive-without-cancelling" }))
      .status,
    409,
  );
  assert.equal(
    (
      await archive({
        taskId: "paid-old-task",
        acknowledgement: "archive-without-cancelling",
      })
    ).status,
    500,
  );
  assert.equal(JSON.stringify(project), before);
  failed = false;
  assert.equal(
    (
      await archive({
        taskId: "paid-old-task",
        acknowledgement: "archive-without-cancelling",
      })
    ).status,
    200,
  );
  assert.equal(node.videoGeneration, undefined);
  assert.equal(node.videoTaskHistory[0].taskId, "paid-old-task");
  assert.equal(node.videoTaskHistory[0].requestKey, "previous-board-key");
  assert.equal(node.videoTaskHistory[0].status, "abandoned");
  assert.equal(project.running, false);
  assert.equal(runtime.workflow.jobs.size, 0);
  assert.match(project.messages.at(-1).content, /供应商任务未被取消/);
});
