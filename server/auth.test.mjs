import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState, uid } from "./seed.mjs";
import { readConfig } from "./config.mjs";

const PASSWORD = "A-long-test-password-2026";
async function fixture(t, { config: configChanges = {}, synthetic = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "frameflow-auth-"));
  const legacy = createProject({ name: "历史项目" });
  const materialId = uid("material");
  legacy.materials = [
    {
      id: materialId,
      projectId: legacy.id,
      type: "image",
      status: "remote",
      name: "私有素材",
      url: "https://example.test/private.png",
    },
  ];
  const state = {
    ...createSeedState(),
    projects: [legacy],
    privateSentinel: "do-not-serialize",
  };
  const store = synthetic
    ? {
        getState: () => state,
        save() {
          if (store.failWrites) throw new Error("Injected persistence failure");
        },
        close() {},
      }
    : createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({
    store,
    config: { ...readConfig({ WORKBENCH_DATA_DIR: dataDir }), ...configChanges },
  });
  const server = await new Promise((resolve) => {
    const server = service.app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    service.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  }
  const client = () => ({
    headers: {},
    user: null,
    async auth(path, input) {
      const response = await request(path, { method: "POST", body: input });
      if (response.status === 200 || response.status === 201) {
        this.headers = {
          Cookie: response.headers.get("set-cookie").split(";")[0],
          "X-CSRF-Token": response.body.csrfToken,
        };
        this.user = response.body.user;
      }
      return response;
    },
    call(path, method = "GET", body, extra = {}) {
      return request(path, { method, body, headers: { ...this.headers, ...extra } });
    },
  });
  async function setup() {
    const owner = client();
    const response = await owner.auth("/auth/setup", {
      username: "owner",
      displayName: "项目负责人",
      password: PASSWORD,
      ...(configChanges.setupToken ? { setupToken: configChanges.setupToken } : {}),
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return owner;
  }
  async function addUser(owner, username, extra = {}) {
    const response = await owner.call("/users", "POST", {
      username,
      displayName: username,
      password: PASSWORD,
      ...extra,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const user = client();
    assert.equal(
      (await user.auth("/auth/login", { username, password: PASSWORD })).status,
      200,
    );
    return user;
  }
  return { request, client, setup, addUser, store, legacy, materialId, base };
}

test("bootstrap claims legacy projects once, stores scrypt hashes and never exposes security", async (t) => {
  const f = await fixture(t, { synthetic: true });
  assert.deepEqual((await f.request("/auth/session")).body, {
    setupRequired: true,
    user: null,
  });
  assert.equal((await f.request("/state")).status, 401);
  assert.equal((await f.request("/unknown")).status, 401);
  assert.equal((await f.request("/health")).status, 200);
  const owner = await f.setup();
  assert.equal(
    (
      await f.request("/auth/setup", {
        method: "POST",
        body: { username: "intruder", password: PASSWORD },
      })
    ).status,
    409,
  );
  const view = await owner.call("/state");
  assert.equal(view.body.currentUser.id, owner.user.id);
  assert.equal(view.body.projects[0].participants[0].displayName, "项目负责人");
  assert.equal(view.body.projects[0].currentUserAccess, "owner");
  for (const forbidden of [
    "security",
    "privateSentinel",
    "passwordHash",
    "csrfToken",
    "tokenHash",
    "systemPromptSecret",
  ])
    assert.equal(Object.hasOwn(view.body, forbidden), false);
  const internal = f.store.getState().security;
  assert.match(internal.users[0].passwordHash, /^scrypt-v1\$/);
  assert.equal(JSON.stringify(internal).includes(PASSWORD), false);
  assert.equal(
    JSON.stringify(internal).includes(owner.headers.Cookie.split("=")[1]),
    false,
  );
  const exported = await owner.call(`/projects/${f.legacy.id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(JSON.stringify(exported.body).includes("scrypt-v1"), false);
  assert.ok(exported.body.agents.every((agent) => !agent.systemPrompt));
});

test("session cookie, CSRF, same-origin and logout enforce request boundaries", async (t) => {
  const f = await fixture(t);
  const c = f.client();
  const response = await c.auth("/auth/setup", {
    username: "owner",
    password: PASSWORD,
  });
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=43200/);
  assert.equal((await c.call("/state")).headers.get("cache-control"), "no-store");
  for (const path of ["/API/state", `/API/media/${f.materialId}/file`]) {
    const alias = await fetch(`${f.base}${path}`, { headers: c.headers });
    assert.equal(alias.headers.get("cache-control"), "no-store");
    await alias.arrayBuffer();
  }
  assert.equal(
    (await c.call("/projects", "POST", { name: "fail" }, { "X-CSRF-Token": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request("/projects", {
        method: "POST",
        body: { name: "fail" },
        headers: { Cookie: c.headers.Cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c.call(
        "/projects",
        "POST",
        { name: "fail" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await c.call(
        "/projects",
        "POST",
        { name: "fail" },
        { Origin: "http://localhost:9999" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await c.call("/state", "GET", undefined, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
  assert.equal((await c.call("/auth/logout", "POST", {})).status, 200);
  assert.equal((await c.call("/state")).status, 401);
  assert.equal(
    (await f.request("/auth/session", { headers: c.headers })).body.user,
    null,
  );
});

test("memberships isolate every read path and indirect media/project identifier even for admins", async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const outsider = await f.addUser(owner, "outsider");
  for (const path of [
    `/projects/${f.legacy.id}`,
    `/projects/${f.legacy.id}/export`,
    `/projects/${f.legacy.id}/messages`,
    `/projects/${f.legacy.id}/assets`,
    `/projects/${f.legacy.id}/materials`,
    `/media/${f.materialId}/file`,
  ])
    assert.equal((await outsider.call(path)).status, 404, path);
  for (const suffix of [
    "",
    "?compact=1",
    `?compact=1&projectId=${f.legacy.id}`,
    `?projectId=${f.legacy.id}&history=full`,
  ]) {
    const view = (await outsider.call(`/state${suffix}`)).body;
    assert.deepEqual(view.projects, []);
    assert.deepEqual(view.projectSummaries || [], []);
    assert.deepEqual(view.providers, []);
    assert.ok(
      view.agents.every(
        (agent) => !agent.systemPrompt && !agent.providerId && !agent.model,
      ),
    );
    assert.equal(JSON.stringify(view).includes("私有素材"), false);
  }
  assert.equal((await outsider.call("/providers")).status, 403);
  assert.equal((await outsider.call("/users")).status, 403);
  assert.equal((await outsider.call("/audit")).status, 403);
  assert.equal(
    (await outsider.call("/agents/producer", "PATCH", { name: "spoof" })).status,
    403,
  );
  const privateProject = (
    await outsider.call("/projects", "POST", { name: "独立项目" })
  ).body;
  assert.equal(privateProject.currentUserAccess, "owner");
  assert.equal((await owner.call(`/projects/${privateProject.id}`)).status, 404);
  assert.equal(
    (
      await owner.call("/providers/provider-image/image-test", "POST", {
        projectId: privateProject.id,
        model: "test",
      })
    ).status,
    404,
  );
});

test("viewer/member/editor/owner capabilities resist casing bypasses and forged senders", async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const viewer = await f.addUser(owner, "viewer");
  const member = await f.addUser(owner, "member", { displayName: "普通用户" });
  const editor = await f.addUser(owner, "human-editor", { displayName: "总制片" });
  for (const [user, access] of [
    [viewer, "viewer"],
    [member, "member"],
    [editor, "editor"],
  ]) {
    const response = await owner.call(`/projects/${f.legacy.id}/participants`, "POST", {
      username: user.user.username,
      access,
      ...(access === "editor" ? { jobTitle: "剪辑师" } : {}),
    });
    assert.equal(response.status, 201);
  }
  const p = `/projects/${f.legacy.id}`;
  assert.equal((await viewer.call(p)).status, 200);
  for (const [method, path, body] of [
    ["POST", `${p}/messages`, { content: "hello", agentId: null }],
    ["PATCH", p, { name: "fail" }],
    ["POST", `${p}/run`, {}],
    ["DELETE", `${p}/materials/${f.materialId}`, undefined],
  ])
    assert.equal((await viewer.call(path, method, body)).status, 403);
  const message = await member.call(`${p}/messages/`, "POST", {
    content: "你好剪辑师",
    agentId: null,
    sender: { id: owner.user.id, displayName: "伪造" },
    recipientUserId: editor.user.id,
  });
  assert.equal(message.status, 201);
  assert.deepEqual(message.body.sender, {
    id: member.user.id,
    displayName: "普通用户",
    kind: "human",
  });
  assert.equal(message.body.recipientUserId, editor.user.id);
  assert.equal(
    (
      await member.call(`${p}/messages`, "POST", {
        content: "开始制作",
        agentId: "producer",
      })
    ).status,
    403,
  );
  assert.equal((await member.call(`${p}/run`, "POST", {})).status, 403);
  assert.equal((await member.call(p, "PATCH", { name: "fail" })).status, 403);
  assert.equal((await editor.call(p, "PATCH", { name: "编辑后的项目" })).status, 200);
  for (const path of [`${p}/participants`, `${p}/PARTICIPANTS`, `${p}/Participants/`])
    assert.equal(
      (await editor.call(path, "POST", { username: "owner" })).status,
      403,
      path,
    );
  const before = f.store.getState().projects[0].messages.length;
  const humanMention = await member.call(`${p}/messages`, "POST", {
    content: "@总制片 这是给真实用户的消息",
  });
  assert.equal(humanMention.status, 201);
  assert.equal(humanMention.body.recipientUserId, editor.user.id);
  assert.equal(f.store.getState().projects[0].messages.length, before + 1);
  assert.equal(
    (await owner.call(`${p}/participants/${owner.user.id}`, "DELETE")).status,
    409,
  );
  assert.equal(
    (await owner.call(`${p}/participants/${viewer.user.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await viewer.call(p)).status, 404);
});

test("bots retain distinct identity and disabling/resetting accounts revokes all sessions", async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const bot = await f.addUser(owner, "cutting-bot", { kind: "bot" });
  const p = `/projects/${f.legacy.id}`;
  assert.equal(
    (
      await owner.call(`${p}/participants`, "POST", {
        userId: bot.user.id,
        access: "member",
      })
    ).status,
    201,
  );
  const message = await bot.call(`${p}/messages`, "POST", {
    content: "剪辑任务完成",
    agentId: null,
    kind: "human",
  });
  assert.equal(message.body.sender.kind, "bot");
  const second = f.client();
  assert.equal(
    (await second.auth("/auth/login", { username: "cutting-bot", password: PASSWORD }))
      .status,
    200,
  );
  assert.equal(
    (
      await owner.call(`/users/${bot.user.id}`, "PATCH", {
        password: "Replacement-password-2026",
      })
    ).status,
    200,
  );
  assert.equal((await bot.call("/state")).status, 401);
  assert.equal((await second.call("/state")).status, 401);
  assert.equal(
    (await bot.auth("/auth/login", { username: "cutting-bot", password: PASSWORD }))
      .status,
    401,
  );
  assert.equal(
    (
      await bot.auth("/auth/login", {
        username: "cutting-bot",
        password: "Replacement-password-2026",
      })
    ).status,
    200,
  );
  assert.equal(
    (await owner.call(`/users/${bot.user.id}`, "PATCH", { disabled: true })).status,
    200,
  );
  assert.equal((await bot.call("/state")).status, 401);
  assert.equal(
    (
      await bot.auth("/auth/login", {
        username: "cutting-bot",
        password: "Replacement-password-2026",
      })
    ).status,
    401,
  );
  assert.equal(
    (await owner.call(`/users/${owner.user.id}`, "PATCH", { disabled: true })).status,
    409,
  );
  assert.equal(
    (await owner.call(`/users/${owner.user.id}`, "PATCH", { role: "user" })).status,
    409,
  );
  const audit = (await owner.call("/audit")).body.events;
  assert.ok(audit.some((event) => event.action === "user.password.reset"));
  assert.ok(
    audit.some((event) => event.action === "auth.login" && event.outcome === "denied"),
  );
  assert.equal(JSON.stringify(audit).includes(PASSWORD), false);
});

test("own password change rotates session, invalidates other sessions and rejects stale credentials", async (t) => {
  const f = await fixture(t);
  const owner = await f.setup();
  const second = f.client();
  await second.auth("/auth/login", { username: "owner", password: PASSWORD });
  assert.equal(
    (
      await owner.call("/auth/password", "PATCH", {
        currentPassword: "wrong",
        newPassword: "Changed-password-2026",
      })
    ).status,
    400,
  );
  const changed = await owner.call("/auth/password", "PATCH", {
    currentPassword: PASSWORD,
    newPassword: "Changed-password-2026",
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.body.csrfToken, owner.headers["X-CSRF-Token"]);
  assert.equal((await owner.call("/state")).status, 401);
  assert.equal((await second.call("/state")).status, 401);
  assert.equal(
    (await owner.auth("/auth/login", { username: "owner", password: PASSWORD })).status,
    401,
  );
  assert.equal(
    (
      await owner.auth("/auth/login", {
        username: "owner",
        password: "Changed-password-2026",
      })
    ).status,
    200,
  );
  f.store.getState().security.sessions.forEach((session) => {
    session.expiresAt = 0;
  });
  assert.equal((await owner.call("/state")).status, 401);
});

test("failed logins are rate limited and first setup is atomic", async (t) => {
  const f = await fixture(t, { synthetic: true });
  const attempts = await Promise.all(
    [1, 2].map((index) =>
      f.request("/auth/setup", {
        method: "POST",
        body: { username: `owner-${index}`, password: PASSWORD },
      }),
    ),
  );
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
  assert.equal(f.store.getState().security.users.length, 1);
  for (let index = 0; index < 10; index++)
    assert.equal(
      (
        await f.request("/auth/login", {
          method: "POST",
          body: { username: "missing-account", password: PASSWORD },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await f.request("/auth/login", {
        method: "POST",
        body: { username: "missing-account", password: PASSWORD },
      })
    ).status,
    429,
  );
});

test("security mutations roll back users, sessions and ownership when saving fails", async (t) => {
  const f = await fixture(t, { synthetic: true });
  t.mock.method(console, "error", () => {});
  f.store.failWrites = true;
  assert.equal(
    (
      await f.request("/auth/setup", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
      })
    ).status,
    500,
  );
  assert.equal(f.store.getState().security.users.length, 0);
  assert.equal(f.store.getState().security.sessions.length, 0);
  assert.equal(f.store.getState().projects[0].participants, undefined);
  f.store.failWrites = false;
  const owner = await f.setup();
  const member = await f.addUser(owner, "member");
  f.store.failWrites = true;
  assert.equal(
    (await owner.call(`/users/${member.user.id}`, "PATCH", { disabled: true })).status,
    500,
  );
  assert.equal((await member.call("/state")).status, 200);
  assert.equal(
    f.store.getState().security.users.find((user) => user.id === member.user.id)
      .disabled,
    false,
  );
  assert.equal(
    (
      await owner.call(`/projects/${f.legacy.id}/participants`, "POST", {
        userId: member.user.id,
      })
    ).status,
    500,
  );
  assert.equal(f.store.getState().projects[0].participants.length, 1);
  f.store.failWrites = false;
});

test("remote bootstrap requires operator token and HTTPS sessions use Secure cookies", async (t) => {
  assert.throws(() => readConfig({ WORKBENCH_HOST: "0.0.0.0" }), /HTTPS/);
  assert.throws(() => readConfig({ WORKBENCH_ORIGIN: "http://example.test" }), /HTTPS/);
  assert.throws(() => readConfig({ WORKBENCH_SETUP_TOKEN: "short" }), /32/);
  assert.throws(() => readConfig({ WORKBENCH_TRUST_PROXY: "yes" }), /true or false/);
  assert.throws(
    () => readConfig({ WORKBENCH_TRUST_PROXY: "true" }),
    /WORKBENCH_ORIGIN/,
  );
  assert.equal(readConfig({}).trustProxy, false);
  const token = "operator-setup-token-32-characters-minimum";
  const f = await fixture(t, {
    config: { publicOrigin: "https://studio.example.test", setupToken: token },
  });
  assert.equal(
    (
      await f.request("/auth/setup", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
      })
    ).status,
    403,
  );
  const response = await f.request("/auth/setup", {
    method: "POST",
    body: { username: "owner", password: PASSWORD, setupToken: token },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  const blocked = await fixture(t, {
    config: { publicOrigin: "https://studio.example.test" },
  });
  assert.equal(
    (
      await blocked.request("/auth/setup", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
      })
    ).status,
    403,
  );
});

test("explicit loopback proxy trust isolates client rate limits and untrusted forwarding is ignored", async (t) => {
  const remoteConfig = {
    publicOrigin: "https://studio.example.test",
    setupToken: "operator-setup-token-32-characters-minimum",
  };
  const trusted = await fixture(t, { config: { ...remoteConfig, trustProxy: true } });
  await trusted.setup();
  for (let index = 0; index < 10; index++)
    assert.equal(
      (
        await trusted.request("/auth/login", {
          method: "POST",
          body: { username: "missing-account", password: PASSWORD },
          headers: { "X-Forwarded-For": "203.0.113.10" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await trusted.request("/auth/login", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
        headers: { "X-Forwarded-For": "203.0.113.10" },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await trusted.request("/auth/login", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
        headers: { "X-Forwarded-For": "203.0.113.11" },
      })
    ).status,
    200,
  );

  const untrusted = await fixture(t, { config: remoteConfig });
  await untrusted.setup();
  for (let index = 0; index < 10; index++)
    assert.equal(
      (
        await untrusted.request("/auth/login", {
          method: "POST",
          body: { username: `missing-${index}`, password: PASSWORD },
          headers: { "X-Forwarded-For": `203.0.113.${index + 1}` },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await untrusted.request("/auth/login", {
        method: "POST",
        body: { username: "owner", password: PASSWORD },
        headers: { "X-Forwarded-For": "203.0.113.250" },
      })
    ).status,
    429,
  );
});

test("workflow approval records the actual editor and configuration audit commits with writes", async (t) => {
  const f = await fixture(t, { synthetic: true });
  const owner = await f.setup();
  const editor = await f.addUser(owner, "editor", { displayName: "真实剪辑师" });
  const p = `/projects/${f.legacy.id}`;
  await owner.call(`${p}/participants`, "POST", {
    userId: editor.user.id,
    access: "editor",
  });
  for (const node of f.legacy.nodes) node.status = "completed";
  f.legacy.nodes.at(-1).status = "waiting";
  f.legacy.approval = {
    id: "delivery-confirm",
    nodeId: "delivery",
    kind: "delivery",
    title: "交付确认",
  };
  const result = await editor.call(`${p}/approval`, "POST", {
    approvalId: "delivery-confirm",
    decision: "approve",
  });
  assert.equal(result.status, 200);
  const approvalMessage = f.legacy.messages.findLast(
    (message) => message.agentId === "user",
  );
  assert.deepEqual(approvalMessage.sender, {
    id: editor.user.id,
    displayName: "真实剪辑师",
    kind: "human",
  });
  assert.equal(
    (await owner.call("/agents/editor", "PATCH", { description: "审计测试" })).status,
    200,
  );
  const events = (await owner.call("/audit")).body.events;
  assert.ok(
    events.some(
      (event) =>
        event.action === "agents.updated" &&
        event.actorId === owner.user.id &&
        event.targetId === "editor",
    ),
  );
  const before = events.length;
  t.mock.method(console, "error", () => {});
  f.store.failWrites = true;
  assert.equal(
    (await owner.call("/agents/editor", "PATCH", { description: "不应生效" })).status,
    500,
  );
  assert.equal(f.store.getState().security.audit.length, before);
  assert.equal(
    f.store.getState().agents.find((agent) => agent.id === "editor").description,
    "审计测试",
  );
  f.store.failWrites = false;
});
