import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { activeReference, buildContext } from "./workflow/memory.mjs";

async function fixture(t, { locked = true, structured = true } = {}) {
  const project = createProject({ name: "基础图人工修改", style: "二次元动画" });
  project.nodes.forEach((node) => {
    node.status = "completed";
    node.output = `${node.name}产物`;
  });
  const character = {
    id: "role-current",
    name: "长生",
    type: "character",
    description: "七岁男孩，灰蓝布衣",
    content: "角色：长生\n基础外观：圆脸短黑发，灰蓝布衣。",
    version: 1,
    locked,
    url: "/api/media/material-old-reference/file",
    materialId: "material-old-reference",
    tags: ["node:characters", "角色定妆"],
    ...(structured
      ? {
          characterDesign: {
            version: 1,
            subjectType: "person",
            baseAppearance: "圆脸短黑发，灰蓝布衣",
            sceneStates: [],
          },
        }
      : {}),
  };
  const other = {
    ...structuredClone(character),
    id: "role-other",
    name: "父亲",
    content: "角色：父亲\n基础外观：方脸短发，灰褐布衣。",
    locked: true,
  };
  project.assets = [
    character,
    other,
    {
      id: "script-current",
      name: "已批准剧本",
      type: "script",
      content: "长生看见父亲。",
      description: "本集剧本",
      locked: true,
      version: 1,
      tags: ["node:adaptation"],
    },
  ];
  project.materials = [
    { id: character.materialId, name: "长生旧图", url: character.url, status: "ready" },
  ];
  project.approval = {
    id: "previous-approval",
    nodeId: "characters",
    kind: "character",
    title: "确认角色",
  };
  project.nodes[3].status = "waiting";
  project.nodes[3].characterGeneration = { key: "old-plan", plan: [] };
  const state = createSeedState();
  state.projects = [project];
  const service = createApp({
    store: createStore({ filename: ":memory:", seed: () => state }),
    stepDelay: 0,
  });
  const review = service.workflow.reviewEditedAsset;
  let reviews = 0;
  service.workflow.reviewEditedAsset = (...args) => {
    reviews++;
    return review(...args);
  };
  const server = await new Promise((resolve) => {
    const listener = service.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  async function patch(body) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/assets/${character.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }
  return {
    project,
    character,
    other,
    patch,
    get reviews() {
      return reviews;
    },
  };
}

test("editing a structured role's name, description or content invalidates its image standard", async (t) => {
  for (const [field, value] of [
    ["name", "少年长生"],
    ["description", "七岁男孩，深绿布衣"],
    ["content", "角色：长生\n基础外观：圆脸短黑发，深绿布衣。"],
  ])
    await t.test(field, async (t) => {
      const fx = await fixture(t);
      const upstream = structuredClone(fx.project.nodes.slice(0, 3));
      const other = structuredClone(fx.other);
      const material = structuredClone(fx.project.materials);
      const result = await fx.patch({ [field]: value, locked: false });
      assert.equal(result.status, 200);
      assert.equal(result.body[field], value);
      assert.equal(result.body.characterDesign, undefined);
      assert.equal(result.body.version, 2);
      assert.equal(result.body.locked, false);
      assert.ok(result.body.tags.includes("待更新"));
      assert.ok(result.body.tags.includes("待重新生成"));
      assert.equal(result.body.url, material[0].url);
      assert.equal(result.body.materialId, material[0].id);
      assert.deepEqual(fx.project.materials, material);
      assert.deepEqual(fx.project.nodes.slice(0, 3), upstream);
      assert.deepEqual(fx.other, other);
      assert.ok(fx.project.nodes.slice(3).every((node) => node.status === "pending"));
      assert.equal(fx.project.nodes[3].characterGeneration, undefined);
      assert.equal(fx.project.approval, null);
      assert.equal(fx.reviews, 0);
      assert.equal(activeReference(fx.character), false);
      assert.ok(
        !buildContext(fx.project).references.some((ref) => ref.id === fx.character.id),
      );
      assert.ok(
        fx.project.messages.some((message) =>
          /基础设定已更改，需要重新生成角色图片/.test(message.content),
        ),
      );
      assert.ok(
        fx.project.memory.decisions.some((decision) => decision.includes(value)),
      );
      assert.ok(
        fx.project.memory.decisions.some((decision) =>
          /^用户对「角色定妆」的返修要求：/.test(decision),
        ),
      );
    });
});

test("the original unlock requirement remains mandatory before changing an approved role", async (t) => {
  const fx = await fixture(t);
  const before = JSON.stringify(fx.project);
  const result = await fx.patch({ content: "新基础外观" });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /请先解锁/);
  assert.equal(JSON.stringify(fx.project), before);
});

test("editing and locking an unlocked structured role in one request is rejected atomically", async (t) => {
  const fx = await fixture(t, { locked: false });
  const before = JSON.stringify(fx.project);
  const result = await fx.patch({ description: "改穿深绿布衣", locked: true });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /旧图片不能重新锁定/);
  assert.equal(JSON.stringify(fx.project), before);
});

test("later edits cannot restore stale metadata, open an approval or re-lock the old image", async (t) => {
  const fx = await fixture(t, { locked: false });
  assert.equal((await fx.patch({ content: "先改为深绿布衣" })).status, 200);
  assert.equal((await fx.patch({ content: "再改为青灰布衣" })).status, 200);
  assert.equal(fx.project.approval, null);
  assert.equal(fx.reviews, 0);
  assert.equal(fx.character.characterDesign, undefined);
  assert.ok(fx.character.tags.includes("待重新生成"));
  const before = JSON.stringify(fx.project);
  const result = await fx.patch({ locked: true });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /请先重新生成角色图片/);
  assert.equal(JSON.stringify(fx.project), before);
});

test("unchanged structured design and legacy text edits keep their existing approval behavior", async (t) => {
  const structured = await fixture(t, { locked: false });
  const before = structuredClone(structured.project.nodes);
  assert.equal(
    (await structured.patch({ content: structured.character.content })).status,
    200,
  );
  assert.deepEqual(structured.project.nodes, before);
  assert.equal(structured.character.characterDesign.version, 1);
  assert.equal(structured.character.version, 1);
  const legacy = await fixture(t, { locked: false, structured: false });
  const result = await legacy.patch({ description: "人工修改文字角色提案" });
  assert.equal(result.status, 200);
  assert.equal(legacy.reviews, 1);
  assert.equal(legacy.project.approval.kind, "character");
  assert.notEqual(legacy.project.approval.id, "previous-approval");
  assert.ok(!result.body.tags.includes("待重新生成"));
});
