import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import {
  exportSkillMarkdown,
  formatSkillInstructions,
  parseSkillMarkdown,
  resolveSkills,
  skillUsage,
} from "./skills.mjs";

const draft = (name = "dialogue-polish") => ({
  name,
  description: "精简对白并保留人物动机。",
  instructions: "依据已确认剧本检查对白。\n列出原句、建议和依据。",
});

async function fixture(t, { filename = ":memory:", seed = createSeedState } = {}) {
  const store = createStore({ filename, seed });
  let failSave = false;
  const service = createApp({
    store: {
      ...store,
      save() {
        if (failSave) throw new Error("synthetic save failure");
        store.save();
      },
    },
  });
  const server = createServer(service.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    service.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  };
  t.after(close);
  return {
    state: store.getState(),
    close,
    failSave(value) {
      failSave = value;
    },
    async api(path, body, method = body === undefined ? "GET" : "POST") {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("skill CRUD keeps revisions, rejects duplicate names and removes bindings on deletion", async (t) => {
  const fx = await fixture(t);
  assert.deepEqual((await fx.api("/skills")).body, []);
  assert.deepEqual((await fx.api("/state")).body.skills, []);
  assert.deepEqual((await fx.api("/state?compact=1")).body.skills, []);
  assert.equal(Object.hasOwn(fx.state, "skills"), false);
  const created = await fx.api("/skills", { ...draft(), id: "untrusted", version: 50 });
  assert.equal(created.status, 201);
  const skill = created.body;
  assert.notEqual(skill.id, "untrusted");
  assert.equal(skill.version, 1);
  assert.equal(skill.enabled, true);
  assert.equal(skill.createdAt, skill.updatedAt);
  assert.equal((await fx.api("/skills", draft())).status, 409);
  const other = (await fx.api("/skills", draft("shot-review"))).body;
  assert.equal(
    (await fx.api(`/skills/${other.id}`, { version: 1, name: skill.name }, "PATCH"))
      .status,
    409,
  );
  assert.equal(
    (await fx.api(`/agents/writer`, { skillIds: [skill.id, other.id] }, "PATCH"))
      .status,
    200,
  );
  const edited = await fx.api(
    `/skills/${skill.id}`,
    { version: 1, enabled: false },
    "PATCH",
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.version, 2);
  assert.equal(edited.body.createdAt, skill.createdAt);
  assert.equal(edited.body.instructions, skill.instructions);
  assert.equal(
    (
      await fx.api(
        `/skills/${skill.id}`,
        { version: 1, instructions: "旧编辑" },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (await fx.api(`/skills/${skill.id}`, { version: 1 }, "DELETE")).status,
    409,
  );
  assert.equal(
    (await fx.api(`/skills/${skill.id}`, { version: 2 }, "DELETE")).status,
    200,
  );
  assert.deepEqual(fx.state.agents.find((agent) => agent.id === "writer").skillIds, [
    other.id,
  ]);
  assert.equal((await fx.api(`/skills/${skill.id}/export`)).status, 404);
  assert.deepEqual((await fx.api("/state?compact=1")).body.skills, [other]);
});

test("skill APIs validate names, fields, versions and agent binding IDs before mutation", async (t) => {
  const fx = await fixture(t);
  for (const patch of [
    { name: "" },
    { name: "Contains-Uppercase" },
    { name: "中文" },
    { name: "../relative" },
    { name: "double--dash" },
    { name: "-leading" },
    { name: "trailing-" },
    { name: "a".repeat(65) },
    { name: 10 },
    { description: "" },
    { description: "x".repeat(1001) },
    { instructions: " " },
    { instructions: "x".repeat(12001) },
    { enabled: "false" },
  ])
    assert.equal((await fx.api("/skills", { ...draft(), ...patch })).status, 400);
  assert.equal(Object.hasOwn(fx.state, "skills"), false);
  const skill = (await fx.api("/skills", draft())).body;
  for (const version of [undefined, 0, -1, 1.1, "1", Number.MAX_SAFE_INTEGER + 1]) {
    const body = version === undefined ? {} : { version };
    assert.equal((await fx.api(`/skills/${skill.id}`, body, "PATCH")).status, 400);
    assert.equal((await fx.api(`/skills/${skill.id}`, body, "DELETE")).status, 400);
  }
  for (const skillIds of [
    "not-an-array",
    ["missing"],
    [skill.id, skill.id],
    [null],
    Array(9).fill(skill.id),
  ])
    assert.equal((await fx.api("/agents/writer", { skillIds }, "PATCH")).status, 400);
  assert.equal(fx.state.skills[0].version, 1);
  assert.equal(
    fx.state.agents.find((agent) => agent.id === "writer").skillIds,
    undefined,
  );
  assert.equal(
    (await fx.api("/agents/writer", { skillIds: [skill.id] }, "PATCH")).status,
    200,
  );
  assert.equal((await fx.api("/agents/writer", { skillIds: [] }, "PATCH")).status, 200);
});

test("SKILL.md parse is preview-only and exported instructions round trip safely", async (t) => {
  const fx = await fixture(t);
  const markdown =
    "\uFEFF---\r\nname: dialogue-polish\r\ndescription: |\r\n  对白：先核对人物动机。\r\n  再检查语气。\r\nmetadata:\r\n  author: example\r\n---\r\n\r\n# 输出\r\n\r\n保留 `$name`、冒号: 和 Markdown。\r\n";
  const preview = await fx.api("/skills/parse", { markdown });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.description, "对白：先核对人物动机。\n再检查语气。");
  assert.equal(
    preview.body.instructions,
    "# 输出\n\n保留 `$name`、冒号: 和 Markdown。",
  );
  assert.equal(Object.hasOwn(preview.body, "metadata"), false);
  assert.deepEqual((await fx.api("/skills")).body, []);
  const skill = (await fx.api("/skills", preview.body)).body;
  const exported = await fx.api(`/skills/${skill.id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.filename, "dialogue-polish-SKILL.md");
  assert.deepEqual(parseSkillMarkdown(exported.body.content), preview.body);
  assert.doesNotMatch(exported.body.content, /createdAt|updatedAt|enabled|version:/);
  const maximal = {
    name: "x".repeat(64),
    description: "描".repeat(1000),
    instructions: "文".repeat(12000),
  };
  assert.deepEqual(parseSkillMarkdown(exportSkillMarkdown(maximal).content), maximal);
});

test("SKILL.md parsing rejects invalid or unsafe metadata and oversized instructions", async (t) => {
  const fx = await fixture(t);
  for (const markdown of [
    "# Missing metadata",
    "---\nname: test\n---\nInstructions",
    "---\nname: test\ndescription: 100\n---\nInstructions",
    "---\nname: test\nname: duplicate\ndescription: test\n---\nInstructions",
    "---\nname: [invalid\ndescription: test\n---\nInstructions",
    "---\nname: test\ndescription: !custom test\n---\nInstructions",
    "---\nname: &shared test\ndescription: *shared\n---\nInstructions",
    "---\n- name: test\n- description: test\n---\nInstructions",
    "---\nname: test\ndescription: test\n---\n ",
    `---\nname: test\ndescription: test\n---\n${"x".repeat(12001)}`,
    "x".repeat(65537),
  ])
    assert.equal((await fx.api("/skills/parse", { markdown })).status, 400);
  assert.deepEqual((await fx.api("/skills")).body, []);
});

test("runtime skill selection snapshots revisions, deduplicates and excludes inactive bindings", () => {
  const state = {
    skills: Array.from({ length: 9 }, (_, index) => ({
      ...draft(`skill-${index}`),
      id: `id-${index}`,
      enabled: true,
      version: 1,
    })),
  };
  state.skills[1].enabled = false;
  const agent = { skillIds: ["missing", "id-1", "id-0", "id-0"] };
  const selected = resolveSkills(state, agent, ["id-0", "id-2"]);
  assert.deepEqual(
    selected.map((skill) => skill.id),
    ["id-0", "id-2"],
  );
  assert.deepEqual(skillUsage(selected), [
    { id: "id-0", name: "skill-0", version: 1 },
    { id: "id-2", name: "skill-2", version: 1 },
  ]);
  state.skills[0].instructions = "new revision";
  assert.equal(selected[0].instructions, draft().instructions);
  const formatted = formatSkillInstructions(selected);
  assert.match(formatted, /Skill: skill-0（v1）/);
  assert.match(formatted, /JSON 结构/);
  assert.match(formatted, /人工审批/);
  assert.doesNotMatch(formatted, /new revision|skill-1/);
  assert.equal(formatSkillInstructions([]), "");
  assert.deepEqual(resolveSkills({}, {}), []);
  for (const explicit of [["missing"], ["id-1"], ["id-0", "id-0"]])
    assert.throws(() => resolveSkills(state, agent, explicit), { status: 400 });
  state.skills[1].enabled = true;
  assert.throws(
    () =>
      resolveSkills(
        state,
        { skillIds: state.skills.slice(0, 8).map((skill) => skill.id) },
        ["id-8"],
      ),
    { status: 400 },
  );
  assert.throws(() => formatSkillInstructions(state.skills), { status: 400 });
});

test("skills persist alongside existing v1 data across restarts without altering old records", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-skills-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "workspace.sqlite");
  const original = createSeedState();
  original.custom = { retained: "原有设置" };
  original.projects = [createProject({ name: "原有项目" })];
  const store = createStore({ filename, seed: () => original });
  const before = structuredClone(store.getState());
  store.close();
  const fx = await fixture(t, { filename });
  assert.deepEqual(fx.state, before);
  assert.deepEqual((await fx.api("/state?compact=1")).body.skills, []);
  const skill = (await fx.api("/skills", draft())).body;
  assert.equal(
    (await fx.api("/agents/writer", { skillIds: [skill.id] }, "PATCH")).status,
    200,
  );
  const expected = structuredClone(fx.state);
  await fx.close();
  const reopened = createStore({ filename });
  try {
    assert.deepEqual(reopened.getState(), expected);
    assert.deepEqual(reopened.getState().projects, before.projects);
    assert.deepEqual(reopened.getState().custom, before.custom);
  } finally {
    reopened.close();
  }
});

test("failed persistence rolls back creation, edits, deletion and agent bindings together", async (t) => {
  const fx = await fixture(t);
  fx.failSave(true);
  assert.equal((await fx.api("/skills", draft())).status, 500);
  assert.equal(Object.hasOwn(fx.state, "skills"), false);
  fx.failSave(false);
  const skill = (await fx.api("/skills", draft())).body;
  assert.equal(
    (await fx.api("/agents/writer", { skillIds: [skill.id] }, "PATCH")).status,
    200,
  );
  const originalSkill = fx.state.skills[0];
  const originalIds = fx.state.agents.find((agent) => agent.id === "writer").skillIds;
  const expected = structuredClone(fx.state);
  fx.failSave(true);
  for (const [path, input, method] of [
    [`/skills/${skill.id}`, { version: 1, instructions: "changed" }, "PATCH"],
    [`/skills/${skill.id}`, { version: 1 }, "DELETE"],
    ["/agents/writer", { skillIds: [] }, "PATCH"],
  ]) {
    assert.equal((await fx.api(path, input, method)).status, 500);
    assert.deepEqual(fx.state, expected);
    assert.equal(fx.state.skills[0], originalSkill);
    assert.equal(
      fx.state.agents.find((agent) => agent.id === "writer").skillIds,
      originalIds,
    );
  }
  fx.failSave(false);
  assert.equal(
    (await fx.api(`/skills/${skill.id}`, { version: 1 }, "DELETE")).status,
    200,
  );
});
