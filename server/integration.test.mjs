import { authenticatedFetch } from "./test-support/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { request as httpRequest, createServer } from "node:http";
import { createApp } from "./index.mjs";
import { createStore } from "./store.mjs";
import { createSeedState, createProject } from "./seed.mjs";
import { buildContext, compressMemory } from "./workflow.mjs";
import { readConfig } from "./config.mjs";
import { createLocalModel } from "./test-support/local-model.mjs";

const seed = () => ({ ...createSeedState(), projects: [] });

async function fixture(
  t,
  {
    stepDelay = 2,
    store = createStore({ filename: ":memory:", seed }),
    bindModels = true,
  } = {},
) {
  const mediaDirectory = mkdtempSync(join(tmpdir(), "frameflow-integration-media-"));
  const model = bindModels ? await createLocalModel(t, { delay: stepDelay }) : null;
  model?.bind(store.getState());
  const service = createApp({
    store,
    stepDelay,
    config: readConfig({ WORKBENCH_DATA_DIR: mediaDirectory }),
  });
  const server = await new Promise((resolve) => {
    const active = service.app.listen(0, "127.0.0.1", () => resolve(active));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { fetch, headers: authHeaders } = await authenticatedFetch(base);
  t.after(async () => {
    service.workflow.close();
    service.materials.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    service.store.close();
    if (mediaDirectory) rmSync(mediaDirectory, { recursive: true, force: true });
  });
  async function api(path, method = "GET", body, headers = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }
  async function project(id) {
    return (await api("/state")).body.projects.find((item) => item.id === id);
  }
  async function idle(id) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const value = await project(id);
      if (!value.running) return value;
      await sleep(3);
    }
    assert.fail(`Project ${id} did not reach an idle checkpoint`);
  }
  async function makeProject(
    name = "测试短剧",
    content = "林晚在旧邮局见到陈渡。信封上是明天的日期。",
  ) {
    const response = await api("/projects", "POST", {
      name,
    });
    assert.equal(response.status, 201);
    const id = response.body.id;
    if (content)
      assert.equal(
        (
          await api(`/projects/${id}/chapters`, "POST", {
            title: "第一章",
            content,
          })
        ).status,
        201,
      );
    return id;
  }
  async function approve(id, expectedKind, extra = {}) {
    const before = await idle(id);
    assert.equal(
      before.approval?.kind,
      expectedKind,
      JSON.stringify({
        approval: before.approval?.kind,
        failedNodes: before.nodes
          .filter((node) => node.status === "failed")
          .map((node) => ({ id: node.id, error: node.error })),
      }),
    );
    const result = await api(`/projects/${id}/approval`, "POST", {
      approvalId: before.approval.id,
      decision: "approve",
      ...(expectedKind === "style" ? { value: "二次元动画" } : {}),
      ...extra,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return idle(id);
  }
  async function complete(id, styleAnswers) {
    assert.equal((await api(`/projects/${id}/run`, "POST", {})).status, 202);
    for (const kind of ["style", "script", "character", "storyboard", "delivery"])
      await approve(
        id,
        kind,
        kind === "style" && styleAnswers ? { answers: styleAnswers } : {},
      );
    return project(id);
  }
  return {
    ...service,
    base,
    fetch,
    authHeaders,
    api,
    project,
    idle,
    makeProject,
    approve,
    complete,
    model,
  };
}

test("project creation needs no season length and rejects removed demo and episode controls", async (t) => {
  const fx = await fixture(t, { bindModels: false });
  assert.deepEqual((await fx.api("/state")).body.projects, []);
  const created = await fx.api("/projects", "POST", { name: "只改编本次片段" });
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.body, "episodes"), false);
  assert.equal(Object.hasOwn(created.body, "mode"), false);
  assert.equal(created.body.chapters.length, 0);
  assert.equal(created.body.assets.length, 0);
  for (const removed of [{ episodes: 12 }, { episodes: 1 }, { mode: "demo" }]) {
    const rejected = await fx.api("/projects", "POST", {
      name: "旧版创建",
      ...removed,
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      (await fx.api(`/projects/${created.body.id}`, "PATCH", removed)).status,
      400,
    );
  }
  const legacyLive = await fx.api("/projects", "POST", {
    name: "兼容旧版真实接口客户端",
    mode: "live",
  });
  assert.equal(legacyLive.status, 201);
  assert.equal(Object.hasOwn(legacyLive.body, "mode"), false);
  const patched = await fx.api(`/projects/${created.body.id}`, "PATCH", {
    mode: "live",
  });
  assert.equal(patched.status, 200);
  assert.equal(Object.hasOwn(patched.body, "mode"), false);
});

test("two episode workflows archive independently and reuse locked standards without treating old scripts as current", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject(
    "连续制作测试",
    "林晚在旧邮局见到陈渡。第一轮独有暗号是青灯。",
  );
  const blocked = await fx.api(`/projects/${id}/episodes`, "POST", {});
  assert.equal(blocked.status, 409);
  const first = await fx.complete(id);
  const firstScript = first.assets.find((asset) => asset.type === "script");
  const standards = first.assets.filter(
    (asset) => asset.type === "character" && asset.locked,
  );
  const transition = await fx.api(`/projects/${id}/episodes`, "POST", {
    title: "新的来信",
  });
  assert.equal(transition.status, 201);
  assert.equal(transition.body.currentEpisode.number, 2);
  assert.equal(transition.body.currentEpisode.title, "新的来信");
  assert.equal(transition.body.episodeArchive.length, 1);
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${firstScript.id}`, "PATCH", {
        locked: false,
      })
    ).status,
    409,
  );
  assert.ok(
    transition.body.episodeArchive[0].nodes.every(
      (node) => node.status === "completed",
    ),
  );
  assert.deepEqual(transition.body.chapters, []);
  const priorRequests = fx.model.requests.length;
  assert.equal(
    (
      await fx.api(`/projects/${id}/chapters`, "POST", {
        title: "第二段原文",
        content: "林晚在旧邮局再次见到陈渡。第二轮独有暗号是银钥匙。",
      })
    ).status,
    201,
  );
  const second = await fx.complete(id);
  const currentScript = second.assets.find(
    (asset) => asset.type === "script" && !asset.tags.includes("历史版本"),
  );
  assert.ok(currentScript);
  assert.notEqual(currentScript.id, firstScript.id);
  for (const standard of standards) {
    const reused = second.assets.find((asset) => asset.id === standard.id);
    assert.deepEqual(reused, standard);
  }
  const firstPrompt = fx.model.requests
    .slice(priorRequests)
    .find((request) => request.path === "/v1/chat/completions").prompt;
  assert.match(firstPrompt, /当前制作：第 2 集/);
  assert.match(firstPrompt, /第二轮独有暗号是银钥匙/);
  assert.doesNotMatch(firstPrompt, /第一轮独有暗号是青灯/);
  assert.doesNotMatch(firstPrompt, /当前已批准剧本（/);
  const archived = await fx.api(`/projects/${id}/episodes`, "POST", {});
  assert.equal(archived.status, 201);
  assert.equal(archived.body.currentEpisode.number, 3);
  const [firstArchive, secondArchive] = archived.body.episodeArchive;
  const oldMessages = new Set(firstArchive.messages.map((message) => message.id));
  assert.ok(secondArchive.messages.every((message) => !oldMessages.has(message.id)));
  assert.equal(secondArchive.chapters[0].title, "第二段原文");
  assert.ok(secondArchive.assets.some((asset) => asset.id === currentScript.id));
  assert.ok(!secondArchive.assets.some((asset) => asset.id === firstScript.id));
  assert.ok(secondArchive.assets.some((asset) => asset.id === standards[0].id));
  assert.ok(firstArchive.materials.length > 0);
  assert.ok(secondArchive.materials.length > 0);
  assert.ok(
    secondArchive.materials.every(
      (material) => !firstArchive.materials.some((old) => old.id === material.id),
    ),
  );
  const exported = await fx.api(`/projects/${id}/export`);
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.project.episodeArchive, archived.body.episodeArchive);
  assert.deepEqual(exported.body.project.currentEpisode, archived.body.currentEpisode);
  assert.match(exported.body.note, /历集只读档案/);
});

test("configured local models honor every approval gate, lock assets and export an honest project bundle", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  await fx.api(`/projects/${id}/memory/facts`, "POST", {
    fact: "主角始终持有铜钥匙",
  });
  assert.equal(
    (await fx.api(`/projects/${id}/run`, "POST", { nodeId: "video" })).status,
    409,
  );
  assert.equal((await fx.api(`/projects/${id}/run`, "POST", {})).status, 202);
  let project = await fx.idle(id);
  assert.equal(project.nodes[0].status, "waiting");
  assert.equal(project.nodes[1].status, "pending");
  assert.equal(project.approval.kind, "style");
  assert.equal((await fx.api(`/projects/${id}/run`, "POST", {})).status, 409);
  project = await fx.approve(id, "style");
  assert.equal(project.style, "二次元动画");
  assert.equal(project.approval.kind, "script");
  project = await fx.approve(id, "script");
  assert.equal(
    project.nodes.find((node) => node.id === "compliance").status,
    "completed",
  );
  assert.equal(project.approval.kind, "character");
  project = await fx.approve(id, "character");
  assert.ok(
    project.assets
      .filter((asset) => asset.type === "character")
      .every((asset) => asset.locked),
  );
  project = await fx.approve(id, "storyboard");
  assert.equal(project.approval.kind, "delivery");
  assert.equal(project.nodes.find((node) => node.id === "video").status, "completed");
  project = await fx.approve(id, "delivery");
  assert.equal(project.approval, null);
  assert.equal(project.running, false);
  assert.ok(project.nodes.every((node) => node.status === "completed"));
  assert.ok(
    project.nodes.every((node) => node.output && !node.output.includes("演示")),
  );
  assert.ok(project.assets.some((asset) => asset.type === "video" && asset.url));
  assert.ok(fx.model.requests.some((request) => request.path === "/videos"));
  assert.ok(
    project.assets.some((asset) => asset.type === "storyboard" && asset.locked),
  );
  assert.equal(project.members.length, 7);
  assert.match(project.memory.summary, /主角始终持有铜钥匙/);
  assert.ok(project.memory.compressedCount > 0);
  const bundle = await fx.api(`/projects/${id}/export`);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.body.format, "frameflow-project-v1");
  assert.equal(bundle.body.project.id, id);
  assert.match(bundle.body.note, /不包含 API 密钥或媒体文件/);
  assert.match(bundle.body.note, /历史文字提案不代表已生成媒体/);
  assert.match(bundle.headers.get("content-disposition"), /attachment/);
});

test("revision creates a fresh approval and stale IDs cannot approve newly generated work", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  await fx.api(`/projects/${id}/run`, "POST", {});
  const first = await fx.idle(id);
  const oldStyleId = first.approval.id;
  let project = await fx.approve(id, "style");
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: oldStyleId,
        decision: "approve",
      })
    ).status,
    409,
  );
  const oldScriptId = project.approval.id;
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: oldScriptId,
        decision: "revise",
        feedback: "开场先展示失踪姐姐的信封",
      })
    ).status,
    200,
  );
  project = await fx.idle(id);
  assert.equal(project.approval.kind, "script");
  assert.notEqual(project.approval.id, oldScriptId);
  assert.equal(project.nodes[0].status, "completed");
  assert.ok(project.nodes.slice(2).every((node) => node.status === "pending"));
  assert.match(project.nodes[1].output, /开场先展示失踪姐姐的信封/);
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: oldScriptId,
        decision: "approve",
      })
    ).status,
    409,
  );
});

test("pause and immediate restart never permit an aborted job to publish a duplicate result", async (t) => {
  const fx = await fixture(t, { stepDelay: 80 });
  const id = await fx.makeProject();
  await fx.api(`/projects/${id}/run`, "POST", {});
  assert.equal((await fx.api(`/projects/${id}/run`, "POST", {})).status, 409);
  assert.equal(
    (await fx.api(`/projects/${id}`, "PATCH", { style: "动态漫画" })).status,
    409,
  );
  await fx.api(`/projects/${id}/stop`, "POST", {});
  const stopped = await fx.project(id);
  assert.equal(stopped.running, false);
  assert.equal(stopped.nodes[0].status, "pending");
  await fx.api(`/projects/${id}/run`, "POST", {});
  const resumed = await fx.idle(id);
  await sleep(100);
  const final = await fx.project(id);
  assert.equal(final.approval.id, resumed.approval.id);
  assert.equal(
    final.messages.filter(
      (message) => message.nodeId === "analysis" && message.type === "result",
    ).length,
    1,
  );
  assert.equal(fx.workflow.jobs.size, 0);
});

test("projects keep facts, source, feedback and approvals isolated", async (t) => {
  const fx = await fixture(t);
  const a = await fx.makeProject("北城项目", "北城专属人物甲持有 BLUE_ONLY 钥匙。");
  const b = await fx.makeProject("南城项目", "南城专属人物乙收到 RED_ONLY 来信。");
  await fx.api(`/projects/${a}/memory/facts`, "POST", {
    fact: "BLUE_ONLY 固定事实",
  });
  await fx.api(`/projects/${a}/messages`, "POST", {
    content: "BLUE_ONLY 创作反馈",
    agentId: "writer",
  });
  await fx.api(`/projects/${a}/run`, "POST", {});
  const first = await fx.idle(a);
  assert.equal(
    (
      await fx.api(`/projects/${b}/approval`, "POST", {
        approvalId: first.approval.id,
        decision: "approve",
      })
    ).status,
    409,
  );
  const other = await fx.project(b);
  assert.equal(other.approval, null);
  assert.equal(other.memory.facts.length, 0);
  assert.equal(other.assets.length, 0);
  const contextA = buildContext(
    fx.store.getState().projects.find((project) => project.id === a),
  );
  const contextB = buildContext(
    fx.store.getState().projects.find((project) => project.id === b),
  );
  assert.ok(!JSON.stringify(contextA).includes("RED_ONLY"));
  assert.ok(!JSON.stringify(contextB).includes("BLUE_ONLY"));
});

test("local API rejects remote origins, rebinding hosts and unsafe body formats; secrets stay server-only", async (t) => {
  const fx = await fixture(t);
  assert.equal(
    (
      await fx.api("/state", "GET", undefined, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fx.api("/state", "GET", undefined, { Origin: "null" })).status,
    403,
  );
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${fx.base}/api/state`,
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(reboundStatus, 403);
  assert.equal(
    (
      await fx.api(
        "/projects",
        "POST",
        { name: "invalid" },
        { "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  const malformed = await fx.fetch(`${fx.base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid json",
  });
  assert.equal(malformed.status, 400);
  const secret = "integration-private-key";
  const provider = await fx.api("/providers", "POST", {
    name: "Isolated test model",
    kind: "text",
    protocol: "openai",
    baseUrl: "https://example.com/v1",
    model: "test-model",
    apiKey: secret,
    enabled: false,
  });
  assert.equal(provider.status, 201);
  assert.equal(provider.body.hasKey, true);
  const publicState = await fx.api("/state");
  assert.ok(!JSON.stringify(publicState.body).includes(secret));
  assert.ok(!JSON.stringify(publicState.body).includes("apiKey"));
  assert.equal(
    fx.store.getState().providers.find((item) => item.id === provider.body.id).apiKey,
    secret,
  );
  assert.equal(publicState.headers.get("cache-control"), "no-store");
  const id = await fx.makeProject();
  assert.ok(
    !JSON.stringify((await fx.api(`/projects/${id}/export`)).body).includes(secret),
  );
});

test("production fails visibly on a missing binding and resumes after the real configuration is repaired", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  await fx.api("/agents/producer", "PATCH", { providerId: "" });
  await fx.api(`/projects/${id}/run`, "POST", {});
  let project = await fx.idle(id);
  assert.equal(project.nodes[0].status, "failed");
  assert.match(project.nodes[0].error, /尚未分配模型接口/);
  assert.equal(project.assets.length, 0);
  await fx.api("/agents/producer", "PATCH", { providerId: "fixture-text" });
  await fx.api(`/projects/${id}/run`, "POST", {});
  project = await fx.idle(id);
  assert.equal(project.approval.kind, "style");
  assert.equal(project.nodes[0].error, undefined);
});

test("SQLite persists approvals and credentials, and recovers interrupted nodes without losing confirmed work", () => {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-integration-"));
  const filename = join(directory, "isolated.sqlite");
  let store;
  try {
    store = createStore({ filename, seed });
    const project = createProject({ name: "重启恢复测试" });
    project.nodes[0].status = "completed";
    project.nodes[0].output = "已确认的原著拆解";
    project.nodes[1].status = "waiting";
    project.approval = {
      id: "durable-approval",
      nodeId: "adaptation",
      kind: "script",
      title: "剧本确认",
      description: "",
    };
    project.memory.facts.push("重启后仍然保留的事实");
    store.getState().projects.push(project);
    store.getState().providers[0].apiKey = "persisted-secret";
    store.save();
    store.close();
    store = createStore({ filename, seed });
    let restored = store.getState().projects[0];
    assert.equal(restored.approval.id, "durable-approval");
    assert.equal(store.getState().providers[0].apiKey, "persisted-secret");
    restored.approval = null;
    restored.nodes[1].status = "running";
    restored.running = true;
    store.save();
    store.close();
    store = createStore({ filename, seed });
    restored = store.getState().projects[0];
    assert.equal(restored.running, false);
    assert.equal(restored.nodes[1].status, "pending");
    assert.equal(restored.nodes[0].status, "completed");
    assert.equal(restored.nodes[0].output, "已确认的原著拆解");
    assert.deepEqual(restored.memory.facts, ["重启后仍然保留的事实"]);
    assert.match(restored.messages.at(-1).content, /恢复/);
  } finally {
    try {
      store?.close();
    } catch {
      /* A test assertion may occur between close and reopen. */
    }
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith("frameflow-integration-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("long-project contexts stay bounded and omit inline media bytes without mutating archives", () => {
  const project = createProject({ name: "长篇上下文测试" });
  project.chapters = Array.from({ length: 100 }, (_, index) => ({
    id: `chapter-${index}`,
    title: `第 ${index} 章`,
    content: `${index} 的开头${"原文".repeat(8_000)}${index} 的结尾`,
    createdAt: "",
  }));
  project.messages = Array.from({ length: 200 }, (_, index) => ({
    id: `message-${index}`,
    agentId: "user",
    content: `${index} ${"消息".repeat(300)}`,
    type: "text",
    createdAt: "",
  }));
  const encoded = "A".repeat(100_000);
  project.assets = [
    {
      id: "hero",
      name: "主角",
      type: "character",
      description: "固定外观",
      content: "角色标准",
      url: `data:image/png;base64,${encoded}`,
      locked: true,
      version: 1,
      tags: [],
      createdAt: "",
    },
  ];
  compressMemory(project);
  const context = buildContext(project);
  assert.ok(context.prompt.length < 80_000);
  assert.match(context.prompt, /省略/);
  assert.ok(!context.prompt.includes(encoded));
  assert.equal(context.references[0].url, project.assets[0].url);
  assert.equal(project.messages.length, 200);
  assert.equal(project.chapters.length, 100);
  assert.equal(project.memory.compressedCount, 200);
});

test("regenerating a locked storyboard archives its old version and references only the approved replacement", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  const finished = await fx.complete(id);
  const oldBoard = finished.assets.find(
    (asset) => asset.type === "storyboard" && !asset.tags.includes("历史版本"),
  );
  assert.ok(oldBoard.locked);
  assert.equal(
    (await fx.api(`/projects/${id}/run`, "POST", { nodeId: "storyboard" })).status,
    202,
  );
  let project = await fx.idle(id);
  const current = project.assets.find((asset) => asset.id === oldBoard.id);
  assert.equal(project.approval.kind, "storyboard");
  assert.equal(current.version, oldBoard.version + 1);
  assert.equal(current.locked, false);
  assert.equal(
    current.content,
    project.nodes.find((node) => node.id === "storyboard").output,
  );
  const archived = project.assets.find(
    (asset) => asset.type === "storyboard" && asset.tags.includes("历史版本"),
  );
  assert.ok(archived);
  assert.equal(archived.version, oldBoard.version);
  assert.equal(archived.content, oldBoard.content);
  await fx.approve(id, "storyboard");
  const context = buildContext(
    fx.store.getState().projects.find((item) => item.id === id),
  );
  const boardReferences = context.references.filter(
    (asset) => asset.type === "storyboard",
  );
  assert.equal(boardReferences.length, 1);
  assert.equal(boardReferences[0].id, oldBoard.id);
  assert.equal(boardReferences[0].version, oldBoard.version + 1);
});

test("editing character standards rotates its approval and invalidates dependent approvals", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  await fx.api(`/projects/${id}/run`, "POST", {});
  await fx.approve(id, "style");
  let project = await fx.approve(id, "script");
  const characterApprovalId = project.approval.id;
  let character = project.assets.find((asset) => asset.type === "character");
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${character.id}`, "PATCH", {
        description: "角色穿蓝色风衣，持有铜钥匙",
      })
    ).status,
    200,
  );
  project = await fx.project(id);
  assert.equal(project.approval.kind, "character");
  assert.notEqual(project.approval.id, characterApprovalId);
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: characterApprovalId,
        decision: "approve",
      })
    ).status,
    409,
  );
  project = await fx.approve(id, "character");
  const staleBoardApprovalId = project.approval.id;
  character = project.assets.find((asset) => asset.id === character.id);
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${character.id}`, "PATCH", {
        description: "未授权修改锁定标准",
      })
    ).status,
    409,
  );
  const changed = await fx.api(`/projects/${id}/assets/${character.id}`, "PATCH", {
    locked: false,
    description: "角色改穿灰色风衣，持有铜钥匙",
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.version, character.version + 1);
  project = await fx.project(id);
  assert.equal(project.approval.kind, "character");
  assert.equal(
    project.nodes.find((node) => node.id === "storyboard").status,
    "pending",
  );
  assert.equal(
    project.nodes.find((node) => node.id === "characters").status,
    "waiting",
  );
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: staleBoardApprovalId,
        decision: "approve",
      })
    ).status,
    409,
  );
});

test("manual script and storyboard edits update node output, require fresh approval and become the latest references", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  let project = await fx.complete(id);
  const original = project.assets.find(
    (asset) =>
      asset.tags.includes("node:adaptation") && !asset.tags.includes("历史版本"),
  );
  assert.ok(original.locked);
  const newScript =
    "【人工改编稿】第一场：林晚打开铜盒，发现陈渡留下的蓝色便笺。结尾悬念：便笺来自明天。";
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${original.id}`, "PATCH", {
        content: newScript,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${original.id}`, "PATCH", {
        locked: false,
      })
    ).status,
    200,
  );
  const changed = await fx.api(`/projects/${id}/assets/${original.id}`, "PATCH", {
    content: newScript,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.content, newScript);
  assert.equal(changed.body.version, original.version + 1);
  assert.ok(changed.body.tags.includes("人工编辑"));
  project = await fx.project(id);
  assert.equal(project.approval.kind, "script");
  assert.equal(
    project.nodes.find((node) => node.id === "adaptation").output,
    newScript,
  );
  assert.ok(project.nodes.slice(2).every((node) => node.status === "pending"));
  let context = buildContext(
    fx.store.getState().projects.find((item) => item.id === id),
  );
  assert.match(context.prompt, /蓝色便笺/);
  assert.ok(
    !context.references.some((asset) => asset.id === original.id),
    "Unapproved edits must remain a draft",
  );
  await fx.approve(id, "script");
  context = buildContext(fx.store.getState().projects.find((item) => item.id === id));
  const scriptReference = context.references.find((asset) => asset.id === original.id);
  assert.equal(scriptReference.version, original.version + 1);
  assert.match(scriptReference.content, /当前已批准剧本/);
  assert.ok(context.prompt.includes(newScript));
  project = await fx.approve(id, "character");
  const previousApprovalId = project.approval.id;
  const board = project.assets.find(
    (asset) => asset.type === "storyboard" && !asset.tags.includes("历史版本"),
  );
  const newBoard = [
    "## 人工分镜 · 本集90秒",
    "| 镜号 | 起止秒数 | 时长 | 画面 | 出镜人物 | 声音 | 运镜 | 制作方式 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| 01 | 0–6秒 | 6秒 | 铜盒特写，蓝色便笺从盒中露出 | 无 | 环境音 | 固定 | 模型生成 |",
    "| 02 | 6–90秒 | 84秒 | 静态字卡：便笺来自明天 | 无 | 无 | 固定 | 后期制作 |",
  ].join("\n");
  assert.equal(
    (
      await fx.api(`/projects/${id}/assets/${board.id}`, "PATCH", {
        content: newBoard,
      })
    ).status,
    200,
  );
  project = await fx.project(id);
  assert.equal(project.nodes.find((node) => node.id === "storyboard").output, newBoard);
  assert.equal(project.approval.kind, "storyboard");
  assert.notEqual(project.approval.id, previousApprovalId);
  assert.equal(
    (
      await fx.api(`/projects/${id}/approval`, "POST", {
        approvalId: previousApprovalId,
        decision: "approve",
      })
    ).status,
    409,
  );
  project = await fx.approve(id, "storyboard");
  assert.equal(project.approval?.kind, "delivery");
  context = buildContext(fx.store.getState().projects.find((item) => item.id === id));
  assert.equal(
    context.references.find((asset) => asset.id === board.id).content,
    newBoard,
  );
});

test("new canon facts invalidate previous approvals and derived outputs, preserving locked character standards", async (t) => {
  const fx = await fixture(t);
  const id = await fx.makeProject();
  await fx.complete(id);
  const changed = await fx.api(`/projects/${id}/memory/facts`, "POST", {
    fact: "新确认：关键事件发生在星期三。",
  });
  assert.equal(changed.status, 201);
  const project = await fx.project(id);
  assert.equal(project.approval, null);
  assert.ok(project.nodes.every((node) => node.status === "pending"));
  assert.ok(
    project.assets
      .filter((asset) => asset.type === "character")
      .every((asset) => asset.locked),
  );
  const context = buildContext(
    fx.store.getState().projects.find((item) => item.id === id),
  );
  assert.ok(!context.references.some((asset) => asset.type === "storyboard"));
  assert.match(context.prompt, /关键事件发生在星期三/);
});

test("live workflow and @messages integrate local text, character image and asynchronous video adapters", async (t) => {
  const requests = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
    "base64",
  );
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom0000isommp42"),
  ]);
  let failChat = false;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : undefined;
    requests.push({
      method: req.method,
      path: req.url,
      body,
      auth: req.headers.authorization,
    });
    if (req.url === "/media/shen-lan.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
      return;
    }
    if (req.url === "/media/shot-one.mp4") {
      res.setHeader("Content-Type", "video/mp4");
      res.end(mp4);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const json = (value) => res.end(JSON.stringify(value));
    if (req.url === "/v1/chat/completions") {
      if (failChat) {
        res.statusCode = 503;
        return json({
          error: { message: "mock provider temporarily unavailable" },
        });
      }
      const prompt = body.messages.at(-1).content;
      const content = prompt.includes('{"characters":[{"name":')
        ? JSON.stringify({
            characters: [
              {
                name: "沈岚",
                description: "回到旧图书馆的修复师",
                appearance: "成年女性，墨绿色长外套为设计提案",
                sourceEvidence: "沈岚回到旧图书馆，取出父亲的修复工具。",
              },
            ],
          })
        : body.messages[0]?.content.includes("这是项目群的文字讨论")
          ? "建议用图书馆失而复现的借阅卡作为开场钩子。"
          : body.model === "mock-storyboard"
            ? (() => {
                const character = fx.store
                  .getState()
                  .projects.flatMap((project) => project.assets)
                  .find(
                    (asset) =>
                      asset.type === "character" &&
                      asset.name === "沈岚" &&
                      asset.locked,
                  );
                assert.ok(character, "分镜请求必须发生在角色锁定之后");
                return [
                  "## 第一集逐镜分镜 · 30 秒 · 16:9",
                  "| 镜号 | 起止秒数 | 时长 | 画面 | 出镜人物 | 角色资产 | 对白 | 运镜 |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- |",
                  `| 01 | 0–6秒 | 6秒 | 沈岚推开旧图书馆木门，停在门口观察 | 沈岚 | ${character.id} / v${character.version} | 还有人在吗？ | 中景缓慢推进 |`,
                  "| 02 | 6–14秒 | 8秒 | 借阅台上出现失踪旧书 LATER_SHOT_ONLY | 无 | 无 | 无 | 俯拍特写 |",
                  "| 03 | 14–22秒 | 8秒 | 沈岚从书页中取出借阅卡 | 沈岚 | 沈岚 | 这张卡…… | 平视近景 |",
                  "| 04 | 22–30秒 | 8秒 | 借阅卡印着明天日期，沈岚的手停住 | 沈岚 | 沈岚 | 竟然是明天。 | 日期特写 |",
                ].join("\n");
              })()
            : "已依据沈岚的原文与项目确认风格产出当前节点提案，新增设计等待确认。";
      return json({
        choices: [{ message: { content }, finish_reason: "stop" }],
      });
    }
    if (req.url === "/images")
      return json({
        url: `${upstreamUrl}/media/shen-lan.png`,
        text: "沈岚单人定妆图",
      });
    if (req.url === "/videos")
      return json({
        status: "queued",
        jobId: "local-video-job",
        statusUrl: "/jobs/local-video-job",
      });
    if (req.url === "/jobs/local-video-job")
      return json({
        status: "completed",
        url: `${upstreamUrl}/media/shot-one.mp4`,
        text: "首个镜头已生成",
      });
    res.statusCode = 404;
    json({ error: "Unknown mock endpoint" });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.close(resolve);
        upstream.closeAllConnections();
      }),
  );
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const fx = await fixture(t, { bindModels: false });
  const id = await fx.makeProject(
    "任意小说联调",
    "沈岚回到旧图书馆，取出父亲的修复工具。一本失踪多年的书出现在借阅台，夹着明天日期的借阅卡。",
  );
  const providerIds = {};
  for (const [kind, protocol, suffix] of [
    ["text", "openai", "/v1"],
    ["image", "webhook", "/images"],
    ["video", "webhook", "/videos"],
  ]) {
    const created = await fx.api("/providers", "POST", {
      name: `Local ${kind}`,
      kind,
      protocol,
      baseUrl: `${upstreamUrl}${suffix}`,
      model: `mock-${kind}`,
      apiKey: "mock-live-secret",
      enabled: true,
    });
    assert.equal(created.status, 201);
    providerIds[kind] = created.body.id;
  }
  for (const agent of fx.store.getState().agents) {
    const kind =
      agent.id === "character" ? "image" : agent.id === "video" ? "video" : "text";
    assert.equal(
      (
        await fx.api(`/agents/${agent.id}`, "PATCH", {
          providerId: providerIds[kind],
          ...(agent.id === "director" ? { model: "mock-storyboard" } : {}),
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await fx.api(`/projects/${id}/messages`, "POST", {
        agentId: "writer",
        content: "请提炼一个适合开场的钩子。",
      })
    ).status,
    201,
  );
  let project = await fx.project(id);
  assert.ok(
    project.messages.some(
      (message) =>
        message.agentId === "writer" &&
        message.type === "text" &&
        message.content.includes("失而复现的借阅卡"),
    ),
  );
  assert.ok(project.nodes.every((node) => node.status === "pending"));
  assert.equal(project.approval, null);
  project = await fx.complete(id, { durationSeconds: "30", aspectRatio: "16:9" });
  assert.ok(project.nodes.every((node) => node.status === "completed"));
  const character = project.assets.find(
    (asset) => asset.type === "character" && !asset.tags.includes("历史版本"),
  );
  assert.equal(character.name, "沈岚");
  assert.equal(character.url, `/api/media/${character.materialId}/file`);
  assert.ok(character.locked);
  const imageMaterial = project.materials.find(
    (material) => material.id === character.materialId,
  );
  assert.equal(imageMaterial.status, "local");
  assert.equal(imageMaterial.sourceUrl, `${upstreamUrl}/media/shen-lan.png`);
  assert.deepEqual(
    Buffer.from(await (await fx.fetch(`${fx.base}${character.url}`)).arrayBuffer()),
    png,
  );
  const video = project.assets.find((asset) => asset.type === "video");
  assert.equal(video.url, `/api/media/${video.materialId}/file`);
  const videoMaterial = project.materials.find(
    (material) => material.id === video.materialId,
  );
  assert.equal(videoMaterial.status, "local");
  assert.equal(videoMaterial.sourceUrl, `${upstreamUrl}/media/shot-one.mp4`);
  assert.deepEqual(
    Buffer.from(await (await fx.fetch(`${fx.base}${video.url}`)).arrayBuffer()),
    mp4,
  );
  assert.ok(video.tags.includes("真实接口"));
  const videoRequest = requests.find((request) => request.path === "/videos");
  assert.ok(
    videoRequest.body.references.some(
      (reference) =>
        reference.id === character.id &&
        reference.version === character.version &&
        reference.locked &&
        reference.url === `data:image/png;base64,${png.toString("base64")}`,
    ),
  );
  assert.equal(videoRequest.body.references.length, 1);
  assert.equal(videoRequest.body.duration, 6);
  assert.equal(videoRequest.body.ratio, "16:9");
  assert.match(videoRequest.body.prompt, /只生成已批准分镜中的镜头 01/);
  assert.match(videoRequest.body.prompt, /沈岚推开旧图书馆木门/);
  assert.doesNotMatch(videoRequest.body.prompt, /LATER_SHOT_ONLY|明天日期|竟然是明天/);
  assert.equal(video.videoShot.id, "01");
  assert.equal(video.videoShot.durationSeconds, 6);
  assert.ok(video.videoShot.storyboardId);
  assert.equal(requests.filter((request) => request.path === "/videos").length, 1);
  assert.ok(
    requests.some(
      (request) => request.path === "/jobs/local-video-job" && request.method === "GET",
    ),
  );
  assert.ok(
    requests
      .filter((request) => !request.path.startsWith("/media/"))
      .every((request) => request.auth === "Bearer mock-live-secret"),
  );
  const downloads = requests.filter((request) => request.path.startsWith("/media/"));
  assert.equal(downloads.length, 2);
  assert.ok(downloads.every((request) => request.method === "GET" && !request.auth));
  assert.ok(!JSON.stringify(project).includes("mock-live-secret"));
  failChat = true;
  await fx.api(`/projects/${id}/messages`, "POST", {
    agentId: "writer",
    content: "将这个修改意见保留到下次：降低旁白密度。",
  });
  project = await fx.project(id);
  assert.match(project.messages.at(-1).content, /回复未完成/);
  assert.ok(
    project.memory.decisions.some((decision) => decision.includes("降低旁白密度")),
  );
  const requestCount = requests.length;
  await fx.api("/agents/writer", "PATCH", { providerId: "" });
  await fx.api(`/projects/${id}/messages`, "POST", {
    agentId: "writer",
    content: "没有绑定模型时应明确告知。",
  });
  project = await fx.project(id);
  assert.match(project.messages.at(-1).content, /回复未完成/);
  assert.equal(
    requests.length,
    requestCount,
    "An unbound text agent must not silently use another provider",
  );
});
