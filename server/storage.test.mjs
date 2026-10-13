import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "./store.mjs";
import { createProject, createSeedState } from "./seed.mjs";
import { TABLES } from "./storage/codec.mjs";
import { SCHEMA_VERSION, STORAGE_MIGRATION } from "./storage/schema.mjs";

const cleanupResources = new WeakMap();

function temporaryDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-normalized-"));
  const resources = [];
  cleanupResources.set(t, resources);
  t.after(() => {
    for (const resource of resources.reverse()) {
      try {
        resource.close();
      } catch (error) {
        if (error.code !== "ERR_INVALID_STATE") throw error;
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "workspace.sqlite");
}

function fixture() {
  const state = createSeedState();
  state.custom = { nested: [false, null, "保留额外字段"], version: 4 };
  state.providers[0].apiKey = "synthetic-private-key-never-real";
  state.providers[0].customHeaders = { "X-Fixture": "private-header" };
  state.agents[0].customPrompt = "保留配置";
  const first = createProject({ name: "第一项目" });
  const second = createProject({ name: "第二项目" });
  first.currentEpisode.startMessageIndex = 1;
  first.messages.push({
    id: "latest",
    type: "text",
    content: "本集消息",
    createdAt: "2026-01-01",
  });
  first.materials = [
    {
      id: "material",
      type: "image",
      status: "local",
      path: "media/original.png",
      url: "/api/media/material/file",
      sourceUrl: "https://fixture.example/image",
      createdAt: "2026-01-01",
    },
  ];
  first.assets = [
    {
      id: "asset",
      name: "主角",
      tags: [],
      type: "character",
      materialId: "material",
      content: "完整资产",
      versions: [{ version: 1, materialId: "old-material" }],
    },
  ];
  first.chapters = [{ id: "chapter", title: "原文", content: "完整章节\n第二行" }];
  first.nodes[3].characterGeneration = {
    plan: [{ id: "draft", status: "ready", materialId: "material" }],
    key: "checkpoint",
  };
  first.memory = {
    summary: "已确认记忆",
    facts: ["事实"],
    decisions: ["决定"],
    compressedCount: 0,
  };
  first.episodeArchive = [
    {
      id: "archived",
      number: 0,
      nodes: structuredClone(first.nodes),
      assets: structuredClone(first.assets),
      materials: structuredClone(first.materials),
      arbitrary: { untouched: true },
    },
  ];
  first.extra = null;
  second.optional = { unchanged: true };
  state.projects = [first, second];
  return state;
}

function legacyDatabase(filename, state) {
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TABLE workspace(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  // Whitespace is intentional: backups preserve the original bytes, not reserialization.
  const value = JSON.stringify(state, null, 2);
  db.prepare("INSERT INTO workspace VALUES(1,?,?)").run(value, "2025-01-01");
  return { db, value };
}

function rows(db) {
  return TABLES.map(({ name }) =>
    db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  );
}

test("legacy migration preserves all fields, private settings, ordered history, media references and absent collections", (t) => {
  const filename = temporaryDatabase(t);
  const expected = fixture();
  const { db, value } = legacyDatabase(filename, expected);
  db.close();
  const store = createStore({ filename });
  assert.deepEqual(store.getState(), expected);
  store.close();
  const inspection = new DatabaseSync(filename);
  assert.equal(
    inspection.prepare("PRAGMA user_version").get().user_version,
    SCHEMA_VERSION,
  );
  assert.equal(
    inspection
      .prepare("SELECT value FROM migration_backups WHERE id=?")
      .get(STORAGE_MIGRATION).value,
    value,
  );
  assert.equal(
    inspection.prepare("SELECT value FROM workspace_legacy_v0").get().value,
    value,
  );
  assert.equal(
    inspection.prepare("SELECT count(*) AS n FROM project_episodes").get().n,
    3,
  );
  const metadata = JSON.parse(
    inspection.prepare("SELECT value FROM workspace_metadata").get().value,
  );
  assert.deepEqual(metadata, { custom: expected.custom });
  const projectMetadata = JSON.parse(
    inspection
      .prepare("SELECT value FROM projects WHERE id=?")
      .get(expected.projects[0].id).value,
  );
  for (const field of [
    "messages",
    "assets",
    "materials",
    "chapters",
    "nodes",
    "episodeArchive",
    "currentEpisode",
  ])
    assert.equal(Object.hasOwn(projectMetadata, field), false);
  const before = rows(inspection);
  inspection.close();
  const reopened = createStore({
    filename,
    seed: () => assert.fail("Must not reseed"),
  });
  assert.deepEqual(reopened.getState(), expected);
  assert.equal(Object.hasOwn(reopened.getState().projects[1], "materials"), false);
  reopened.close();
  const after = new DatabaseSync(filename);
  assert.deepEqual(rows(after), before);
  assert.equal(after.prepare("SELECT count(*) AS n FROM migration_backups").get().n, 1);
  after.close();
});

test("a failed schema migration leaves the original workspace and version intact and retries cleanly", (t) => {
  const filename = temporaryDatabase(t);
  const expected = fixture();
  const { db, value } = legacyDatabase(filename, expected);
  db.exec(`CREATE TABLE migration_backups(id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER reject_migration BEFORE INSERT ON migration_backups BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END`);
  db.close();
  assert.throws(() => createStore({ filename }), /synthetic migration failure/);
  const inspection = new DatabaseSync(filename);
  assert.equal(
    inspection.prepare("SELECT value FROM workspace WHERE id=1").get().value,
    value,
  );
  assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(
    inspection
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('projects','schema_migrations','workspace_legacy_v0')",
      )
      .get().n,
    0,
  );
  inspection.exec("DROP TRIGGER reject_migration");
  inspection.close();
  const retried = createStore({ filename });
  assert.deepEqual(retried.getState(), expected);
  retried.close();
});

test("normalized databases reject old writers and unsupported future versions", (t) => {
  const filename = temporaryDatabase(t);
  const { db } = legacyDatabase(filename, fixture());
  db.close();
  createStore({ filename }).close();
  const legacy = new DatabaseSync(filename);
  legacy.exec(
    "CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  assert.throws(
    () =>
      legacy
        .prepare(
          "INSERT INTO workspace(id,value,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .run("{}", "now"),
    /view/,
  );
  const before = rows(legacy);
  legacy.exec("PRAGMA user_version = 99");
  legacy.close();
  assert.throws(() => createStore({ filename }), /不支持数据库版本 99/);
  const inspection = new DatabaseSync(filename);
  assert.deepEqual(rows(inspection), before);
  assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 99);
  inspection.close();
});

test("saves write only changed entity rows and preserve reorders and deletions", (t) => {
  const filename = temporaryDatabase(t);
  const store = createStore({ filename, seed: fixture });
  cleanupResources.get(t).push(store);
  const db = new DatabaseSync(filename);
  cleanupResources.get(t).push(db);
  db.exec("CREATE TABLE audit(table_name TEXT, operation TEXT)");
  for (const { name } of TABLES)
    for (const operation of ["INSERT", "UPDATE", "DELETE"])
      db.exec(
        `CREATE TRIGGER audit_${name}_${operation} AFTER ${operation} ON ${name} BEGIN INSERT INTO audit VALUES('${name}','${operation}'); END`,
      );
  store.save();
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit").get().n, 0);
  const project = store.getState().projects[0];
  project.messages.push({ id: "new-message", type: "text", content: "追加" });
  store.save();
  assert.deepEqual(
    db
      .prepare("SELECT * FROM audit")
      .all()
      .map((row) => ({ ...row })),
    [{ table_name: "project_messages", operation: "INSERT" }],
  );
  db.exec("DELETE FROM audit");
  project.nodes[3].characterGeneration.plan[0].status = "approved";
  store.save();
  assert.deepEqual(
    db
      .prepare("SELECT * FROM audit")
      .all()
      .map((row) => ({ ...row })),
    [{ table_name: "project_nodes", operation: "UPDATE" }],
  );
  project.messages.reverse();
  project.assets = [];
  store.getState().projects.reverse();
  store.save();
  const expected = structuredClone(store.getState());
  db.close();
  store.close();
  const reopened = createStore({ filename });
  assert.deepEqual(reopened.getState(), expected);
  reopened.getState().projects.splice(1, 1);
  reopened.save();
  const reader = new DatabaseSync(filename);
  assert.equal(
    reader
      .prepare("SELECT count(*) AS n FROM project_messages WHERE project_id=?")
      .get(project.id).n,
    0,
  );
  reader.close();
  reopened.close();
});

test("failed multi-entity save rolls back fully and the same pending changes succeed on retry", (t) => {
  const filename = temporaryDatabase(t);
  const store = createStore({ filename, seed: fixture });
  cleanupResources.get(t).push(store);
  const db = new DatabaseSync(filename);
  cleanupResources.get(t).push(db);
  const before = rows(db);
  db.exec(
    "CREATE TRIGGER reject_message BEFORE INSERT ON project_messages WHEN NEW.id='rejected' BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END",
  );
  const state = store.getState();
  state.custom.version++;
  state.projects[0].name = "改名";
  state.providers[0].apiKey = "new-synthetic-key";
  state.projects[0].messages.push({ id: "rejected", content: "不能部分落盘" });
  assert.throws(() => store.save(), /synthetic save failure/);
  assert.deepEqual(rows(db), before);
  assert.equal(store.listMessages(state.projects[0].id).total, 2);
  db.exec("DROP TRIGGER reject_message");
  store.save();
  assert.equal(store.listMessages(state.projects[0].id).total, 3);
  assert.equal(
    JSON.parse(
      db.prepare("SELECT value FROM projects WHERE id=?").get(state.projects[0].id)
        .value,
    ).name,
    "改名",
  );
  assert.equal(
    JSON.parse(
      db.prepare("SELECT value FROM providers WHERE id=?").get(state.providers[0].id)
        .value,
    ).apiKey.cipher,
    "aes-256-gcm-v1",
  );
  store.close();
  const reopened = createStore({ filename });
  cleanupResources.get(t).push(reopened);
  assert.equal(reopened.getState().providers[0].apiKey, "new-synthetic-key");
});

test("query pages isolate projects, filter before paging, and keep absolute current-episode message cursors", (t) => {
  const filename = temporaryDatabase(t);
  const state = fixture();
  const [project, other] = state.projects;
  project.materials = Array.from({ length: 5 }, (_, index) => ({
    id: `m${index}`,
    type: index % 2 ? "video" : "image",
    status: index < 3 ? "local" : "remote",
    name: `HÉRO_${index}`,
    model: "fixture",
    createdAt: "2026-01-01",
  }));
  other.materials = [
    {
      id: "unrelated",
      type: "image",
      status: "local",
      name: "HÉRO",
      createdAt: "2027-01-01",
    },
  ];
  project.messages = Array.from({ length: 12 }, (_, index) => ({
    id: `message-${index}`,
    content: `消息 ${index}`,
  }));
  project.currentEpisode.startMessageIndex = 3;
  const store = createStore({ filename, seed: () => state });
  cleanupResources.get(t).push(store);
  const filtered = store.listMaterials(project.id, {
    type: "image",
    q: "héro",
    offset: 1,
    limit: 1,
  });
  assert.deepEqual(
    filtered.items.map((item) => item.id),
    ["m2"],
  );
  assert.equal(filtered.total, 3);
  assert.equal(filtered.projectTotal, 5);
  assert.equal(filtered.savedCount, 3);
  assert.equal(filtered.hasMore, true);
  assert.deepEqual(
    store.listMaterials(other.id).items.map((item) => item.id),
    ["unrelated"],
  );
  const newest = store.listMessages(project.id, {
    startIndex: 3,
    episodeId: project.currentEpisode.id,
    limit: 4,
  });
  assert.deepEqual(
    newest.items.map((item) => item.id),
    ["message-8", "message-9", "message-10", "message-11"],
  );
  assert.equal(newest.total, 9);
  assert.equal(newest.startIndex, 8);
  assert.equal(newest.nextBefore, 8);
  const oldest = store.listMessages(project.id, { startIndex: 3, before: 4, limit: 4 });
  assert.deepEqual(
    oldest.items.map((item) => item.id),
    ["message-3"],
  );
  assert.equal(oldest.nextBefore, null);
  assert.deepEqual(store.getProjectCounts(project.id), {
    assets: 1,
    materials: 5,
    savedMaterials: 3,
    episodes: 2,
    messages: 12,
  });
});
