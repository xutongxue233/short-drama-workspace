import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMaterialService } from "./services/materials.mjs";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=";
const bytes = Buffer.from(image.split(",")[1], "base64");
async function fixture(t, options) {
  const dataDir = await mkdtemp(join(tmpdir(), "material-recovery-"));
  const project = { id: "project", assets: [], materials: [] };
  const state = { projects: [project] };
  const service = createMaterialService({
    getState: () => state,
    dataDir,
    save() {},
    ...options,
  });
  t.after(async () => {
    service.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { service, project, state, dataDir };
}

test("failed removal preserves the object owned by an unrelated in-flight download", async (t) => {
  let fail = false,
    release,
    enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const fx = await fixture(t, {
    save() {
      if (fail) {
        fail = false;
        throw new Error("SQLITE_BUSY");
      }
    },
    async fetch() {
      enter();
      await blocked;
      return new Response(bytes);
    },
  });
  t.after(() => release());
  const a = await fx.service.capture(fx.project, { type: "image", url: image });
  const pending = fx.service.capture(fx.project, {
    type: "image",
    url: "https://example.invalid/b",
  });
  await entered;
  const b = fx.project.materials[1];
  const records = fx.project.materials;
  fail = true;
  assert.throws(() => fx.service.remove(fx.project, a.id), /SQLITE_BUSY/);
  assert.equal(fx.project.materials, records);
  assert.equal(fx.project.materials[1], b);
  release();
  assert.equal(await pending, b);
  assert.equal(b.status, "local");
  assert.deepEqual(await readFile((await fx.service.file(b.id)).path), bytes);
});

test("a final metadata save failure preserves the binary and Base64 source for recovery", async (t) => {
  let project,
    fail = true,
    persisted;
  const fx = await fixture(t, {
    save() {
      if (fail && project?.materials.some((item) => item.status === "local")) {
        fail = false;
        throw new Error("SQLITE_FULL");
      }
      if (project) persisted = structuredClone(project);
    },
    fetch() {
      assert.fail("recovery must not redownload");
    },
  });
  project = fx.project;
  await assert.rejects(
    fx.service.capture(project, { type: "image", url: image }),
    /SQLITE_FULL/,
  );
  const material = project.materials[0];
  assert.equal(material.status, "local");
  assert.equal(material.sourceUrl, image);
  assert.deepEqual(await readFile((await fx.service.file(material.id)).path), bytes);
  // Simulate a restart from the last successful SQLite checkpoint.
  fx.service.close();
  assert.equal(persisted.materials[0].status, "downloading");
  const recovered = createMaterialService({
    getState: () => ({ projects: [persisted] }),
    dataDir: fx.dataDir,
    save() {},
    fetch() {
      assert.fail("a completed file must survive restart without a new request");
    },
  });
  t.after(() => recovered.close());
  const result = await recovered.retry(persisted, material.id);
  assert.equal(result.status, "local");
  assert.equal(result.sourceUrl, "data:image/png;base64");
  assert.deepEqual(await readFile((await recovered.file(material.id)).path), bytes);
});

test("stable capture IDs reuse a completed image and reject different source or project", async (t) => {
  const fx = await fixture(t, {
    fetch() {
      assert.fail("no remote generation or download");
    },
  });
  const captureId = `material-${randomUUID()}`;
  const input = { captureId, url: image, type: "image" };
  const first = await fx.service.capture(fx.project, input);
  assert.equal(await fx.service.capture(fx.project, input), first);
  assert.equal(fx.project.materials.length, 1);
  await assert.rejects(
    fx.service.capture(fx.project, { ...input, url: "https://example.invalid/other" }),
    (error) => error.status === 409,
  );
  const other = { id: "other", materials: [], assets: [] };
  fx.state.projects.push(other);
  await assert.rejects(
    fx.service.capture(other, input),
    (error) => error.status === 409,
  );
});

test("recovery reserves the material before filesystem checks so concurrent deletion cannot orphan it", async (t) => {
  let fetched = 0;
  const fx = await fixture(t, {
    fetch() {
      fetched++;
      return new Response(bytes);
    },
  });
  const material = {
    id: `material-${randomUUID()}`,
    type: "image",
    sourceUrl: "https://example.invalid/image",
    url: "https://example.invalid/image",
    status: "failed",
  };
  fx.project.materials.push(material);
  const pending = fx.service.retry(fx.project, material.id);
  assert.throws(
    () => fx.service.remove(fx.project, material.id),
    (error) => error.status === 409,
  );
  assert.equal(await pending, material);
  assert.equal(fetched, 1);
  assert.equal(fx.project.materials[0].status, "local");
});

test("shutdown cancels recovery even when its interruption checkpoint cannot be saved", async (t) => {
  let fail = false;
  const fx = await fixture(t, {
    save() {
      if (fail) throw new Error("SQLITE_FULL");
    },
    fetch() {
      assert.fail("closed recovery must not start a network request");
    },
  });
  const material = {
    id: `material-${randomUUID()}`,
    type: "image",
    sourceUrl: "https://example.invalid/image",
    url: "https://example.invalid/image",
    status: "failed",
  };
  fx.project.materials.push(material);
  const pending = fx.service.retry(fx.project, material.id);
  fail = true;
  assert.throws(() => fx.service.close(), /SQLITE_FULL/);
  await assert.rejects(pending);
  assert.equal(material.status, "failed");
  assert.doesNotThrow(() => fx.service.close());
});

test("repeated metadata failures remain visibly retryable and never discard a completed binary", async (t) => {
  let fail = false;
  const fx = await fixture(t, {
    save() {
      if (fail) throw new Error("SQLITE_FULL");
    },
  });
  const material = await fx.service.capture(fx.project, { type: "image", url: image });
  fail = true;
  await assert.rejects(fx.service.retry(fx.project, material.id), /SQLITE_FULL/);
  assert.equal(material.status, "local");
  assert.match(material.error, /记录保存失败/);
  assert.deepEqual(await readFile((await fx.service.file(material.id)).path), bytes);
  fail = false;
  assert.equal(await fx.service.retry(fx.project, material.id), material);
  assert.equal(material.error, undefined);
});
