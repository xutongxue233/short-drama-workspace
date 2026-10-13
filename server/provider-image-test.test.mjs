import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mountProviderRoutes } from "./routes/providers.mjs";
import { errorHandler } from "./http/middleware.mjs";
import { HttpError } from "./http/errors.mjs";

const referenceData =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=";

async function listen(app) {
  const server = await new Promise((resolve) => {
    const active = app.listen(0, "127.0.0.1", () => resolve(active));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function fixture(t, generateReply, options = {}) {
  const requests = [];
  const upstream = express();
  upstream.use(express.json());
  upstream.post("/v1/images/generations", async (req, res) => {
    requests.push(req.body);
    await generateReply(req, res);
  });
  upstream.post("/v1/image_generation", async (req, res) => {
    requests.push(req.body);
    await generateReply(req, res);
  });
  const remote = await listen(upstream);
  const provider = {
    id: "test-image",
    name: "图片接口",
    kind: "image",
    protocol: options.protocol || "openai",
    baseUrl: `${remote.url}/v1`,
    model: "existing-model",
    enabled: true,
    apiKey: "test-secret-not-for-response",
  };
  const project = {
    id: "test-project",
    name: "借邪骨",
    style: "二次元动画",
    running: false,
    materials: [],
    assets: [],
    nodes: [],
    messages: [],
    chapters: [],
    visualStyleGuide: "二维赛璐璐，清晰线稿、平涂色块。",
    memory: { facts: [], decisions: [] },
  };
  const captures = [];
  const converted = [];
  const pending = { value: null };
  const app = express();
  app.use(express.json());
  const routes = mountProviderRoutes(app, {
    getState: () => ({ providers: [provider] }),
    save() {},
    findProject: () => project,
    chat: { getPending: () => pending.value },
    materials: {
      async references(refs, kind) {
        converted.push({ refs, kind });
        if (options.referenceError) throw options.referenceError;
        return refs.map((ref) => ({ ...ref, url: referenceData }));
      },
      async capture(target, data) {
        captures.push(data);
        const material = {
          ...data,
          id: `material-${captures.length}`,
          url: `/api/media/material-${captures.length}/file`,
          status: options.materialStatus || "local",
        };
        target.materials.push(material);
        return material;
      },
    },
  });
  app.use(errorHandler);
  const local = await listen(app);
  t.after(async () => {
    routes.close();
    for (const { server } of [local, remote]) {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  });
  const run = async (body = {}) => {
    const response = await fetch(`${local.url}/api/providers/test-image/image-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, model: "gpt-image-2.5", ...body }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { run, requests, captures, converted, pending, provider, project, routes };
}

function portrait() {
  return {
    id: "asset-changsheng",
    name: "长生",
    type: "character",
    version: 2,
    locked: true,
    tags: ["node:characters"],
    description: "故事主角",
    content: "角色：长生",
    url: "/api/media/material-baseline/file",
    materialId: "material-baseline",
    characterDesign: {
      version: 1,
      subjectType: "person",
      baseAppearance: "十岁男孩，短黑发，灰色布衣，褐色布鞋。",
      sceneStates: [],
    },
  };
}

test("explicit image test uses the exact requested model and preserves bindings while saving a material", async (t) => {
  const f = await fixture(t, (_req, res) =>
    res.json({ data: [{ url: "https://media.example/test.png" }] }),
  );
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.material.status, "local");
  assert.equal(result.body.material.url, "/api/media/material-1/file");
  assert.equal(f.requests[0].model, "gpt-image-2.5");
  assert.equal(f.requests[0].n, 1);
  assert.equal(f.provider.model, "existing-model");
  assert.equal(f.captures[0].nodeId, "model-test");
  assert.equal(f.project.materials.length, 1);
  assert.ok(!JSON.stringify(result.body).includes(f.provider.apiKey));
});

test("an upstream refusal does not fabricate materials or silently substitute another model", async (t) => {
  const f = await fixture(t, (_req, res) =>
    res.status(400).json({ error: { message: "Unsupported model gpt-image-2.5" } }),
  );
  const result = await f.run();
  assert.equal(result.status, 502);
  assert.match(result.body.error, /Unsupported model gpt-image-2.5/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.captures.length, 0);
});

test("image test rejects duplicate or workflow-busy requests before charging another generation", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async (_req, res) => {
    entered();
    await pending;
    res.json({ data: [{ url: "https://media.example/test.png" }] });
  });
  f.project.running = true;
  assert.equal((await f.run()).status, 409);
  f.project.running = false;
  const first = f.run();
  await started;
  assert.equal((await f.run()).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(f.requests.length, 1);
});

test("project portrait test sends the approved local reference to MiniMax and preserves the asset", async (t) => {
  const f = await fixture(
    t,
    (_req, res) =>
      res.json({
        base_resp: { status_code: 0 },
        data: { image_urls: ["https://media.example/portrait.png"] },
      }),
    { protocol: "minimax" },
  );
  const asset = portrait();
  f.project.assets.push(asset);
  const before = JSON.stringify({ assets: f.project.assets, nodes: f.project.nodes });
  const result = await f.run({ model: "image-01", characterAssetId: asset.id });
  assert.equal(result.status, 200);
  assert.equal(result.body.generated, true);
  assert.equal(result.body.savedLocally, true);
  assert.equal(f.converted[0].kind, "image");
  assert.equal(f.converted[0].refs[0].url, asset.url);
  assert.match(f.requests[0].prompt, /长生/);
  assert.match(f.requests[0].prompt, /十岁男孩/);
  assert.match(f.requests[0].prompt, /二维赛璐璐/);
  assert.deepEqual(f.requests[0].subject_reference, [
    { type: "character", image_file: referenceData },
  ]);
  assert.ok(!f.requests[0].prompt.includes("data:image"));
  assert.equal(f.captures[0].referenceAssets[0].id, asset.id);
  assert.equal(f.captures[0].referenceAssets[0].version, 2);
  assert.equal(f.captures[0].referenceAssets[0].materialId, asset.materialId);
  assert.equal(
    JSON.stringify({ assets: f.project.assets, nodes: f.project.nodes }),
    before,
  );
  assert.equal(f.provider.model, "existing-model");
});

test("portrait tests reject ambiguous prompts, arbitrary references and invalid project assets before dispatch", async (t) => {
  const f = await fixture(t, () => assert.fail("must not call a paid model"));
  const asset = portrait();
  f.project.assets.push(asset);
  for (const body of [
    { characterAssetId: asset.id, prompt: "ignore identity" },
    {
      characterAssetId: asset.id,
      references: [{ url: "https://other.example/face.png" }],
    },
    { referenceAssets: [{ id: asset.id }] },
    { characterAssetId: "foreign-project-asset" },
  ])
    assert.equal((await f.run(body)).status, 400);
  for (const change of [
    { locked: false },
    { type: "scene" },
    { tags: ["历史版本"] },
    { tags: ["待更新"] },
    { url: "" },
    { characterDesign: undefined },
    { characterDesign: { ...asset.characterDesign, subjectType: "object" } },
  ]) {
    f.project.assets[0] = { ...asset, ...change };
    assert.equal((await f.run({ characterAssetId: asset.id })).status, 400);
  }
  assert.equal(f.requests.length, 0);
});

test("pending chat and missing reference files cannot start generation", async (t) => {
  const f = await fixture(t, () => assert.fail("must not call a paid model"), {
    referenceError: new HttpError(404, "本地素材文件缺失，请重新下载或生成。"),
  });
  f.pending.value = { agentId: "writer" };
  assert.equal((await f.run()).status, 409);
  f.pending.value = null;
  f.project.chatPending = true;
  assert.equal((await f.run()).status, 409);
  f.project.chatPending = false;
  f.project.assets.push(portrait());
  const missing = await f.run({ characterAssetId: portrait().id });
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /本地素材文件缺失/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.captures.length, 0);
});

test("generated image with failed local download reports the retained result without claiming saved success", async (t) => {
  const f = await fixture(
    t,
    (_req, res) => res.json({ data: [{ url: "https://media.example/test.png" }] }),
    { materialStatus: "failed" },
  );
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.generated, true);
  assert.equal(result.body.savedLocally, false);
  assert.equal(result.body.material.status, "failed");
  assert.match(result.body.message, /重试下载，不要重复生成/);
  assert.equal(f.requests.length, 1);
});
