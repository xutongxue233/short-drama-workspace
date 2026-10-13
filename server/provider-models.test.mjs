import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { discoverModels, modelListInput } from "./providers/models.mjs";
import { mountProviderRoutes } from "./routes/providers.mjs";

const SECRET = "model-list-private-key";
const providerFor = (baseUrl, extra = {}) => ({
  id: "provider-models",
  name: "模型发现测试",
  kind: "text",
  protocol: "openai",
  baseUrl,
  model: "saved-model",
  apiKey: SECRET,
  enabled: true,
  ...extra,
});

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

test("model discovery reads OpenAI models without generation, strips secrets and preserves unclassified aliases", async (t) => {
  let requests = 0;
  const baseUrl = await serve(t, (req, res) => {
    requests += 1;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    json(res, {
      data: [
        { id: "private-model-42", name: "工作室专用" },
        { id: "private-model-42", name: "重复" },
        { id: "explicit-text", output_modalities: ["text"] },
        { id: "explicit-audio", output_modalities: ["audio"] },
        { id: "explicit-image", output_modalities: ["image", "image"] },
        { id: "safe-id", display_name: `Echo ${SECRET}` },
        { id: `unsafe-${SECRET}` },
        { id: "" },
        { id: "a".repeat(201) },
        null,
        "not-a-model",
      ],
      private_debug: SECRET,
    });
  });
  const result = await discoverModels(providerFor(`${baseUrl}/v1`, { kind: "image" }));
  assert.equal(requests, 1);
  assert.equal(result.source, "remote");
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["private-model-42", "explicit-image", "safe-id"],
  );
  assert.deepEqual(result.models[1].kinds, ["image"]);
  assert.equal(result.models[0].name, "工作室专用");
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("Anthropic discovery follows documented cursors using server-side x-api-key", async (t) => {
  const paths = [];
  const baseUrl = await serve(t, (req, res) => {
    paths.push(req.url);
    assert.equal(req.method, "GET");
    assert.equal(req.headers["x-api-key"], SECRET);
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    assert.equal(req.headers.authorization, undefined);
    json(
      res,
      paths.length === 1
        ? {
            data: [{ id: "claude-first", display_name: "Claude One" }],
            has_more: true,
            last_id: "claude-first",
          }
        : {
            data: [{ id: "claude-second", display_name: "Claude Two" }],
            has_more: false,
          },
    );
  });
  const result = await discoverModels(
    providerFor(`${baseUrl}/v1`, { protocol: "anthropic" }),
  );
  assert.deepEqual(paths, [
    "/v1/models?limit=100",
    "/v1/models?limit=100&after_id=claude-first",
  ]);
  assert.deepEqual(result.models, [
    { id: "claude-first", name: "Claude One", kinds: ["text"] },
    { id: "claude-second", name: "Claude Two", kinds: ["text"] },
  ]);
});

test("discovery bounds rows and pagination, including repeated upstream cursors", async (t) => {
  let calls = 0;
  let mode = "repeat";
  const baseUrl = await serve(t, (_req, res) => {
    calls += 1;
    json(
      res,
      mode === "large"
        ? {
            data: Array.from({ length: 501 }, (_, index) => ({
              id: `model-${index}`,
            })),
          }
        : {
            data: [{ id: `model-${calls}` }],
            has_more: true,
            last_id: mode === "repeat" ? "same-cursor" : `cursor-${calls}`,
          },
    );
  });
  const provider = providerFor(baseUrl, { protocol: "anthropic" });
  const repeated = await discoverModels(provider);
  assert.equal(calls, 2);
  assert.equal(repeated.truncated, true);
  calls = 0;
  mode = "endless";
  assert.equal((await discoverModels(provider)).truncated, true);
  assert.equal(calls, 5);
  calls = 0;
  mode = "large";
  const large = await discoverModels(provider);
  assert.equal(large.models.length, 500);
  assert.equal(large.truncated, true);
  assert.equal(calls, 1);
});

test("discovery timeouts and cancellation describe a read-only request, without generation warnings", async (t) => {
  const baseUrl = await serve(t, () => {});
  await assert.rejects(
    discoverModels(providerFor(baseUrl), undefined, { timeoutMs: 20 }),
    /获取模型列表超时.*未执行生成/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discoverModels(providerFor(baseUrl), controller.signal),
    /模型列表查询已取消.*未执行生成/,
  );
});

test("discovery rejects redirects, redacts authentication errors, and never treats malformed data as a list", async (t) => {
  let mode = "error";
  let redirected = false;
  const destination = await serve(t, (_req, res) => {
    redirected = true;
    json(res, { data: [] });
  });
  const baseUrl = await serve(t, (_req, res) => {
    if (mode === "redirect") {
      res.writeHead(307, { Location: destination });
      res.end();
    } else if (mode === "malformed") json(res, { models: [] });
    else json(res, { error: { message: `Bad key ${SECRET}` } }, 401);
  });
  const provider = providerFor(baseUrl);
  await assert.rejects(discoverModels(provider), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes(SECRET));
    return true;
  });
  mode = "redirect";
  await assert.rejects(discoverModels(provider), /重定向/);
  assert.equal(redirected, false);
  mode = "malformed";
  await assert.rejects(discoverModels(provider), /data 数组/);
});

test("MiniMax uses documented models endpoint while presets stay explicitly distinct from account models", async (t) => {
  let calls = 0;
  let status = 200;
  let businessError = false;
  const baseUrl = await serve(t, (req, res) => {
    calls += 1;
    assert.equal(req.url, "/v1/models");
    assert.equal(req.method, "GET");
    json(
      res,
      businessError
        ? {
            data: [],
            base_resp: { status_code: 1004, status_msg: `Bad key ${SECRET}` },
          }
        : status === 200
          ? { data: [{ id: "MiniMax-M3" }] }
          : { error: { message: `Failure ${SECRET}` } },
      status,
    );
  });
  const provider = providerFor(baseUrl, {
    protocol: "minimax",
    kind: "image",
  });
  const preset = await discoverModels({ ...provider, apiKey: "" });
  assert.equal(calls, 0);
  assert.equal(preset.source, "preset");
  assert.deepEqual(
    preset.models.map((model) => model.id),
    ["image-01", "image-01-live"],
  );
  assert.match(preset.message, /并非账户可用模型列表/);
  const remote = await discoverModels(provider);
  assert.equal(remote.source, "remote");
  assert.equal(remote.models[0].id, "MiniMax-M3");
  assert.match(remote.message, /可能不包含全部图像/);
  status = 404;
  assert.equal((await discoverModels(provider)).source, "preset");
  status = 401;
  await assert.rejects(discoverModels(provider), /HTTP 401/);
  status = 200;
  businessError = true;
  await assert.rejects(discoverModels(provider), (error) => {
    assert.match(error.message, /1004/);
    assert.ok(!error.message.includes(SECRET));
    return true;
  });
});

test("Ark and Webhook return a truthful unsupported result without contacting generation addresses", async (t) => {
  let requests = 0;
  const baseUrl = await serve(t, (_req, res) => {
    requests += 1;
    json(res, { data: [] });
  });
  for (const protocol of ["ark", "webhook"]) {
    const result = await discoverModels(
      providerFor(baseUrl, { protocol, kind: "video" }),
    );
    assert.equal(result.source, "unsupported");
    assert.deepEqual(result.models, []);
  }
  assert.equal(requests, 0);
});

test("draft discovery never forwards a stored secret to a changed host, path or protocol", () => {
  const existing = providerFor("https://gateway.test/v1");
  for (const draft of [
    { baseUrl: "https://another.test/v1" },
    { baseUrl: "https://gateway.test/new-proxy/v1" },
    { baseUrl: "https://gateway.test/v1", protocol: "anthropic" },
  ])
    assert.throws(
      () => modelListInput({ providerId: existing.id, ...draft }, existing),
      /重新填写 API Key/,
    );
  const unchanged = modelListInput(
    { providerId: existing.id, baseUrl: "https://gateway.test/v1/", apiKey: "" },
    existing,
  );
  assert.equal(unchanged.apiKey, SECRET);
  const changed = modelListInput(
    { baseUrl: "https://new.test/v1", apiKey: "new-explicit-key" },
    existing,
  );
  assert.equal(changed.apiKey, "new-explicit-key");
  const cleared = modelListInput(
    { baseUrl: "https://new.test/v1", clearApiKey: true },
    existing,
  );
  assert.equal(cleared.apiKey, "");
  assert.equal(existing.apiKey, SECRET);
  assert.equal(existing.baseUrl, "https://gateway.test/v1");
});

test("saved and unsaved draft model discovery API stays read-only and never returns provider secrets", async (t) => {
  const received = [];
  const upstream = await serve(t, (req, res) => {
    received.push(req.headers.authorization);
    json(res, { data: [{ id: "listed-model" }] });
  });
  const provider = providerFor(`${upstream}/v1`);
  const state = { providers: [provider] };
  const before = JSON.stringify(state);
  let writes = 0;
  const app = express();
  app.use(express.json());
  const routes = mountProviderRoutes(app, {
    getState: () => state,
    save: () => {
      writes += 1;
    },
  });
  t.after(() => routes.close());
  const baseUrl = await serve(t, app);
  const query = (body) =>
    fetch(`${baseUrl}/api/providers/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const saved = await query({ providerId: provider.id });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).source, "remote");
  const draft = await query({
    kind: "image",
    protocol: "openai",
    baseUrl: `${upstream}/v1`,
    apiKey: "draft-secret",
  });
  assert.equal(draft.status, 200);
  const body = await draft.json();
  assert.deepEqual(body.models, [{ id: "listed-model", name: "listed-model" }]);
  assert.ok(!JSON.stringify(body).includes("draft-secret"));
  assert.deepEqual(received, [`Bearer ${SECRET}`, "Bearer draft-secret"]);
  const rejected = await query({
    providerId: provider.id,
    baseUrl: `${upstream}/other`,
  });
  assert.equal(rejected.status, 400);
  assert.equal(received.length, 2);
  assert.equal((await query({ providerId: "missing" })).status, 404);
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(state), before);
  routes.close();
  assert.equal((await query({ providerId: provider.id })).status, 503);
});

test("closing provider routes cancels an outstanding model-list read", async (t) => {
  let arrived;
  const requestArrived = new Promise((resolve) => {
    arrived = resolve;
  });
  const upstream = await serve(t, () => arrived());
  const provider = providerFor(upstream);
  const app = express();
  app.use(express.json());
  const routes = mountProviderRoutes(app, {
    getState: () => ({ providers: [provider] }),
    save() {
      assert.fail("Read-only discovery cannot save");
    },
  });
  t.after(() => routes.close());
  const baseUrl = await serve(t, app);
  const pending = fetch(`${baseUrl}/api/providers/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: provider.id }),
  });
  await requestArrived;
  routes.close();
  const response = await pending;
  assert.equal(response.status, 408);
  assert.match((await response.json()).error, /查询已取消/);
});
