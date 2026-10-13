import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialService } from "./services/materials.mjs";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createSeedState, createProject } from "./seed.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=",
  "base64",
);
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "workbench-materials-"));
  const project = { id: "project-materials", assets: [], materials: [] };
  const state = { projects: [project] };
  let saves = 0;
  const service = createMaterialService({
    getState: () => state,
    save: () => saves++,
    dataDir,
    ...options,
  });
  t.after(async () => {
    service.close();
    await rm(dataDir, { force: true, recursive: true });
  });
  return { service, project, state, dataDir, saves: () => saves };
}

test("generated Base64 is atomically stored and not retained in project JSON", async (t) => {
  const fx = await fixture(t);
  assert.deepEqual(await readdir(fx.dataDir), []);
  const material = await fx.service.capture(fx.project, {
    url: dataUrl,
    name: "长生定妆",
    type: "image",
    nodeId: "characters",
    providerId: "image",
    model: "test",
    prompt: "portrait",
  });
  assert.equal(material.status, "local");
  assert.equal(material.mimeType, "image/png");
  assert.equal(material.bytes, png.length);
  assert.equal(material.sourceUrl, "data:image/png;base64");
  assert.equal(material.providerId, "image");
  const stored = await fx.service.file(material.id);
  assert.deepEqual(await readFile(stored.path), png);
  assert.ok(
    (await readdir(join(fx.dataDir, "media"))).every((name) => !name.endsWith(".part")),
  );
  const second = await fx.service.capture(fx.project, {
    url: dataUrl,
    name: "长生修改版",
    type: "image",
  });
  assert.notEqual(material.id, second.id);
  assert.equal(fx.project.materials.length, 2);
});

test("downloads follow validated redirects without cookies or provider credentials", async (t) => {
  const calls = [];
  const fx = await fixture(t, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.test/result" },
          })
        : new Response(png, {
            headers: { "content-type": "application/octet-stream" },
          });
    },
  });
  const result = await fx.service.capture(fx.project, {
    url: "https://image.example.test/a",
    type: "image",
  });
  assert.equal(result.status, "local");
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.deepEqual(Object.keys(options.headers), ["Accept"]);
  }
});

test("material provenance retains reference identity and shot/task fields without binary reference data", async (t) => {
  const fx = await fixture(t);
  const reference = {
    id: "asset-person",
    name: "长生",
    type: "character",
    version: 2,
    materialId: "material-baseline",
    locked: true,
    url: dataUrl,
    content: "private expanded context",
  };
  const shot = {
    id: "shot-3",
    startSeconds: 7,
    endSeconds: 12,
    durationSeconds: 5,
    storyboardId: "asset-storyboard",
    storyboardVersion: 1,
  };
  const material = await fx.service.capture(fx.project, {
    url: dataUrl,
    name: "参考测试",
    type: "image",
    referenceAssets: [reference],
    providerTaskId: "task-123",
    videoShot: { ...shot, untrustedExtra: dataUrl },
  });
  assert.deepEqual(material.referenceAssets, [
    {
      id: "asset-person",
      name: "长生",
      type: "character",
      version: 2,
      materialId: "material-baseline",
    },
  ]);
  assert.deepEqual(material.videoShot, shot);
  assert.equal(material.providerTaskId, "task-123");
  assert.ok(!JSON.stringify(material).includes(png.toString("base64")));
  assert.ok(!JSON.stringify(material).includes("private expanded context"));
  reference.version = 99;
  shot.durationSeconds = 99;
  assert.equal(material.referenceAssets[0].version, 2);
  assert.equal(material.videoShot.durationSeconds, 5);
});

test("explicitly reference-free generation remains distinct from unrecorded historical provenance", async (t) => {
  const fx = await fixture(t);
  const generated = await fx.service.capture(fx.project, {
    url: dataUrl,
    type: "image",
    referenceAssets: [],
  });
  const historical = await fx.service.capture(fx.project, {
    url: dataUrl,
    type: "image",
  });
  assert.deepEqual(generated.referenceAssets, []);
  assert.equal(Object.hasOwn(historical, "referenceAssets"), false);
});

test("credential URLs, unsafe redirect schemes and HTTPS downgrade never get fetched", async (t) => {
  for (const location of [
    "https://user:secret@example.test/image",
    "file:///c:/private.png",
    "http://example.test/image",
  ]) {
    let calls = 0;
    const fx = await fixture(t, {
      fetch: async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location } });
      },
    });
    const result = await fx.service.capture(fx.project, {
      url: "https://example.test/image",
      type: "image",
    });
    assert.equal(result.status, "failed");
    assert.equal(calls, 1);
    assert.equal(result.url, "https://example.test/image");
    assert.ok(!result.error.includes("secret"));
  }
  const fx = await fixture(t, {
    fetch: async () => assert.fail("must not fetch credential URL"),
  });
  const result = await fx.service.capture(fx.project, {
    url: "https://user:secret@example.test/image",
    type: "image",
  });
  assert.equal(result.status, "failed");
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("expired remote results are retained and a later retry saves the same material", async (t) => {
  let ready = false;
  const fx = await fixture(t, {
    fetch: async () =>
      ready ? new Response(png) : new Response("expired", { status: 403 }),
  });
  const result = await fx.service.capture(fx.project, {
    url: "https://example.test/result",
    type: "image",
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /403/);
  assert.equal(result.url, result.sourceUrl);
  ready = true;
  assert.equal(await fx.service.retry(fx.project, result.id), result);
  assert.equal(result.status, "local");
  assert.equal(fx.project.materials.length, 1);
});

test("HTML disguised as image and media exceeding advertised or streamed limits are rejected", async (t) => {
  for (const response of [
    new Response("<html>error</html>", { headers: { "content-type": "image/png" } }),
    new Response(png, { headers: { "content-length": "500" } }),
    new Response(Buffer.concat([png, png, png])),
  ]) {
    const fx = await fixture(t, {
      fetch: async () => response,
      limits: { image: 100 },
    });
    const result = await fx.service.capture(fx.project, {
      url: "https://example.test/bad",
      type: "image",
    });
    assert.equal(result.status, "failed");
    assert.equal(result.url, result.sourceUrl);
    const files = await readdir(join(fx.dataDir, "media")).catch(() => []);
    assert.deepEqual(files, []);
  }
});

test("explicit import preserves asset identity and history, deduplicates existing media, and never fetches at startup", async (t) => {
  let calls = 0;
  const fx = await fixture(t, {
    fetch: async () => {
      calls++;
      return new Response(png);
    },
  });
  fx.project.assets.push(
    {
      id: "asset-v1",
      name: "历史定妆",
      type: "character",
      locked: true,
      version: 1,
      url: "https://example.test/a",
      tags: ["node:characters", "历史版本"],
    },
    {
      id: "asset-v2",
      name: "同一图的分镜",
      type: "storyboard",
      url: "https://example.test/a",
      tags: [],
    },
  );
  assert.equal(calls, 0);
  await fx.service.importExisting(fx.project);
  await fx.service.importExisting(fx.project);
  assert.equal(calls, 1);
  assert.equal(fx.project.materials.length, 1);
  const [a, b] = fx.project.assets;
  assert.equal(a.materialId, b.materialId);
  assert.equal(a.url, b.url);
  assert.equal(a.locked, true);
  assert.equal(a.version, 1);
  assert.deepEqual(a.tags, ["node:characters", "历史版本"]);
});

test("retrying an older material cannot replace a newer asset that reuses its asset ID", async (t) => {
  let ready = false;
  const fx = await fixture(t, {
    fetch: async () =>
      ready ? new Response(png) : new Response(null, { status: 503 }),
  });
  const old = await fx.service.capture(fx.project, {
    url: "https://example.test/old",
    type: "image",
    assetId: "same-asset",
  });
  const current = await fx.service.capture(fx.project, {
    url: dataUrl,
    type: "image",
    assetId: "same-asset",
  });
  const asset = { id: "same-asset", url: current.url, materialId: current.id };
  fx.project.assets.push(asset);
  ready = true;
  await fx.service.retry(fx.project, old.id);
  assert.equal(old.status, "local");
  assert.equal(asset.materialId, current.id);
  assert.equal(asset.url, current.url);
});

test("managed image references become inline bytes for media models and remain text-only for text models", async (t) => {
  const fx = await fixture(t);
  const material = await fx.service.capture(fx.project, {
    url: dataUrl,
    type: "image",
  });
  const ref = { id: "asset", name: "长生", content: "定妆标准", url: material.url };
  const [image] = await fx.service.references([ref], "image");
  assert.equal(image.url, dataUrl);
  assert.equal(ref.url, material.url);
  const [text] = await fx.service.references([ref], "text");
  assert.equal(text.url, undefined);
  assert.equal(text.content, ref.content);
  assert.equal(
    (await fx.service.references([dataUrl], "text"))[0].includes("base64"),
    false,
  );
  const stored = await fx.service.file(material.id);
  await unlink(stored.path);
  await assert.rejects(fx.service.references([ref], "video"), /文件缺失/);
  await assert.rejects(fx.service.file("../../workbench.sqlite"), /不存在/);
});

test("missing local files fall back to remote source when re-download fails", async (t) => {
  let ready = true;
  const fx = await fixture(t, {
    fetch: async () =>
      ready ? new Response(png) : new Response(null, { status: 404 }),
  });
  const material = await fx.service.capture(fx.project, {
    url: "https://example.test/image",
    type: "image",
  });
  await unlink((await fx.service.file(material.id)).path);
  ready = false;
  await fx.service.retry(fx.project, material.id);
  assert.equal(material.status, "failed");
  assert.equal(material.url, material.sourceUrl);
});

test("close cancels downloads and does not write to the closed store", async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const fx = await fixture(t, {
    fetch: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  const work = fx.service.capture(fx.project, {
    url: "https://example.test/pending",
    type: "image",
  });
  await ready;
  fx.service.close();
  const saves = fx.saves();
  const material = await work;
  assert.equal(material.status, "failed");
  assert.equal(fx.saves(), saves);
  assert.match(material.error, /关闭/);
});

test("interrupted records are recoverable on startup without remote requests", async (t) => {
  const project = {
    materials: [
      { id: "old", status: "downloading", sourceUrl: "https://example.test/old" },
    ],
  };
  const fx = await fixture(t, {
    getState: () => ({ projects: [project] }),
    fetch: async () => assert.fail("startup must not download"),
  });
  assert.equal(project.materials[0].status, "failed");
  assert.match(project.materials[0].error, /中断/);
  assert.equal(fx.saves(), 1);
});

test("HTTP media routes support video ranges, downloads, project isolation and import", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "workbench-materials-api-"));
  const state = createSeedState();
  state.projects = [
    createProject({ name: "素材测试", mode: "demo", episodes: 1 }),
    createProject({ name: "另一个项目", mode: "demo", episodes: 1 }),
  ];
  const store = createStore({ filename: ":memory:", seed: () => state });
  const service = createApp({
    store,
    config: { dataDir, distDir: join(dataDir, "dist"), workflowStepMs: 0 },
  });
  const server = await new Promise((resolve) => {
    const listener = service.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = state.projects[0];
  const videoBytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom0000isommp42"),
    Buffer.alloc(80),
  ]);
  const video = await service.materials.capture(project, {
    url: `data:video/mp4;base64,${videoBytes.toString("base64")}`,
    type: "video",
    name: "第一集",
  });
  const range = await fetch(base + video.url, { headers: { Range: "bytes=0-15" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-type"), "video/mp4");
  assert.equal(range.headers.get("content-range"), `bytes 0-15/${videoBytes.length}`);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  const download = await fetch(base + video.url + "?download=1");
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  const wrongProject = await fetch(
    `${base}/api/projects/${state.projects[1].id}/materials/${video.id}/download`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  assert.equal(wrongProject.status, 404);
  project.assets.push({
    id: "asset-import",
    type: "character",
    name: "导入角色",
    url: dataUrl,
    tags: [],
  });
  const imported = await fetch(`${base}/api/projects/${project.id}/materials/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(imported.status, 200);
  const importedProject = await imported.json();
  assert.equal(importedProject.materials.length, 2);
  assert.match(importedProject.assets.at(-1).url, /^\/api\/media\//);
});
