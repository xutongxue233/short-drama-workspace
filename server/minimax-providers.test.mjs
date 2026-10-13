import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "./providers.mjs";
import { providerInput } from "./providers/config.mjs";
import { testProvider } from "./providers/health.mjs";
import { minimaxEndpoint } from "./providers/minimax.mjs";
import { createMaterialService } from "./services/materials.mjs";

const SECRET = "minimax-secret-stays-server-side";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII=";
const OK = { base_resp: { status_code: 0, status_msg: "success" } };
const providerFor = (baseUrl, extra = {}) => ({
  id: "minimax",
  name: "MiniMax",
  kind: "image",
  protocol: "minimax",
  model: "image-01",
  apiKey: SECRET,
  baseUrl,
  enabled: true,
  ...extra,
});
const call = (provider, extra = {}) =>
  generate({
    provider,
    kind: provider.kind,
    prompt: "长生，灰衣少年，二维赛璐璐，正面全身。",
    pollIntervalMs: 1,
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
const respond = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

test("MiniMax native configuration permits only media and requires a key before network", async () => {
  for (const kind of ["image", "video"]) {
    const provider = providerFor("http://127.0.0.1:1", { kind, apiKey: "" });
    assert.equal(providerInput(provider).protocol, "minimax");
    await assert.rejects(call(provider), /API Key/);
    await assert.rejects(testProvider(provider), /API Key/);
  }
  assert.throws(
    () => providerInput(providerFor("https://api.minimax.cn", { kind: "text" })),
    /仅支持图片和视频/,
  );
});

test("MiniMax persists a submitted task before polling and resumes it without another creation", async (t) => {
  let creations = 0;
  let persisted;
  let completed = false;
  const base = await serve(t, (req, res) => {
    if (req.method === "POST") {
      creations++;
      respond(res, { task_id: "persisted-shot-08" });
    } else {
      assert.equal(persisted?.id, "persisted-shot-08");
      respond(res, {
        task: {
          id: "persisted-shot-08",
          model: "MiniMax-H3",
          status: completed ? "succeeded" : "running",
          duration: 5,
          ratio: "9:16",
          ...(completed
            ? { content: { url: "https://cdn.example.com/shot08.mp4" } }
            : {}),
        },
      });
    }
  });
  const provider = providerFor(base, { kind: "video", model: "MiniMax-H3" });
  await assert.rejects(
    call(provider, {
      videoOptions: { duration: 5, ratio: "9:16" },
      maxPolls: 1,
      onTaskCreated(task) {
        persisted = task;
      },
    }),
    /persisted-shot-08/,
  );
  assert.deepEqual(persisted, {
    id: "persisted-shot-08",
    model: "MiniMax-H3",
    protocol: "minimax",
  });
  completed = true;
  let dispatches = 0;
  const result = await call(provider, {
    videoOptions: { duration: 5, ratio: "9:16" },
    resumeTaskId: persisted.id,
    onDispatch() {
      dispatches++;
    },
    onTaskCreated() {
      assert.fail("Restoring a task must not create it again");
    },
  });
  assert.equal(creations, 1);
  assert.equal(dispatches, 1);
  assert.equal(result.metadata.jobId, persisted.id);
  assert.equal(result.url, "https://cdn.example.com/shot08.mp4");
});

test("MiniMax retains the created ID when task persistence fails and validates resumes before network", async (t) => {
  let requests = 0;
  const base = await serve(t, (_req, res) => {
    requests++;
    respond(res, { task_id: "needs-recovery" });
  });
  const provider = providerFor(base, { kind: "video", model: "MiniMax-H3" });
  await assert.rejects(
    call(provider, {
      onTaskCreated() {
        throw new Error("disk full");
      },
    }),
    /保存失败.*needs-recovery/,
  );
  assert.equal(requests, 1);
  for (const resumeTaskId of ["", "../unsafe", 123])
    await assert.rejects(call(provider, { resumeTaskId }), /恢复任务 ID/);
  await assert.rejects(
    call(providerFor(base), { resumeTaskId: "needs-recovery" }),
    /仅支持 MiniMax 视频/,
  );
  assert.equal(requests, 1);
});

test("MiniMax endpoint versions preserve proxy prefixes without doubling v1 or v2", () => {
  for (const suffix of ["", "/", "/v1", "/v1/", "/v2"]) {
    const provider = providerFor(`https://proxy.example.com/minimax${suffix}`);
    assert.equal(
      minimaxEndpoint(provider, "image_generation"),
      "https://proxy.example.com/minimax/v1/image_generation",
    );
    assert.equal(
      minimaxEndpoint(provider, "video_generation", "v2"),
      "https://proxy.example.com/minimax/v2/video_generation",
    );
  }
});

test("MiniMax images use native subject reference without duplicating the full asset card", async (t) => {
  const requests = [];
  const base = await serve(t, async (req, res) => {
    requests.push({ path: req.url, headers: req.headers, body: await readBody(req) });
    respond(res, { ...OK, data: { image_urls: ["https://cdn.example.com/hero.png"] } });
  });
  let dispatches = 0;
  const result = await call(providerFor(`${base}/v1`), {
    model: "image-01-live",
    system: "保持基础设计一致。",
    references: [
      {
        type: "character",
        id: "hero",
        name: "长生",
        version: 2,
        description: "灰衣",
        content: "冗长角色卡".repeat(400),
        url: PNG,
      },
    ],
    onDispatch() {
      dispatches++;
    },
  });
  assert.equal(dispatches, 1);
  assert.equal(requests[0].path, "/v1/image_generation");
  assert.equal(requests[0].headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(requests[0].body.subject_reference, [
    { type: "character", image_file: PNG },
  ]);
  assert.equal(requests[0].body.model, "image-01-live");
  assert.equal(requests[0].body.n, 1);
  assert.equal(requests[0].body.prompt_optimizer, false);
  assert.match(requests[0].body.prompt, /保持基础设计一致/);
  assert.match(requests[0].body.prompt, /长生/);
  assert.match(requests[0].body.prompt, /参考图 1/);
  assert.ok(!requests[0].body.prompt.includes("base64"));
  assert.ok(!requests[0].body.prompt.includes("冗长角色卡"));
  assert.equal(result.url, "https://cdn.example.com/hero.png");
  assert.equal(result.metadata.model, "image-01-live");
});

test("MiniMax native images accept base64 and pass generated media to local storage", async (t) => {
  const base = await serve(t, (_req, res) =>
    respond(res, { ...OK, data: { image_base64: [PNG.split(",")[1]] } }),
  );
  const result = await call(providerFor(base));
  assert.equal(result.url, PNG);
  const dataDir = await mkdtemp(join(tmpdir(), "minimax-material-"));
  const project = { id: "test", materials: [] };
  const materials = createMaterialService({
    dataDir,
    getState: () => ({ projects: [project] }),
    save() {},
  });
  t.after(async () => {
    materials.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const saved = await materials.capture(project, {
    ...result.metadata,
    url: result.url,
    type: "image",
    name: "长生",
  });
  assert.equal(saved.status, "local");
  assert.equal(saved.providerId, "minimax");
  assert.deepEqual(
    await readFile((await materials.file(saved.id)).path),
    Buffer.from(PNG.split(",")[1], "base64"),
  );
});

test("MiniMax rejects incompatible references, models and prompt budgets before dispatch", async () => {
  let dispatched = false;
  const image = providerFor("http://127.0.0.1:1");
  const cases = [
    { prompt: "图".repeat(1501), match: /1500.*不会截断/ },
    { prompt: "图".repeat(1499), system: "系统约束", match: /1500/ },
    { references: [PNG, PNG], match: /1 张/ },
    { references: [{ type: "scene", url: PNG }], match: /人物主体/ },
    {
      references: [{ type: "video", url: "https://cdn.example.com/a.mp4" }],
      match: /不会忽略参考/,
    },
    { references: [{ url: "file:///secret.png" }], match: /HTTP 或 HTTPS/ },
    { model: "unknown-image", match: /image-01/ },
  ];
  for (const { match, ...extra } of cases)
    await assert.rejects(
      call(image, {
        ...extra,
        onDispatch() {
          dispatched = true;
        },
      }),
      match,
    );
  assert.equal(dispatched, false);
});

test("MiniMax reports business errors, missing outputs and credential URLs as failures", async (t) => {
  let payload;
  const base = await serve(t, (_req, res) => respond(res, payload));
  const provider = providerFor(base);
  for (const data of [
    {
      base_resp: { status_code: 1008, status_msg: `余额不足 ${SECRET}` },
      data: { image_urls: ["https://cdn.example.com/fake.png"] },
    },
    { ...OK, error: { message: `失败 ${SECRET}` } },
    { ...OK, data: { image_urls: [] } },
    { ...OK, data: { image_urls: [`https://cdn.example.com/${SECRET}`] } },
    { ...OK, data: { image_base64: ["not-valid"] } },
  ]) {
    payload = data;
    await assert.rejects(
      call(provider),
      (error) => error.status === 502 && !error.message.includes(SECRET),
    );
  }
});

test("H3 uses v2, preserves reference identity and approved duration/ratio, and dispatches once", async (t) => {
  const requests = [];
  let polls = 0;
  const base = await serve(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    requests.push({
      path: req.url,
      method: req.method,
      ...(req.method === "POST" ? { body: await readBody(req) } : {}),
    });
    if (req.method === "POST")
      respond(res, {
        task_id: "h3-task",
        statusUrl: "https://attacker.example.com/poll",
      });
    else
      respond(res, {
        task: {
          id: "h3-task",
          status: ++polls === 1 ? "running" : "succeeded",
          duration: 5,
          ratio: "9:16",
          content: { url: "https://cdn.example.com/shot.mp4" },
        },
      });
  });
  let dispatches = 0;
  const result = await call(
    providerFor(`${base}/proxy/v1`, { kind: "video", model: "MiniMax-H3" }),
    {
      videoOptions: { duration: 5, ratio: "9:16" },
      references: [
        { type: "character", name: "长生", content: "灰衣", url: PNG },
        { type: "scene", name: "神庙", url: "https://cdn.example.com/temple.png" },
      ],
      onDispatch() {
        dispatches++;
      },
    },
  );
  assert.equal(dispatches, 1);
  assert.deepEqual(
    requests.map(({ path }) => path),
    [
      "/proxy/v2/video_generation",
      "/proxy/v2/query/video_generation/h3-task",
      "/proxy/v2/query/video_generation/h3-task",
    ],
  );
  const body = requests[0].body;
  assert.equal(body.duration, 5);
  assert.equal(body.ratio, "9:16");
  assert.equal(body.resolution, "768P");
  assert.equal(body.content[1].role, "reference_image");
  assert.equal(body.content[1].image_url.url, PNG);
  assert.equal(body.content[2].role, "reference_image");
  assert.match(body.content[0].text, /灰衣/);
  assert.ok(!body.content[0].text.includes("base64"));
  assert.equal(result.metadata.jobId, "h3-task");
  assert.equal(result.url, "https://cdn.example.com/shot.mp4");
});

test("H3 Max supports its documented reference images and 5–15 second range", async (t) => {
  const base = await serve(t, async (req, res) => {
    if (req.method === "POST") {
      const body = await readBody(req);
      assert.equal(body.model, "MiniMax-H3-Max");
      assert.equal(body.content[1].role, "reference_image");
      assert.equal(body.duration, 15);
      respond(res, { task_id: "max-task" });
    } else
      respond(res, {
        task: {
          status: "succeeded",
          content: { url: "https://cdn.example.com/max.mp4" },
        },
      });
  });
  const provider = providerFor(base, { kind: "video", model: "MiniMax-H3-Max" });
  await call(provider, {
    videoOptions: { duration: 15, ratio: "9:16" },
    references: [{ type: "character", url: PNG }],
  });
  await assert.rejects(
    call(provider, { videoOptions: { duration: 4, ratio: "9:16" } }),
    /5–15/,
  );
});

test("H3 validates duration, reference count, audio/video types and prompt length before dispatch", async () => {
  const provider = providerFor("http://127.0.0.1:1", {
    kind: "video",
    model: "MiniMax-H3",
  });
  let calls = 0;
  const onDispatch = () => calls++;
  for (const duration of [3, 5.5, 16])
    await assert.rejects(
      call(provider, { videoOptions: { duration, ratio: "9:16" }, onDispatch }),
      /4–15/,
    );
  await assert.rejects(
    call(provider, { videoOptions: { duration: 5, ratio: "adaptive" }, onDispatch }),
    /明确画幅/,
  );
  await assert.rejects(
    call(provider, { references: Array(10).fill(PNG), onDispatch }),
    /9 张/,
  );
  await assert.rejects(
    call(provider, {
      references: [{ type: "video", url: "https://cdn.example.com/a.mp4" }],
      onDispatch,
    }),
    /音视频参考/,
  );
  await assert.rejects(
    call(provider, { references: [{ type: "first_frame", url: PNG }], onDispatch }),
    /首尾帧模式/,
  );
  await assert.rejects(
    call(provider, { prompt: "剧".repeat(7001), onDispatch }),
    /7000/,
  );
  await assert.rejects(
    call(provider, { model: "unverified-model", onDispatch }),
    /尚未适配/,
  );
  assert.equal(calls, 0);
});

test("legacy Hailuo creates one task, polls by task_id and retrieves its file on the same server", async (t) => {
  const requests = [];
  let polls = 0;
  const base = await serve(t, async (req, res) => {
    requests.push(req.url);
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    if (req.method === "POST") {
      const body = await readBody(req);
      assert.equal(body.model, "MiniMax-Hailuo-2.3");
      assert.equal(body.duration, 10);
      assert.equal(body.resolution, "768P");
      assert.equal(body.prompt_optimizer, false);
      respond(res, { ...OK, task_id: "legacy-task" });
    } else if (req.url.includes("/query/")) {
      polls++;
      respond(res, {
        ...OK,
        task_id: "legacy-task",
        status: polls === 1 ? "Queueing" : "Success",
        file_id: "123456789012345678",
        statusUrl: "https://attacker.example.com",
      });
    } else
      respond(res, {
        ...OK,
        file: { download_url: "https://cdn.example.com/legacy.mp4" },
      });
  });
  let dispatched = 0;
  const result = await call(
    providerFor(`${base}/v2`, { kind: "video", model: "MiniMax-Hailuo-2.3" }),
    {
      videoOptions: { duration: 10, ratio: "adaptive" },
      onDispatch() {
        dispatched++;
      },
    },
  );
  assert.equal(dispatched, 1);
  assert.deepEqual(requests, [
    "/v1/video_generation",
    "/v1/query/video_generation?task_id=legacy-task",
    "/v1/query/video_generation?task_id=legacy-task",
    "/v1/files/retrieve?file_id=123456789012345678",
  ]);
  assert.equal(result.url, "https://cdn.example.com/legacy.mp4");
  assert.equal(result.metadata.jobId, "legacy-task");
});

test("legacy S2V passes one actual subject image while Hailuo accepts only an explicit first frame", async (t) => {
  const bodies = [];
  const base = await serve(t, async (req, res) => {
    if (req.method === "POST") {
      bodies.push(await readBody(req));
      respond(res, { ...OK, task_id: "legacy" });
    } else if (req.url.includes("/query/"))
      respond(res, { ...OK, status: "Success", file_id: "12345" });
    else
      respond(res, { ...OK, file: { download_url: "https://cdn.example.com/a.mp4" } });
  });
  await call(providerFor(base, { kind: "video", model: "S2V-01" }), {
    references: [{ type: "character", url: PNG }],
  });
  assert.deepEqual(bodies[0].subject_reference, [{ type: "character", image: [PNG] }]);
  assert.equal(bodies[0].first_frame_image, undefined);
  await call(providerFor(base, { kind: "video", model: "MiniMax-Hailuo-2.3-Fast" }), {
    references: [{ type: "first_frame", url: PNG }],
  });
  assert.equal(bodies[1].first_frame_image, PNG);
});

test("legacy video refuses fixed approved ratios, unsupported lengths or repurposed identity refs", async () => {
  const provider = providerFor("http://127.0.0.1:1", {
    kind: "video",
    model: "MiniMax-Hailuo-2.3",
  });
  await assert.rejects(
    call(provider, { videoOptions: { duration: 6, ratio: "9:16" } }),
    /不会忽略已确认画幅/,
  );
  await assert.rejects(
    call(provider, { videoOptions: { duration: 5, ratio: "adaptive" } }),
    /6 或 10/,
  );
  await assert.rejects(
    call(provider, { references: [{ type: "character", url: PNG }] }),
    /不能把角色定妆图当作首帧/,
  );
  await assert.rejects(call({ ...provider, model: "I2V-01" }), /first_frame/);
  await assert.rejects(call({ ...provider, model: "S2V-01" }), /1 张/);
  await assert.rejects(
    call({ ...provider, model: "S2V-01" }, { references: [PNG, PNG] }),
    /不会丢弃其他角色/,
  );
});

test("submitted MiniMax tasks keep IDs on failure, cancellation and timeout without reposting", async (t) => {
  let status = "running";
  let posts = 0;
  let onCreated;
  const base = await serve(t, (req, res) => {
    if (req.method === "POST") {
      posts++;
      respond(res, { task_id: "recover-task" });
      onCreated?.();
    } else
      respond(res, {
        task: {
          status,
          ...(status === "failed" ? { error: { message: `失败 ${SECRET}` } } : {}),
        },
      });
  });
  const provider = providerFor(base, { kind: "video", model: "MiniMax-H3" });
  await assert.rejects(call(provider, { maxPolls: 2 }), (error) => {
    assert.match(error.message, /远端任务 ID：recover-task/);
    assert.equal(error.terminalTask, undefined);
    return true;
  });
  const controller = new AbortController();
  onCreated = () => setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    call(provider, { signal: controller.signal, pollIntervalMs: 1000 }),
    (error) => {
      assert.match(error.message, /已停止.*recover-task/);
      assert.equal(error.terminalTask, undefined);
      return true;
    },
  );
  onCreated = undefined;
  await assert.rejects(
    call(provider, { timeoutMs: 80, pollIntervalMs: 1000 }),
    (error) => {
      assert.match(error.message, /超时.*recover-task/);
      assert.equal(error.terminalTask, undefined);
      return true;
    },
  );
  for (const value of ["failed", "cancelled", "unknown"]) {
    status = value;
    await assert.rejects(call(provider), (error) => {
      assert.match(error.message, /recover-task/);
      assert.ok(!error.message.includes(SECRET));
      assert.equal(error.terminalTask, value === "unknown" ? undefined : true);
      assert.equal(error.taskId, value === "unknown" ? undefined : "recover-task");
      assert.equal(error.taskStatus, value === "unknown" ? undefined : value);
      return true;
    });
  }
  assert.equal(posts, 6);
});

test("legacy MiniMax Fail is terminal but a query connection refusal remains recoverable", async (t) => {
  let unavailable = false;
  let posts = 0;
  const base = await serve(t, (req, res) => {
    if (req.method === "POST") {
      posts++;
      respond(res, { ...OK, task_id: "legacy-failed" });
    } else if (unavailable) {
      res.destroy();
    } else respond(res, { ...OK, task_id: "legacy-failed", status: "Fail" });
  });
  const provider = providerFor(base, { kind: "video", model: "MiniMax-Hailuo-2.3" });
  await assert.rejects(call(provider), (error) => {
    assert.equal(error.terminalTask, true);
    assert.equal(error.taskId, "legacy-failed");
    assert.equal(error.taskStatus, "Fail");
    assert.match(error.message, /legacy-failed/);
    return true;
  });
  unavailable = true;
  await assert.rejects(call(provider, { resumeTaskId: "legacy-failed" }), (error) => {
    assert.equal(error.terminalTask, undefined);
    assert.match(error.message, /legacy-failed/);
    return true;
  });
  assert.equal(posts, 1);
});

test("MiniMax task validation rejects malformed IDs, mismatched task results and altered shot parameters", async (t) => {
  let create = { task_id: "../bad" };
  let result;
  const base = await serve(t, (req, res) =>
    respond(res, req.method === "POST" ? create : result),
  );
  const provider = providerFor(base, { kind: "video", model: "MiniMax-H3" });
  await assert.rejects(call(provider), /有效的任务 ID/);
  create = { task_id: Number("176843862716480999") };
  await assert.rejects(call(provider), /有效的任务 ID/);
  create = { task_id: "safe-task" };
  result = {
    task: {
      id: "other-task",
      status: "succeeded",
      content: { url: "https://cdn.example.com/a.mp4" },
    },
  };
  await assert.rejects(call(provider), /不同的任务 ID.*safe-task/);
  result = {
    task: {
      status: "succeeded",
      duration: 6,
      ratio: "16:9",
      content: { url: "https://cdn.example.com/a.mp4" },
    },
  };
  await assert.rejects(
    call(provider, { videoOptions: { duration: 5, ratio: "9:16" } }),
    /时长或画幅.*safe-task/,
  );
  result = { task: { status: "succeeded", content: {} } };
  await assert.rejects(call(provider), /没有返回可用.*safe-task/);
});

test("legacy MiniMax business or file failures cannot become completed video outputs", async (t) => {
  let response = { ...OK, status: "Success", file_id: "12345" };
  let file = { base_resp: { status_code: 1008, status_msg: `余额不足 ${SECRET}` } };
  const base = await serve(t, (req, res) =>
    respond(
      res,
      req.method === "POST"
        ? { ...OK, task_id: "legacy-error" }
        : req.url.includes("/files/")
          ? file
          : response,
    ),
  );
  const provider = providerFor(base, { kind: "video", model: "MiniMax-Hailuo-02" });
  await assert.rejects(
    call(provider),
    (error) =>
      error.message.includes("legacy-error") &&
      error.message.includes("余额不足") &&
      !error.message.includes(SECRET),
  );
  file = { ...OK, file: {} };
  await assert.rejects(call(provider), /没有返回可用.*legacy-error/);
  response = {
    base_resp: { status_code: 1004, status_msg: `bad ${SECRET}` },
    status: "Success",
    file_id: "12345",
  };
  await assert.rejects(
    call(provider),
    (error) => error.message.includes("1004") && !error.message.includes(SECRET),
  );
  response = { ...OK, status: "Fail" };
  await assert.rejects(call(provider), /失败.*legacy-error/);
});

test("MiniMax health is read-only and does not claim media permission from a text model list", async (t) => {
  const requests = [];
  const base = await serve(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    respond(res, { data: [{ id: "MiniMax-M3" }] });
  });
  const message = await testProvider(providerFor(base));
  assert.match(message, /尚未执行生成/);
  assert.match(message, /未验证所选媒体模型/);
  assert.deepEqual(requests, ["GET /v1/models"]);
});

test("MiniMax never forwards credentials on redirect and redacts HTTP errors", async (t) => {
  let foreignCalls = 0;
  let redirect = false;
  const foreign = await serve(t, (_req, res) => {
    foreignCalls++;
    respond(res, {});
  });
  const base = await serve(t, (_req, res) => {
    if (redirect) {
      res.writeHead(307, { Location: foreign });
      res.end();
    } else respond(res, { error: { message: `bad ${SECRET}` } }, 401);
  });
  const provider = providerFor(base);
  await assert.rejects(
    call(provider),
    (error) => error.message.includes("401") && !error.message.includes(SECRET),
  );
  redirect = true;
  await assert.rejects(call(provider), /重定向/);
  await assert.rejects(testProvider(provider), /重定向/);
  assert.equal(foreignCalls, 0);
});
