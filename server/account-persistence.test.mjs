import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { authenticatedFetch } from "./test-support/auth.mjs";

test("accounts, hashed sessions and project access survive a real database restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-accounts-restart-"));
  const config = readConfig({ WORKBENCH_DATA_DIR: directory });
  let runtime;
  let listener;
  async function stop() {
    runtime?.close();
    if (listener)
      await new Promise((resolve) => {
        listener.close(resolve);
        listener.closeAllConnections();
      });
    runtime = listener = undefined;
  }
  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  async function start() {
    runtime = createApp({ config });
    listener = await new Promise((resolve) => {
      const server = runtime.app.listen(0, "127.0.0.1", () => resolve(server));
    });
    return `http://127.0.0.1:${listener.address().port}`;
  }
  let base = await start();
  const admin = await authenticatedFetch(base);
  const create = async (path, body) => {
    const response = await admin.fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return response.json();
  };
  const user = await create("/users", {
    username: "returning-editor",
    displayName: "剪辑师",
    password: "Restart-fixture-password",
    kind: "human",
  });
  const project = await create("/projects", { name: "持久化权限测试" });
  await create(`/projects/${project.id}/participants`, {
    userId: user.id,
    access: "editor",
    jobTitle: "剪辑师",
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: user.username,
      password: "Restart-fixture-password",
    }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get("set-cookie").split(";")[0];
  await stop();
  const inspection = new DatabaseSync(config.databaseFile);
  const metadata = inspection
    .prepare("SELECT value FROM workspace_metadata")
    .get().value;
  assert.ok(!metadata.includes("Restart-fixture-password"));
  assert.ok(!metadata.includes(cookie.split("=")[1]));
  assert.match(metadata, /scrypt-v1/);
  inspection.close();
  base = await start();
  const restoredSession = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookie },
  }).then((r) => r.json());
  assert.equal(restoredSession.user.id, user.id);
  assert.equal(restoredSession.csrfToken, session.csrfToken);
  const state = await fetch(`${base}/api/state?compact=1`, {
    headers: { Cookie: cookie },
  }).then((r) => r.json());
  assert.equal(state.projects[0].id, project.id);
  assert.equal(state.projects[0].currentUserAccess, "editor");
  assert.equal(
    state.projects[0].participants.find((p) => p.userId === user.id).jobTitle,
    "剪辑师",
  );
  assert.equal(state.security, undefined);
  assert.ok(!JSON.stringify(state).includes("passwordHash"));
  assert.deepEqual(state.providers, []);
});
