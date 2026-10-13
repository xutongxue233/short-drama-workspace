import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { readConfig, PROJECT_ROOT } from "./config.mjs";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createChatService } from "./services/chat.mjs";
import { createSeedState, createProject } from "./seed.mjs";

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-architecture-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("configuration validates operational values and anchors relative data paths to the checkout", () => {
  const defaults = readConfig({});
  assert.equal(defaults.apiPort, 3001);
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(Object.hasOwn(defaults, "workflowStepMs"), false);
  assert.equal(defaults.databaseFile, resolve(PROJECT_ROOT, "data/workbench.sqlite"));
  assert.equal(defaults.distDir, resolve(PROJECT_ROOT, "dist"));
  assert.ok(Object.isFrozen(defaults));
  const relative = readConfig({
    WORKBENCH_DATA_DIR: "isolated-data",
    API_PORT: "4312",
  });
  assert.equal(relative.dataDir, resolve(PROJECT_ROOT, "isolated-data"));
  assert.equal(relative.apiPort, 4312);
  const absolute = resolve(tmpdir(), "frameflow-custom-data");
  assert.equal(readConfig({ WORKBENCH_DATA_DIR: absolute }).dataDir, absolute);
  for (const value of ["0", "65536", "1.2", "-1", "abc", "Infinity"])
    assert.throws(() => readConfig({ API_PORT: value }), /API_PORT must be an integer/);
});

test("importing the server from another working directory creates no data, listeners or signal hooks", (t) => {
  const directory = temporaryDirectory(t);
  const entry = new URL("./index.mjs", import.meta.url).href;
  const configuration = new URL("./config.mjs", import.meta.url).href;
  const script = `
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const { createApp } = await import(${JSON.stringify(entry)});
    const { readConfig } = await import(${JSON.stringify(configuration)});
    console.log(JSON.stringify({ before, after: [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], factory: typeof createApp, config: readConfig({}) }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.factory, "function");
  assert.deepEqual(result.before, result.after);
  assert.equal(result.config.databaseFile, readConfig({}).databaseFile);
  assert.deepEqual(readdirSync(directory), []);
});

test("app composition honors an injected storage location and closes idempotently", (t) => {
  const directory = temporaryDirectory(t);
  const config = {
    ...readConfig({}),
    databaseFile: join(directory, "checkpoints.sqlite"),
    distDir: join(directory, "no-build"),
  };
  const service = createApp({ config });
  t.after(service.close);
  assert.equal(service.store.filename, config.databaseFile);
  assert.equal(service.store.getState().projects.length, 0);
  assert.ok(readdirSync(directory).includes("checkpoints.sqlite"));
  service.close();
  assert.doesNotThrow(service.close);
});

test(
  "shutdown rejects a partially received request before it can mutate closed storage",
  { timeout: 10000 },
  async (t) => {
    const store = createStore({ filename: ":memory:" });
    let writes = 0;
    const service = createApp({
      config: readConfig({}),
      store: {
        ...store,
        save() {
          writes += 1;
          return store.save();
        },
      },
    });
    const projectCount = store.getState().projects.length;
    const server = service.app.listen(0, "127.0.0.1");
    let client;
    t.after(() => {
      client?.destroy();
      service.close();
      return new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    });
    await new Promise((resolve) => server.once("listening", resolve));
    const body = JSON.stringify({ name: "关停边界测试" });
    const arrived = new Promise((resolve) => server.once("request", resolve));
    const response = new Promise((resolve, reject) => {
      client = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: "/api/projects",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode, body: text }));
          res.on("error", reject);
        },
      );
      client.on("error", reject);
      client.write(body.slice(0, 1));
    });
    await arrived;
    service.close();
    server.close();
    client.end(body.slice(1));
    const result = await response;
    assert.equal(result.status, 503);
    assert.match(JSON.parse(result.body).error, /服务正在关闭/);
    assert.equal(writes, 0);
    assert.equal(store.getState().projects.length, projectCount);
  },
);

test(
  "chat service rejects overlapping replies and aborts outstanding requests without writing after shutdown",
  { timeout: 10000 },
  async (t) => {
    let requestArrived;
    const arrived = new Promise((resolve) => {
      requestArrived = resolve;
    });
    const upstream = createServer((_req, _res) => requestArrived());
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          upstream.close(resolve);
          upstream.closeAllConnections();
        }),
    );
    const state = createSeedState();
    const project = createProject({
      name: "隔离关停测试",
      genre: "悬疑",
      style: "真人短剧",
      episodes: 12,
      mode: "live",
    });
    state.projects = [project];
    state.providers = [
      {
        id: "local-mock",
        enabled: true,
        kind: "text",
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${upstream.address().port}`,
        model: "test-model",
        apiKey: "",
      },
    ];
    state.agents.find((agent) => agent.id === "producer").providerId = "local-mock";
    let writes = 0;
    const chat = createChatService({
      getState: () => state,
      save: () => {
        writes += 1;
      },
      workflow: { invite() {} },
    });
    t.after(chat.close);
    const pending = chat.sendMessage(project, { content: "请检查剧情" });
    await arrived;
    await assert.rejects(
      chat.sendMessage(project, { content: "重复请求" }),
      (error) => error.status === 409,
    );
    const writesBeforeClose = writes;
    chat.close();
    assert.equal(
      writes,
      writesBeforeClose + 1,
      "interruption is saved synchronously while the store is still open",
    );
    const writesAfterClose = writes;
    const savedMessage = await pending;
    assert.equal(savedMessage.content, "请检查剧情");
    assert.equal(writes, writesAfterClose);
    assert.equal(project.messages.at(-1).event.kind, "paused");
    await assert.rejects(
      chat.sendMessage(project, { content: "关停后请求" }),
      (error) => error.status === 503,
    );
  },
);
