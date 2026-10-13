import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { generate, mountProviderRoutes } from "./providers.mjs";

const SECRET = "native-secret-never-public";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII=";
const SEEDREAM = "doubao-seedream-5-0-pro-260628";
const SEEDANCE = "doubao-seedance-2-5-260628";
const providerFor = (baseUrl, extra = {}) => ({
  id: "native",
  name: "Native provider",
  kind: "text",
  protocol: "anthropic",
  model: "claude-sonnet-5-5",
  apiKey: SECRET,
  baseUrl,
  enabled: true,
  ...extra,
});
const call = (provider, extra = {}) =>
  generate({
    provider,
    kind: provider.kind,
    prompt: "人物在雨中重逢",
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
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function respond(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
async function routes(t) {
  const app = express();
  app.use(express.json());
  const state = { providers: [], agents: [] };
  mountProviderRoutes(app, { getState: () => state, save: () => {} });
  const base = await serve(t, app);
  return async (path, body) => {
    const response = await fetch(`${base}/api/providers${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  };
}

test("Claude uses native auth and system field, parses only text blocks and redacts output", async (t) => {
  let request;
  const base = await serve(t, async (req, res) => {
    request = {
      headers: req.headers,
      path: req.url,
      body: await readBody(req),
    };
    respond(res, {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: `剧本一 ${SECRET}` },
        { type: "text", text: "剧本二" },
      ],
    });
  });
  const result = await call(providerFor(`${base}/v1/`), {
    model: "claude-opus-5-5",
    system: "以资产设定为准",
    references: [{ id: "hero", description: "人物左脸有痣", url: PNG }],
  });
  assert.equal(request.path, "/v1/messages");
  assert.equal(request.headers["x-api-key"], SECRET);
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.body.system, "以资产设定为准");
  assert.equal(request.body.model, "claude-opus-5-5");
  assert.equal(request.body.max_tokens, 8192);
  assert.match(request.body.messages[0].content, /人物左脸有痣/);
  assert.ok(!request.body.messages[0].content.includes("base64"));
  assert.equal(result.text, "剧本一 [密钥已隐藏]\n剧本二");
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("Claude fails on truncated, refused, unfinished and empty replies", async (t) => {
  let response;
  const base = await serve(t, (_req, res) => respond(res, response));
  const provider = providerFor(base);
  for (const reason of [
    "max_tokens",
    "model_context_window_exceeded",
    "refusal",
    "pause_turn",
    "tool_use",
    null,
  ]) {
    response = {
      stop_reason: reason,
      content: [{ type: "text", text: "部分内容" }],
    };
    await assert.rejects(call(provider));
  }
  response = { stop_reason: "end_turn", content: [] };
  await assert.rejects(call(provider), /没有返回/);
  response = {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "剧".repeat(100_001) }],
  };
  await assert.rejects(call(provider), /保存上限/);
  response = { type: "error", error: { message: `Rejected ${SECRET}` } };
  await assert.rejects(
    call(provider),
    (error) => !error.message.includes(SECRET) && error.message.includes("Rejected"),
  );
});

test("Seedream sends numbered references separately from prompt and supports native outputs", async (t) => {
  let request;
  let base64 = false;
  const base = await serve(t, async (req, res) => {
    request = {
      headers: req.headers,
      path: req.url,
      body: await readBody(req),
    };
    respond(res, {
      data: [
        base64
          ? { b64_json: PNG.split(",")[1] }
          : { url: "https://cdn.example.com/hero.png" },
      ],
    });
  });
  const provider = providerFor(`${base}/api/v3`, {
    protocol: "ark",
    kind: "image",
    model: SEEDREAM,
  });
  const refs = [
    { id: "hero", locked: true, version: 3, description: "红色外套", url: PNG },
  ];
  assert.equal(
    (await call(provider, { references: refs })).url,
    "https://cdn.example.com/hero.png",
  );
  assert.equal(request.path, "/api/v3/images/generations");
  assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(request.headers["x-api-key"], undefined);
  assert.deepEqual(request.body.image, [PNG]);
  assert.match(request.body.prompt, /红色外套/);
  assert.match(request.body.prompt, /参考图 1/);
  assert.ok(!request.body.prompt.includes("base64"));
  assert.equal(request.body.size, "2K");
  assert.equal(request.body.n, undefined);
  assert.equal(request.body.sequential_image_generation, undefined);
  base64 = true;
  assert.equal(
    (await call({ ...provider, model: "doubao-seedream-4-0-250828" })).url,
    PNG,
  );
  assert.equal(request.body.sequential_image_generation, "disabled");
});

test("Ark enforces known model reference limits and rejects unhandled media before network", async () => {
  const provider = providerFor("http://127.0.0.1:1", {
    protocol: "ark",
    kind: "image",
    model: SEEDREAM,
  });
  const image = { type: "character", url: "https://cdn.example.com/hero.png" };
  await assert.rejects(
    call(provider, { references: Array(11).fill(image) }),
    /最多支持 10 张/,
  );
  await assert.rejects(
    call(
      { ...provider, model: "doubao-seedream-4-5-251128" },
      { references: Array(15).fill(image) },
    ),
    /最多支持 14 张/,
  );
  await assert.rejects(
    call({ ...provider, model: "ep-custom" }, { references: [image] }),
    /不会忽略角色参考/,
  );
  await assert.rejects(
    call(provider, {
      references: [{ type: "video", url: "https://cdn.example.com/a.mp4" }],
    }),
    /仅支持图片参考/,
  );
  await assert.rejects(
    call(provider, { references: [{ url: "file:///private.png" }] }),
    /HTTP 或 HTTPS/,
  );
  const video = { ...provider, kind: "video", model: SEEDANCE };
  await assert.rejects(
    call(video, { references: Array(31).fill(image) }),
    /最多支持 30 张/,
  );
  await assert.rejects(
    call(
      { ...video, model: "doubao-seedance-2-0-260128" },
      { references: Array(10).fill(image) },
    ),
    /最多支持 9 张/,
  );
  await assert.rejects(call(video, { maxPolls: 121 }), /轮询配置/);
});

test("Seedance posts once, preserves image roles, and polls its own task URL", async (t) => {
  let posts = 0;
  let polls = 0;
  let request;
  const base = await serve(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    if (req.method === "POST") {
      posts++;
      assert.equal(req.url, "/api/v3/contents/generations/tasks");
      request = await readBody(req);
      respond(res, { id: "cgt-test_1", statusUrl: "https://evil.example.com" });
    } else {
      polls++;
      assert.equal(req.url, "/api/v3/contents/generations/tasks/cgt-test_1");
      respond(
        res,
        polls === 1
          ? { status: "running" }
          : {
              status: "succeeded",
              content: { video_url: "https://cdn.example.com/shot.mp4" },
            },
      );
    }
  });
  const result = await call(
    providerFor(`${base}/api/v3`, {
      protocol: "ark",
      kind: "video",
      model: SEEDANCE,
    }),
    {
      references: [{ id: "hero", url: PNG, locked: true }],
      pollIntervalMs: 1,
    },
  );
  assert.equal(posts, 1);
  assert.equal(polls, 2);
  assert.equal(request.content[1].role, "reference_image");
  assert.equal(request.content[1].image_url.url, PNG);
  assert.equal(request.ratio, "9:16");
  assert.equal(request.omni_reference_task_type, "reference");
  assert.equal(result.metadata.jobId, "cgt-test_1");
  assert.equal(result.url, "https://cdn.example.com/shot.mp4");
});

test("Seedance timeout, cancellation and failed states retain submitted task IDs without resubmitting", async (t) => {
  let state = "queued";
  let posts = 0;
  let polls = 0;
  let onCreated;
  const base = await serve(t, (req, res) => {
    if (req.method === "POST") {
      posts++;
      respond(res, { id: "recover-native-task" });
      onCreated?.();
    } else {
      polls++;
      respond(res, {
        status: state,
        ...(state === "failed" ? { error: { message: `failure ${SECRET}` } } : {}),
      });
    }
  });
  const provider = providerFor(base, {
    protocol: "ark",
    kind: "video",
    model: SEEDANCE,
  });
  await assert.rejects(
    call(provider, { maxPolls: 2, pollIntervalMs: 1 }),
    /recover-native-task/,
  );
  assert.equal(polls, 2);
  assert.equal(posts, 1);
  const controller = new AbortController();
  onCreated = () => setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    call(provider, { signal: controller.signal, pollIntervalMs: 1000 }),
    /已停止.*recover-native-task/,
  );
  onCreated = undefined;
  await assert.rejects(
    call(provider, { timeoutMs: 40, pollIntervalMs: 1000 }),
    /超时.*recover-native-task/,
  );
  for (const status of ["failed", "expired", "cancelled", "unexpected"]) {
    state = status;
    await assert.rejects(
      call(provider, { pollIntervalMs: 1 }),
      (error) =>
        error.message.includes("recover-native-task") &&
        !error.message.includes(SECRET),
    );
  }
  assert.equal(posts, 7);
});

test("native media rejects upstream error payloads and missing media instead of marking success", async (t) => {
  let payload = { data: [{ error: { message: `No image ${SECRET}` } }] };
  const base = await serve(t, (_req, res) => respond(res, payload));
  const imageProvider = providerFor(base, {
    protocol: "ark",
    kind: "image",
    model: SEEDREAM,
  });
  await assert.rejects(
    call(imageProvider),
    (error) => error.message.includes("No image") && !error.message.includes(SECRET),
  );
  payload = { data: [{}] };
  await assert.rejects(call(imageProvider), /没有返回有效/);
  payload = { data: [{ url: `https://cdn.example.com/${SECRET}.png` }] };
  await assert.rejects(call(imageProvider), /包含当前 API Key/);
  const videoProvider = { ...imageProvider, kind: "video", model: SEEDANCE };
  payload = { id: "../unsafe-task" };
  await assert.rejects(call(videoProvider), /未返回有效的任务 ID/);
  payload = { id: "task", status: "succeeded", content: {} };
  await assert.rejects(
    call(videoProvider, { pollIntervalMs: 1 }),
    /没有返回可用的 url.*task/,
  );
});

test("native protocols reject invalid kind combinations and missing keys before requests", async (t) => {
  const api = await routes(t);
  for (const extra of [
    { protocol: "anthropic", kind: "image" },
    { protocol: "anthropic", kind: "video" },
    { protocol: "ark", kind: "text" },
  ]) {
    const provider = providerFor("http://127.0.0.1:1", extra);
    assert.equal((await api("", provider)).status, 400);
    await assert.rejects(call(provider), /仅支持/);
  }
  await assert.rejects(
    call(providerFor("http://127.0.0.1:1", { apiKey: "" })),
    /API Key/,
  );
});

test("native connection tests authenticate read-only endpoints and never submit generation", async (t) => {
  const requests = [];
  const base = await serve(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url === "/v1/models") {
      assert.equal(req.headers["x-api-key"], SECRET);
      assert.equal(req.headers.authorization, undefined);
      respond(res, { data: [{ id: "claude-sonnet-5-5" }] });
    } else {
      assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
      respond(res, { items: [], total: 0 });
    }
  });
  const api = await routes(t);
  for (const provider of [
    providerFor(`${base}/v1`),
    providerFor(`${base}/api/v3`, {
      protocol: "ark",
      kind: "image",
      model: SEEDREAM,
    }),
    providerFor(`${base}/api/v3`, {
      protocol: "ark",
      kind: "video",
      model: SEEDANCE,
    }),
  ]) {
    const created = await api("", provider);
    assert.equal(created.status, 201);
    assert.ok(!JSON.stringify(created.body).includes(SECRET));
    const result = await api(`/${created.body.id}/test`);
    assert.equal(result.body.ok, true);
    assert.match(result.body.message, /尚未执行生成/);
    if (provider.protocol === "ark")
      assert.match(result.body.message, /未验证所选模型/);
  }
  assert.deepEqual(requests, [
    "GET /v1/models",
    "GET /api/v3/contents/generations/tasks?page_size=1",
    "GET /api/v3/contents/generations/tasks?page_size=1",
  ]);
});

test("native credentials stay redacted on HTTP errors and are never forwarded on redirects", async (t) => {
  let foreignRequests = 0;
  let redirect = false;
  const foreign = await serve(t, (_req, res) => {
    foreignRequests++;
    respond(res, { data: [] });
  });
  const base = await serve(t, (_req, res) => {
    if (redirect) {
      res.writeHead(307, { Location: foreign });
      res.end();
    } else respond(res, { error: { message: `Unauthorized ${SECRET}` } }, 401);
  });
  for (const provider of [
    providerFor(base),
    providerFor(base, { protocol: "ark", kind: "image", model: SEEDREAM }),
  ]) {
    redirect = false;
    await assert.rejects(
      call(provider),
      (error) => error.message.includes("HTTP 401") && !error.message.includes(SECRET),
    );
    const api = await routes(t);
    const created = await api("", provider);
    const checked = await api(`/${created.body.id}/test`);
    assert.equal(checked.body.ok, false);
    assert.ok(!JSON.stringify(checked.body).includes(SECRET));
    redirect = true;
    await assert.rejects(call(provider), /重定向/);
  }
  assert.equal(foreignRequests, 0);
});
