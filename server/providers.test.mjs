import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { generate, mountProviderRoutes } from "./providers.mjs";

const SECRET = "test-secret-not-for-browser";
const providerFor = (baseUrl, extra = {}) => ({
  id: "test-provider",
  name: "Test model",
  kind: "text",
  protocol: "openai",
  model: "model-test",
  baseUrl,
  enabled: true,
  apiKey: SECRET,
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

const call = (provider, extra = {}) =>
  generate({
    provider,
    kind: provider.kind,
    prompt: "依据小说生成短剧",
    ...extra,
  });

test("OpenAI compatible text sends model override, reference context and server-only credentials", async (t) => {
  let received;
  const base = await serve(t, async (req, res) => {
    received = {
      path: req.url,
      auth: req.headers.authorization,
      body: await readBody(req),
    };
    respond(res, {
      choices: [
        {
          message: { content: [{ type: "text", text: "第一集" }] },
          finish_reason: "stop",
        },
      ],
    });
  });
  const result = await call(providerFor(`${base}/v1/`), {
    model: "override-model",
    system: "保持角色一致",
    references: [{ id: "hero", name: "主角", locked: true, version: 2 }],
  });
  assert.equal(received.path, "/v1/chat/completions");
  assert.equal(received.auth, `Bearer ${SECRET}`);
  assert.equal(received.body.model, "override-model");
  assert.equal(received.body.messages[0].role, "system");
  assert.match(received.body.messages[1].content, /hero/);
  assert.equal(result.text, "第一集");
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("upstream errors are readable and redact credentials", async (t) => {
  const base = await serve(t, (_req, res) =>
    respond(res, { error: { message: `Invalid key ${SECRET}` } }, 401),
  );
  await assert.rejects(call(providerFor(base)), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes(SECRET));
    return true;
  });
});

test("invalid JSON and empty or truncated completions never become successful output", async (t) => {
  let mode = "html";
  const base = await serve(t, (_req, res) => {
    if (mode === "html") {
      res.end("<html>not a model</html>");
      return;
    }
    respond(res, {
      choices: [
        {
          message: { content: mode === "empty" ? "" : "partial" },
          finish_reason: mode === "length" ? "length" : "stop",
        },
      ],
    });
  });
  const provider = providerFor(base);
  await assert.rejects(call(provider), /JSON/);
  mode = "empty";
  await assert.rejects(call(provider), /没有返回/);
  mode = "length";
  await assert.rejects(call(provider), /截断/);
});

test("requests obey caller cancellation and bounded timeout", async (t) => {
  const base = await serve(t, () => {});
  const controller = new AbortController();
  const operation = call(providerFor(base), { signal: controller.signal });
  controller.abort();
  await assert.rejects(operation, /已停止/);
  await assert.rejects(call(providerFor(base), { timeoutMs: 20 }), /超时/);
});

test("OpenAI image edits send real image inputs and named locked constraints without base64 in prompt", async (t) => {
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  let received;
  const base = await serve(t, async (req, res) => {
    received = { path: req.url, body: await readBody(req) };
    respond(res, { data: [{ url: "https://cdn.example.com/new-scene.png" }] });
  });
  const result = await call(providerFor(`${base}/v1`, { kind: "image" }), {
    model: "gpt-image-2.5",
    prompt: "长生将符纸贴在神像背后，单幅场景",
    system: "二次元乡村悬疑短剧，无血腥",
    references: [
      {
        id: "hero",
        name: "长生",
        type: "character",
        locked: true,
        version: 2,
        url: pixel,
      },
      {
        id: "elder",
        name: "老道士",
        type: "character",
        url: "https://cdn.example.com/elder.png",
      },
      { type: "script", content: "主角七岁，穿灰布衣，神像面朝墙壁。" },
    ],
  });
  assert.equal(received.path, "/v1/images/edits");
  assert.equal(received.body.model, "gpt-image-2.5");
  assert.equal(received.body.n, 1);
  assert.deepEqual(received.body.images, [
    { image_url: pixel },
    { image_url: "https://cdn.example.com/elder.png" },
  ]);
  assert.match(received.body.prompt, /二次元乡村悬疑短剧/);
  assert.match(received.body.prompt, /长生将符纸贴在神像背后/);
  assert.match(received.body.prompt, /主角七岁，穿灰布衣/);
  assert.match(received.body.prompt, /"name":"长生".*"url":"参考图 1".*"locked":true/);
  assert.match(received.body.prompt, /"name":"老道士".*"url":"参考图 2"/);
  assert.doesNotMatch(received.body.prompt, /base64|https:\/\/cdn/);
  assert.equal(result.url, "https://cdn.example.com/new-scene.png");
});

test("unsupported image edit gateways fail once without dropping references or changing model", async (t) => {
  const requests = [];
  const base = await serve(t, async (req, res) => {
    requests.push({ path: req.url, body: await readBody(req) });
    respond(res, { error: { message: `Unsupported edits ${SECRET}` } }, 404);
  });
  await assert.rejects(
    call(providerFor(`${base}/v1`, { kind: "image" }), {
      model: "gpt-image-2.5",
      references: ["https://cdn.example.com/hero.png"],
    }),
    (error) => {
      assert.match(error.message, /images\/edits.*HTTP 404/);
      assert.match(error.message, /不会忽略参考图/);
      assert.doesNotMatch(error.message, new RegExp(SECRET));
      return true;
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/images/edits");
  assert.equal(requests[0].body.model, "gpt-image-2.5");
});

test("OpenAI image inputs reject unsupported media and excessive context before requesting", async () => {
  const provider = providerFor("http://127.0.0.1:1", { kind: "image" });
  await assert.rejects(
    call(provider, {
      references: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
    }),
    /仅支持图片参考/,
  );
  await assert.rejects(
    call(provider, {
      references: [{ type: "character", url: "/api/media/local/file" }],
    }),
    /有效的 HTTP 或 HTTPS/,
  );
  await assert.rejects(
    call(provider, {
      references: Array.from(
        { length: 17 },
        (_, index) => `https://cdn.example.com/${index}.png`,
      ),
    }),
    /最多支持 16 张/,
  );
  await assert.rejects(
    call(provider, {
      prompt: "场景".repeat(15_990),
      system: "角色身份不得更改".repeat(10),
    }),
    /超过 32000.*不会自动截断/,
  );
});

test("OpenAI image creation incorporates textual asset constraints into the prompt", async (t) => {
  let prompt;
  const base = await serve(t, async (req, res) => {
    prompt = (await readBody(req)).prompt;
    respond(res, { data: [{ url: "https://cdn.example.com/hero.png" }] });
  });
  await call(providerFor(base, { kind: "image" }), {
    system: "保持二次元国风，禁止现代城市元素",
    prompt: "长生，七岁男童，神色警惕的正面定妆图",
    references: [
      { id: "script", type: "script", locked: true, content: "主角穿红色外套" },
    ],
  });
  assert.match(prompt, /主角穿红色外套/);
  assert.match(prompt, /保持二次元国风，禁止现代城市元素/);
  assert.match(prompt, /长生，七岁男童，神色警惕的正面定妆图/);
});

test("OpenAI image URL and base64 outputs retain actual generated media", async (t) => {
  let returnBase64 = false;
  const pixelPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII=";
  const base = await serve(t, async (req, res) => {
    assert.equal(req.url, "/v1/images/generations");
    const body = await readBody(req);
    assert.equal(body.n, 1);
    respond(res, {
      data: [
        returnBase64
          ? { b64_json: pixelPng }
          : {
              url: "https://cdn.example.com/hero.png",
              revised_prompt: "主角视觉设定",
            },
      ],
    });
  });
  const provider = providerFor(`${base}/v1`, { kind: "image" });
  assert.equal((await call(provider)).url, "https://cdn.example.com/hero.png");
  returnBase64 = true;
  assert.equal((await call(provider)).url, `data:image/png;base64,${pixelPng}`);
});

test("webhook forwards locked references and requires a real media URL", async (t) => {
  let response = {
    text: "分镜渲染完成",
    url: "https://cdn.example.com/episode.mp4",
  };
  let received;
  const base = await serve(t, async (req, res) => {
    received = await readBody(req);
    respond(res, response);
  });
  const refs = [
    {
      id: "hero",
      name: "林晚",
      type: "character",
      url: "https://cdn.example.com/hero.png",
      locked: true,
      version: 3,
    },
  ];
  const provider = providerFor(`${base}/generate`, {
    protocol: "webhook",
    kind: "video",
  });
  const result = await call(provider, { references: refs });
  assert.deepEqual(received.references, refs);
  assert.equal(received.kind, "video");
  assert.equal(result.url, response.url);
  response = { text: "This is only a prompt, not a video" };
  await assert.rejects(call(provider), /没有返回可用的 url/);
  response = { url: "javascript:alert(1)" };
  await assert.rejects(call(provider), /HTTP 或 HTTPS/);
});

test("webhook async tasks poll same-origin status without resubmitting generation", async (t) => {
  let posts = 0;
  let polls = 0;
  const base = await serve(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    if (req.method === "POST") {
      posts++;
      respond(res, {
        status: "queued",
        jobId: "job-1",
        statusUrl: "/jobs/job-1",
      });
      return;
    }
    assert.equal(req.url, "/jobs/job-1");
    polls++;
    respond(
      res,
      polls === 1
        ? { status: "running" }
        : {
            status: "completed",
            url: "https://cdn.example.com/scene.mp4",
            text: "镜头完成",
          },
    );
  });
  const result = await call(
    providerFor(`${base}/generate`, { protocol: "webhook", kind: "video" }),
    { pollIntervalMs: 1 },
  );
  assert.equal(posts, 1);
  assert.equal(polls, 2);
  assert.equal(result.metadata.jobId, "job-1");
});

test("inline image references reach media webhooks but do not expand text contexts", async (t) => {
  const imageUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII=";
  let request;
  const base = await serve(t, async (req, res) => {
    request = await readBody(req);
    respond(res, {
      text: "有依据的生成结果",
      url: "https://cdn.example.com/generated.mp4",
    });
  });
  const references = [{ id: "image", description: "已锁定的人物外观", url: imageUrl }];
  await call(providerFor(base, { protocol: "webhook", kind: "video" }), {
    references,
  });
  assert.equal(request.references[0].url, imageUrl);
  await call(providerFor(base, { protocol: "webhook", kind: "text" }), {
    references,
  });
  assert.equal(request.references[0].url, undefined);
  assert.equal(request.references[0].description, "已锁定的人物外观");
});

test("stopping async polling reports the submitted job ID", async (t) => {
  const controller = new AbortController();
  const base = await serve(t, (_req, res) => {
    respond(res, {
      status: "running",
      jobId: "recover-this-job",
      statusUrl: "/job",
    });
    setTimeout(() => controller.abort(), 10);
  });
  await assert.rejects(
    call(providerFor(base, { protocol: "webhook" }), {
      signal: controller.signal,
    }),
    /recover-this-job/,
  );
});

test("webhook refuses cross-origin poll targets and redirects before credentials can travel", async (t) => {
  let received = 0;
  const other = await serve(t, (_req, res) => {
    received++;
    respond(res, { status: "completed", text: "bad" });
  });
  let redirect = false;
  const base = await serve(t, (_req, res) => {
    if (redirect) {
      res.writeHead(307, { Location: other });
      res.end();
      return;
    }
    respond(res, { status: "queued", jobId: "job", statusUrl: `${other}/job` });
  });
  const provider = providerFor(base, { protocol: "webhook" });
  await assert.rejects(call(provider), /必须与配置的接口同源/);
  redirect = true;
  await assert.rejects(call(provider), /重定向/);
  assert.equal(received, 0);
});

test("polling is bounded and failed jobs are surfaced", async (t) => {
  let mode = "pending";
  let polls = 0;
  const base = await serve(t, (req, res) => {
    if (req.method === "GET") polls++;
    respond(
      res,
      mode === "pending"
        ? { status: "running", jobId: "bounded-job", statusUrl: "/job" }
        : { status: "failed", error: "Unsupported reference image" },
    );
  });
  const provider = providerFor(base, { protocol: "webhook" });
  await assert.rejects(
    call(provider, { pollIntervalMs: 1, maxPolls: 2 }),
    /bounded-job/,
  );
  assert.equal(polls, 2);
  mode = "failed";
  await assert.rejects(call(provider), /Unsupported reference image/);
});

test("invalid protocol, disabled models and mismatched kinds fail before requests", async () => {
  const provider = providerFor("http://127.0.0.1:1");
  await assert.rejects(call({ ...provider, enabled: false }), /已停用/);
  await assert.rejects(call(provider, { kind: "image" }), /模型类型/);
  await assert.rejects(
    call({ ...provider, baseUrl: "file:///private" }),
    /HTTP 或 HTTPS/,
  );
  await assert.rejects(
    call({ ...provider, baseUrl: "http://user:pass@localhost" }),
    /内嵌凭据/,
  );
  await assert.rejects(call({ ...provider, model: "" }), /模型名称/);
});

async function routes(t, options = {}) {
  const app = express();
  app.use(express.json());
  const state = { providers: [], agents: [] };
  const snapshots = [];
  mountProviderRoutes(app, {
    getState: () => state,
    save: options.save ?? (() => snapshots.push(structuredClone(state))),
  });
  const base = await serve(t, app);
  async function api(path, method = "GET", body) {
    const response = await fetch(`${base}/api/providers${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  return { api, state, snapshots };
}

test("provider CRUD persists secrets without disclosing them and preserves blank/omitted edits", async (t) => {
  const { api, state, snapshots } = await routes(t);
  const input = providerFor("http://localhost:1234/v1");
  const created = await api("", "POST", input);
  assert.equal(created.status, 201);
  assert.equal(created.body.hasKey, true);
  assert.equal(created.body.apiKey, undefined);
  assert.ok(!JSON.stringify(created.body).includes(SECRET));
  const id = created.body.id;
  assert.notEqual(id, input.id);
  assert.equal(state.providers[0].apiKey, SECRET);
  assert.equal(snapshots[0].providers[0].apiKey, SECRET);
  await api(`/${id}`, "PATCH", { name: "Updated" });
  assert.equal(state.providers[0].apiKey, SECRET);
  await api(`/${id}`, "PATCH", { apiKey: "" });
  assert.equal(state.providers[0].apiKey, SECRET);
  assert.ok(!JSON.stringify((await api("")).body).includes(SECRET));
  await api(`/${id}`, "PATCH", { clearApiKey: true });
  assert.equal(state.providers[0].apiKey, "");
  state.agents.push({ id: "agent", providerId: id });
  assert.equal((await api(`/${id}`, "DELETE")).status, 200);
  assert.equal(state.agents[0].providerId, "");
  assert.equal(state.providers.length, 0);
});

test("provider input validation rejects unsafe configuration without modifying state", async (t) => {
  const { api, state } = await routes(t);
  const input = providerFor("https://example.com/v1");
  for (const override of [
    { baseUrl: "file:///x" },
    { baseUrl: "https://secret@example.com" },
    { baseUrl: "https://example.com?key=secret" },
    { apiKey: "one\ntwo" },
    { kind: "video" },
    { enabled: "false" },
    { name: "" },
  ]) {
    assert.equal((await api("", "POST", { ...input, ...override })).status, 400);
  }
  assert.equal(state.providers.length, 0);
  assert.equal((await api("/missing", "PATCH", {})).status, 404);
});

test("explicit connection tests only call GET models or webhook health, never generation", async (t) => {
  const methods = [];
  const upstream = await serve(t, (req, res) => {
    methods.push(`${req.method} ${req.url}`);
    if (req.url === "/v1/models") respond(res, { data: [{ id: "model-test" }] });
    else respond(res, { ok: true });
  });
  const { api } = await routes(t);
  const openai = (await api("", "POST", providerFor(`${upstream}/v1`))).body;
  assert.equal(methods.length, 0);
  const check = await api(`/${openai.id}/test`, "POST");
  assert.equal(check.body.ok, true);
  assert.match(check.body.message, /尚未执行生成/);
  const webhook = (
    await api(
      "",
      "POST",
      providerFor(`${upstream}/webhook`, {
        protocol: "webhook",
        kind: "video",
      }),
    )
  ).body;
  assert.equal((await api(`/${webhook.id}/test`, "POST")).body.ok, true);
  assert.deepEqual(methods, ["GET /v1/models", "GET /webhook"]);
});

test("connection test errors remain readable and do not disclose saved credentials", async (t) => {
  const upstream = await serve(t, (_req, res) =>
    respond(res, { error: { message: `Unauthorized ${SECRET}` } }, 403),
  );
  const { api } = await routes(t);
  const provider = (await api("", "POST", providerFor(upstream))).body;
  const result = await api(`/${provider.id}/test`, "POST");
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.match(result.body.message, /HTTP 403/);
  assert.ok(!JSON.stringify(result.body).includes(SECRET));
});

test("persistence failures roll back config changes and redact internal errors", async (t) => {
  const { api, state } = await routes(t, {
    save: () => {
      throw new Error(`disk error ${SECRET}`);
    },
  });
  const result = await api("", "POST", providerFor("https://example.com/v1"));
  assert.equal(result.status, 500);
  assert.equal(state.providers.length, 0);
  assert.ok(!JSON.stringify(result.body).includes(SECRET));
});
