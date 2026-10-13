import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { readConfig, PROJECT_ROOT } from "./config.mjs";

test("development proxy preserves browser origin for login and authenticated mutations", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-dev-proxy-"));
  const runtime = createApp({
    config: readConfig({ WORKBENCH_DATA_DIR: directory }),
    store: createStore({ filename: ":memory:" }),
  });
  const server = await new Promise((resolve) => {
    const listener = runtime.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let web;
  const previous = process.env.API_PORT;
  t.after(async () => {
    if (previous === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = previous;
    await web?.close();
    runtime.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.API_PORT = String(server.address().port);
  web = await createServer({
    configFile: join(PROJECT_ROOT, "vite.config.ts"),
    logLevel: "silent",
    server: { port: 0, strictPort: false, watch: null },
  });
  await web.listen();
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  const headers = { "Content-Type": "application/json", Origin: base };
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: "proxy-owner",
      displayName: "测试用户",
      password: "Proxy-fixture-password",
    }),
  });
  assert.equal(setup.status, 201);
  const session = await setup.json();
  const authenticated = {
    ...headers,
    Cookie: setup.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": session.csrfToken,
  };
  const project = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: authenticated,
    body: JSON.stringify({ name: "代理项目" }),
  });
  assert.equal(project.status, 201);
  const foreign = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { ...authenticated, Origin: "http://localhost:1" },
    body: JSON.stringify({ name: "拒绝跨源" }),
  });
  assert.equal(foreign.status, 403);
});
