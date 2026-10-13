import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./app.mjs";
import { createSeedState, createProject } from "./seed.mjs";

async function fixture(t, kind = "text") {
  const dataDir = await mkdtemp(join(tmpdir(), "project-concurrency-"));
  const state = createSeedState();
  const project = createProject({ name: "Concurrency fixture" });
  state.projects = [project];
  project.nodes.forEach((node) => {
    node.status = "completed";
  });
  state.providers = [
    {
      id: "mock",
      name: "Mock",
      kind,
      protocol: "openai",
      baseUrl: "https://audit.invalid/v1",
      model: "mock",
      enabled: true,
      apiKey: "",
    },
  ];
  state.agents.forEach((agent) => {
    agent.providerId = "mock";
  });
  let saveFails = false,
    storeClosed = false,
    upstreamSignal,
    release,
    enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => {
    if (!String(url).startsWith("https://audit.invalid/"))
      return originalFetch(url, options);
    upstreamSignal = options.signal;
    enter();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), {
        once: true,
      });
      release = () =>
        resolve(
          new Response(
            JSON.stringify(
              kind === "text"
                ? { choices: [{ message: { content: "Discussion reply" } }] }
                : {
                    data: [
                      {
                        b64_json:
                          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
                      },
                    ],
                  },
            ),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
    });
  });
  const service = createApp({
    config: { dataDir, distDir: join(dataDir, "absent") },
    store: {
      getState: () => state,
      save() {
        if (saveFails) throw new Error("SQLITE_FULL");
      },
      close() {
        storeClosed = true;
      },
    },
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    saveFails = false;
    service.close();
    release?.();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    originalFetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    project,
    service,
    post,
    entered,
    release: () => release(),
    fail: () => {
      saveFails = true;
    },
    isClosed: () => storeClosed,
    signal: () => upstreamSignal,
    state: () => originalFetch(`${url}/api/state`).then((response) => response.json()),
  };
}

test("chapter imports cannot invalidate the context of an in-flight discussion", async (t) => {
  const fx = await fixture(t);
  const pending = fx.post(`/api/projects/${fx.project.id}/messages`, {
    content: "讨论人物关系",
    intent: "discussion",
  });
  await fx.entered;
  const before = structuredClone(fx.project.chapters);
  assert.equal(
    (
      await fx.post(`/api/projects/${fx.project.id}/chapters`, {
        title: "新原文",
        content: "不同的剧情",
      })
    ).status,
    409,
  );
  assert.deepEqual(fx.project.chapters, before);
  fx.release();
  assert.equal((await pending).status, 201);
});

test("image tests block archive, imports, chat and workflow until the result belongs to the original episode", async (t) => {
  const fx = await fixture(t, "image");
  const pending = fx.post("/api/providers/mock/image-test", {
    projectId: fx.project.id,
    model: "mock",
    prompt: "本集图片",
  });
  await fx.entered;
  assert.equal((await fx.state()).projects[0].backgroundTask, "image-test");
  for (const [path, body] of [
    ["episodes", {}],
    ["chapters", { title: "下一集", content: "新原文" }],
    ["messages", { content: "讨论", intent: "discussion" }],
  ])
    assert.equal(
      (await fx.post(`/api/projects/${fx.project.id}/${path}`, body)).status,
      409,
    );
  assert.throws(
    () => fx.service.workflow.start(fx.project),
    (error) => error.status === 409,
  );
  fx.release();
  assert.equal((await pending).status, 200);
  assert.equal(fx.project.currentEpisode.number, 1);
  assert.equal(fx.project.materials.length, 1);
  assert.equal((await fx.state()).projects[0].backgroundTask, null);
  assert.equal(
    (await fx.post(`/api/projects/${fx.project.id}/episodes`, {})).status,
    201,
  );
  assert.equal(fx.project.episodeArchive[0].materials.length, 1);
});

test("shutdown aborts jobs and closes the store even when saving chat interruption fails", async (t) => {
  const fx = await fixture(t);
  const pending = fx.post(`/api/projects/${fx.project.id}/messages`, {
    content: "讨论剧情",
    intent: "discussion",
  });
  await fx.entered;
  fx.fail();
  assert.throws(() => fx.service.close(), AggregateError);
  assert.equal(fx.signal().aborted, true);
  assert.equal(fx.isClosed(), true);
  assert.doesNotThrow(() => fx.service.close());
  await pending;
});
