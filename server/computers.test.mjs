import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createSeedState, createProject } from "./seed.mjs";
import { readConfig } from "./config.mjs";
import { authenticatedFetch } from "./test-support/auth.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";
import { createComputerService } from "./services/computers.mjs";
import { createChatService } from "./services/chat.mjs";
import { createWorkflow } from "./workflow.mjs";

const TOKEN = "synthetic-computer-token-never-real-123456789";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
  "base64",
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const admin = { id: "owner", displayName: "Owner", role: "admin" };
const action = { type: "click", x: 0.4, y: 0.6 };

async function bridgeFixture(t) {
  const calls = [];
  let mode = null,
    token = null,
    version = 0,
    fail = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    calls.push({ path: req.url, body, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end(JSON.stringify({ error: "invalid token" }));
      return;
    }
    if (fail) {
      res.writeHead(503).end(JSON.stringify({ error: TOKEN }));
      return;
    }
    if (req.url === "/screenshot") {
      res.setHeader("Content-Type", "image/png");
      res.end(PNG);
      return;
    }
    if (req.url === "/control") {
      if (
        !Number.isSafeInteger(body.controlVersion) ||
        body.controlVersion < version ||
        (body.controlVersion === version &&
          (body.controlToken !== token || body.mode !== mode))
      ) {
        res.writeHead(409).end(JSON.stringify({ error: "stale lease" }));
        return;
      }
      mode = body.mode;
      token = body.controlToken;
      version = body.controlVersion;
    } else if (req.url === "/actions") {
      if (
        body.actor !== mode ||
        body.controlToken !== token ||
        body.controlVersion !== version
      ) {
        res.writeHead(409).end(JSON.stringify({ error: "wrong lease" }));
        return;
      }
    } else {
      res.writeHead(404).end("{}");
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    calls,
    set fail(value) {
      fail = value;
    },
    get version() {
      return version;
    },
  };
}

async function fixture(t, { respond } = {}) {
  const bridge = await bridgeFixture(t);
  const model = await createLocalModel(t, { respond });
  const directory = mkdtempSync(join(tmpdir(), "frameflow-computers-"));
  const filename = join(directory, "workspace.sqlite");
  let service, server, session, base;
  async function start() {
    const store = createStore({
      filename,
      seed() {
        const state = createSeedState();
        model.bind(state);
        state.projects = [
          createProject({ name: "电脑绑定测试" }),
          createProject({ name: "共享电脑测试" }),
        ];
        for (const project of state.projects)
          project.chapters = [
            { id: "chapter-1", title: "本集", content: "林晚在旧邮局见到陈渡。" },
          ];
        return state;
      },
    });
    service = createApp({
      store,
      config: readConfig({ WORKBENCH_DATA_DIR: directory }),
    });
    server = await new Promise((resolve) => {
      const server = service.app.listen(0, "127.0.0.1", () => resolve(server));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    session = await authenticatedFetch(base);
  }
  async function stop() {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
  await start();
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const fx = {
    bridge,
    model,
    filename,
    get service() {
      return service;
    },
    get state() {
      return service.store.getState();
    },
    get session() {
      return session;
    },
    get base() {
      return base;
    },
    async restart() {
      await stop();
      await start();
    },
    fetch(path, options) {
      return session.fetch(`${base}/api${path}`, options);
    },
    async api(path, method = "GET", body) {
      const response = await fx.fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    async addComputer() {
      const result = await fx.api("/computers", "POST", {
        name: "制作电脑",
        endpoint: bridge.endpoint,
        token: TOKEN,
      });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.body.computer;
    },
    async bind(agentId, computerId) {
      const result = await fx.api(`/agents/${agentId}`, "PATCH", { computerId });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    },
    async addUser(username, role = "user") {
      const password = "Another-fixture-password-123";
      assert.equal(
        (
          await fx.api("/users", "POST", {
            username,
            displayName: username,
            role,
            password,
          })
        ).status,
        201,
      );
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      const headers = {
        Cookie: response.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": data.csrfToken,
        "Content-Type": "application/json",
      };
      return (path, method = "GET", body) =>
        fetch(`${base}/api${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    },
  };
  return fx;
}

test("computer binding, encrypted credentials and durable takeover survive restart without public secrets", async (t) => {
  const f = await fixture(t),
    computer = await f.addComputer();
  await f.bind("producer", computer.id);
  const watched = await f.fetch(`/computers/${computer.id}/screen`);
  assert.equal(watched.status, 200);
  assert.equal(watched.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await watched.arrayBuffer()), PNG);
  assert.deepEqual(
    f.bridge.calls.map((call) => call.path),
    ["/screenshot"],
  );
  assert.equal(f.state.computers[0].control.mode, "agent");
  assert.equal(
    (await f.api(`/computers/${computer.id}/actions`, "POST", action)).status,
    409,
  );
  assert.equal(
    (await f.api(`/agents/producer/computer/actions`, "POST", action)).status,
    200,
  );
  assert.equal(
    (await f.api(`/computers/${computer.id}/takeover`, "POST", {})).status,
    200,
  );
  assert.equal(
    (await f.api(`/agents/producer/computer/actions`, "POST", action)).status,
    409,
  );
  assert.equal(
    (await f.api(`/computers/${computer.id}/actions`, "POST", action)).status,
    200,
  );
  const version = f.bridge.version;
  for (const path of ["/state", "/computers"]) {
    const json = JSON.stringify((await f.api(path)).body);
    assert.ok(!json.includes(TOKEN));
    assert.ok(!json.includes("controlToken"));
    assert.ok(!json.includes("controlVersion"));
  }
  const db = new DatabaseSync(f.filename);
  const metadata = db.prepare("SELECT value FROM workspace_metadata").get().value;
  assert.ok(!metadata.includes(TOKEN));
  assert.equal(JSON.parse(metadata).computers[0].token.cipher, "aes-256-gcm-v1");
  db.close();
  await f.restart();
  assert.equal(
    f.state.agents.find((agent) => agent.id === "producer").computerId,
    computer.id,
  );
  assert.equal(f.state.computers[0].token, TOKEN);
  assert.equal(f.state.computers[0].control.mode, "human");
  assert.equal(
    (await f.api(`/agents/producer/computer/actions`, "POST", action)).status,
    409,
  );
  assert.equal(
    (await f.api(`/computers/${computer.id}/release`, "POST", {})).status,
    200,
  );
  assert.ok(f.bridge.version > version);
  assert.equal(
    (await f.api(`/agents/producer/computer/actions`, "POST", action)).status,
    200,
  );
  assert.equal((await f.api(`/computers/${computer.id}`, "DELETE")).status, 409);
  await f.bind("producer", "");
  assert.equal((await f.api(`/computers/${computer.id}`, "DELETE")).status, 200);
  const replacement = await f.addComputer();
  await f.bind("producer", replacement.id);
  assert.equal(
    (await f.api(`/agents/producer/computer/actions`, "POST", action)).status,
    200,
  );
  assert.ok(f.bridge.version > version);
  const audit = f.state.security.audit.map((item) => item.action);
  assert.ok(audit.includes("computers.takeover"));
  assert.ok(audit.includes("computers.release"));
});

test("computer access is admin-only, CSRF protected, and an owner cannot be silently replaced", async (t) => {
  const f = await fixture(t),
    computer = await f.addComputer();
  await f.bind("producer", computer.id);
  const user = await f.addUser("member"),
    other = await f.addUser("other-admin", "admin");
  assert.equal((await fetch(`${f.base}/api/computers`)).status, 401);
  for (const [path, method, body] of [
    ["/computers", "GET"],
    [`/computers/${computer.id}/screen`, "GET"],
    [`/computers/${computer.id}/takeover`, "POST", {}],
    [`/computers/${computer.id}/actions`, "POST", action],
    ["/agents/producer/computer/actions", "POST", action],
  ])
    assert.equal((await user(path, method, body)).status, 403);
  assert.equal(
    (
      await f.fetch(`/computers/${computer.id}/takeover`, {
        method: "POST",
        headers: { "X-CSRF-Token": "", "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  await f.api(`/computers/${computer.id}/takeover`, "POST", {});
  for (const suffix of ["takeover", "release", "actions"])
    assert.equal(
      (
        await other(
          `/computers/${computer.id}/${suffix}`,
          "POST",
          suffix === "actions" ? action : {},
        )
      ).status,
      409,
    );
  assert.equal(
    (await other(`/computers/${computer.id}/release`, "POST", { force: true })).status,
    200,
  );
});

test("invalid destinations, duplicate physical identities and invalid actions never dispatch", async (t) => {
  const f = await fixture(t),
    computer = await f.addComputer();
  await f.bind("producer", computer.id);
  for (const endpoint of [
    "file:///tmp/x",
    "http://192.168.1.5:8765",
    "https://user:pw@example.test",
    "https://example.test/?token=x",
    "https://example.test/path",
  ]) {
    const result = await f.api("/computers", "POST", {
      name: "bad",
      endpoint,
      token: `${TOKEN}-other`,
    });
    assert.equal(result.status, 400);
  }
  for (const input of [
    { endpoint: f.bridge.endpoint, token: `${TOKEN}-other` },
    { endpoint: "http://localhost:9999", token: TOKEN },
  ])
    assert.equal(
      (await f.api("/computers", "POST", { name: "duplicate", ...input })).status,
      409,
    );
  assert.equal(
    (await f.api("/agents/producer", "PATCH", { computerId: "missing" })).status,
    400,
  );
  for (const invalid of [
    { type: "click", x: -1, y: 0.5 },
    { type: "click", x: 0.5, y: "0.2" },
    { type: "key", key: "powershell" },
    { type: "shell", command: "anything" },
    { type: "scroll", delta: 1000 },
    { type: "text", text: "x".repeat(4001) },
  ])
    assert.equal(
      (await f.api("/agents/producer/computer/actions", "POST", invalid)).status,
      400,
    );
  assert.equal(f.bridge.calls.length, 0);
  assert.equal(
    (await f.api(`/computers/${computer.id}/takeover`, "POST", {})).status,
    200,
  );
  assert.equal(
    (await f.api("/agents/producer", "PATCH", { computerId: "" })).status,
    409,
  );
  assert.equal(
    (await f.api(`/computers/${computer.id}`, "PATCH", { name: "rename" })).status,
    409,
  );
});

test("bridge failure retains the human lock, hides remote secrets and never resumes jobs", async (t) => {
  const f = await fixture(t),
    computer = await f.addComputer();
  await f.bind("producer", computer.id);
  f.bridge.fail = true;
  const result = await f.api(`/computers/${computer.id}/takeover`, "POST", {});
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.equal(f.state.computers[0].control.mode, "human");
  const project = f.state.projects[0];
  assert.equal((await f.api(`/projects/${project.id}/run`, "POST", {})).status, 409);
  assert.equal(
    (
      await f.api(`/projects/${project.id}/messages`, "POST", {
        content: "讨论本集",
        agentId: "producer",
        intent: "discussion",
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.api(`/computers/${computer.id}/release`, "POST", {})).status,
    502,
  );
  assert.equal(f.state.computers[0].control.mode, "human");
  f.bridge.fail = false;
  assert.equal(
    (await f.api(`/computers/${computer.id}/release`, "POST", {})).status,
    200,
  );
  assert.equal(project.running, false);
  assert.equal(f.model.requests.length, 0);
});

test("takeover pauses every bound in-flight chat and workflow and suppresses late replies", async (t) => {
  const dispatched = deferred(),
    finish = deferred();
  let count = 0;
  const f = await fixture(t, {
    respond: async () => {
      if (++count === 2) dispatched.resolve();
      await finish.promise;
      return "late result must not appear";
    },
  });
  t.after(() => finish.resolve());
  const computer = await f.addComputer();
  await f.bind("producer", computer.id);
  await f.bind("writer", computer.id);
  const [workflowProject, chatProject] = f.state.projects;
  assert.equal(
    (await f.api(`/projects/${workflowProject.id}/run`, "POST", {})).status,
    202,
  );
  const job = f.service.workflow.jobs.get(workflowProject.id).promise;
  const pending = f.api(`/projects/${chatProject.id}/messages`, "POST", {
    content: "请讨论人物",
    agentId: "writer",
    intent: "discussion",
  });
  await dispatched.promise;
  const watched = await f.fetch(`/computers/${computer.id}/screen`);
  await watched.arrayBuffer();
  assert.equal(workflowProject.running, true);
  assert.equal(
    (await f.api(`/computers/${computer.id}/takeover`, "POST", {})).status,
    200,
  );
  assert.equal(workflowProject.running, false);
  assert.equal(workflowProject.nodes[0].status, "pending");
  finish.resolve();
  await Promise.all([job, pending]);
  for (const project of [workflowProject, chatProject]) {
    assert.ok(
      project.messages.some(
        (message) =>
          message.event?.kind === "paused" &&
          message.event.phase === "computer-takeover",
      ),
    );
    assert.ok(
      !project.messages.some((message) =>
        message.content.includes("late result must not appear"),
      ),
    );
  }
  await f.api(`/computers/${computer.id}/release`, "POST", {});
  assert.equal(workflowProject.running, false);
  assert.equal(f.model.requests.length, 2);
});

test("takeover fences an action between remote control and dispatch, and queued actions cannot escape", async () => {
  const reached = deferred(),
    release = deferred(),
    calls = [];
  const state = {
    agents: [{ id: "a", enabled: true, computerId: "pc" }],
    computers: [
      {
        id: "pc",
        name: "PC",
        token: TOKEN,
        endpoint: "http://127.0.0.1:1",
        control: { mode: "agent" },
      },
    ],
  };
  const service = createComputerService({
    getState: () => state,
    save() {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (calls.length === 1) {
        reached.resolve();
        await release.promise;
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const first = service.action("pc", action, { agentId: "a" });
  const second = service.action("pc", action, { agentId: "a" });
  const firstRejected = assert.rejects(first, (error) => error.status === 409);
  const secondRejected = assert.rejects(second, (error) => error.status === 409);
  await reached.promise;
  const takeover = service.takeover("pc", admin);
  assert.equal(state.computers[0].control.mode, "human");
  assert.throws(
    () => service.assertAgentAvailable("a"),
    (error) => error.status === 409,
  );
  release.resolve();
  await Promise.all([firstRejected, secondRejected, takeover]);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/control", "/control"],
  );
  assert.equal(calls.at(-1).body.mode, "human");
  assert.ok(calls.at(-1).body.controlVersion > calls[0].body.controlVersion);
});

test("takeover during awaited chat references prevents upstream dispatch even after release", async (t) => {
  const model = await createLocalModel(t),
    state = createSeedState(),
    reached = deferred(),
    finish = deferred();
  model.bind(state);
  const project = createProject({ name: "reference-race" });
  state.projects = [project];
  state.computers = [
    {
      id: "pc",
      name: "PC",
      endpoint: "http://127.0.0.1:1",
      token: TOKEN,
      control: { mode: "agent" },
    },
  ];
  state.agents.find((agent) => agent.id === "producer").computerId = "pc";
  const dependencies = { getState: () => state, save() {} };
  const computers = createComputerService({
    ...dependencies,
    fetchImpl: async () => new Response('{"ok":true}'),
  });
  const workflow = createWorkflow({ ...dependencies, computers });
  const chat = createChatService({
    ...dependencies,
    computers,
    workflow,
    materials: {
      async references() {
        reached.resolve();
        await finish.promise;
        return [];
      },
    },
  });
  computers.attachRunners({ chat, workflow });
  const reply = chat.sendMessage(project, {
    content: "讨论本集",
    agentId: "producer",
    intent: "discussion",
  });
  await reached.promise;
  await computers.takeover("pc", admin);
  await computers.release("pc", admin);
  finish.resolve();
  await reply;
  assert.equal(model.requests.length, 0);
  assert.equal(chat.getPending(project.id), null);
  assert.ok(project.messages.some((message) => message.event?.kind === "paused"));
  assert.ok(!project.messages.some((message) => message.event?.kind === "error"));
});

test("persistence failures keep jobs paused and prevent physical input until the lock and fence can be saved", async () => {
  const calls = [],
    paused = [];
  let failWrites = true,
    failRelease = false,
    checkpoint;
  const state = {
    agents: [{ id: "a", enabled: true, computerId: "pc" }],
    computers: [
      {
        id: "pc",
        name: "PC",
        token: TOKEN,
        endpoint: "http://127.0.0.1:1",
        control: { mode: "agent" },
      },
    ],
  };
  const service = createComputerService({
    getState: () => state,
    save() {
      if (failRelease && state.computers[0].control.mode === "agent") failWrites = true;
      if (failWrites) throw new Error("disk unavailable");
      checkpoint = structuredClone(state);
    },
    fetchImpl: async (url, options) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
      return new Response('{"ok":true}');
    },
  });
  service.attachRunners({
    chat: {
      pauseAgents(ids) {
        paused.push([...ids]);
      },
    },
    workflow: {
      pauseAgents(ids) {
        paused.push([...ids]);
      },
    },
  });
  await assert.rejects(service.takeover("pc", admin), /disk unavailable/);
  assert.deepEqual(paused, [["a"], ["a"]]);
  assert.equal(state.computers[0].control.mode, "human");
  assert.equal(calls.length, 1);
  await assert.rejects(
    service.action("pc", action, { user: admin }),
    /disk unavailable/,
  );
  assert.equal(calls.length, 1);
  failWrites = false;
  await service.action("pc", action, { user: admin });
  assert.equal(checkpoint.computers[0].control.mode, "human");
  assert.equal(calls.at(-1).path, "/actions");
  assert.equal(
    calls.at(-1).body.controlVersion,
    checkpoint.computers[0].controlVersion,
  );
  failRelease = true;
  await assert.rejects(service.release("pc", admin), /disk unavailable/);
  assert.equal(state.computers[0].control.mode, "human");
  const count = calls.length;
  await assert.rejects(
    service.action("pc", action, { user: admin }),
    /disk unavailable/,
  );
  assert.equal(calls.length, count);
});

test("a downstream takeover preserves the completed prior workflow node and pauses the next", async (t) => {
  const model = await createLocalModel(t),
    state = createSeedState();
  model.bind(state);
  const project = createProject({ name: "downstream-lock" });
  // Compliance completes without an approval card, then hands off to characters.
  project.nodes.forEach((node, index) => {
    if (index < 2) node.status = "completed";
  });
  project.chapters = [
    { id: "chapter", title: "本集", content: "林晚在旧邮局见到陈渡。" },
  ];
  state.projects = [project];
  state.computers = [
    { id: "pc", name: "PC", control: { mode: "human", ownerId: admin.id } },
  ];
  state.agents.find((agent) => agent.id === "character").computerId = "pc";
  const dependencies = { getState: () => state, save() {} };
  const computers = createComputerService(dependencies),
    workflow = createWorkflow({ ...dependencies, computers });
  workflow.start(project);
  await workflow.jobs.get(project.id).promise;
  assert.equal(
    project.nodes.find((node) => node.id === "compliance").status,
    "completed",
  );
  assert.equal(
    project.nodes.find((node) => node.id === "characters").status,
    "pending",
  );
  assert.equal(project.running, false);
  assert.equal(model.requests.length, 1);
  assert.ok(
    project.messages.some(
      (message) => message.nodeId === "characters" && message.event?.kind === "paused",
    ),
  );
});
