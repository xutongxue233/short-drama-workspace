import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "./store.mjs";
import { createSeedState } from "./seed.mjs";

const secret = "synthetic-provider-secret-never-real";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "frameflow-credential-storage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "workspace.sqlite");
  const seed = () => {
    const state = createSeedState();
    state.providers[0].apiKey = secret;
    return state;
  };
  return { filename, seed };
}

test("provider keys are encrypted in SQLite and survive restart without rewriting unchanged rows", (t) => {
  const { filename, seed } = fixture(t);
  const store = createStore({ filename, seed });
  assert.equal(store.getState().providers[0].apiKey, secret);
  store.close();
  const db = new DatabaseSync(filename);
  const before = db.prepare("SELECT * FROM providers").all();
  assert.ok(!JSON.stringify(before).includes(secret));
  assert.equal(JSON.parse(before[0].value).apiKey.cipher, "aes-256-gcm-v1");
  assert.equal(readFileSync(`${filename}.key`).length, 32);
  db.close();
  const reopened = createStore({ filename });
  assert.equal(reopened.getState().providers[0].apiKey, secret);
  reopened.save();
  reopened.close();
  const inspection = new DatabaseSync(filename);
  assert.deepEqual(inspection.prepare("SELECT * FROM providers").all(), before);
  inspection.close();
});

test("missing or wrong encryption key fails closed without replacing the key or database", (t) => {
  const { filename, seed } = fixture(t);
  createStore({ filename, seed }).close();
  const key = readFileSync(`${filename}.key`);
  unlinkSync(`${filename}.key`);
  assert.throws(() => createStore({ filename }), /凭据无法解密/);
  assert.throws(() => readFileSync(`${filename}.key`), { code: "ENOENT" });
  writeFileSync(`${filename}.key`, Buffer.alloc(32, 9));
  assert.throws(() => createStore({ filename }), /凭据无法解密/);
  writeFileSync(`${filename}.key`, key);
  const restored = createStore({ filename });
  assert.equal(restored.getState().providers[0].apiKey, secret);
  restored.close();
});

test("ciphertext tampering and swapping provider identities fail authentication", (t) => {
  const { filename, seed } = fixture(t);
  createStore({ filename, seed }).close();
  const db = new DatabaseSync(filename);
  const row = db.prepare("SELECT * FROM providers ORDER BY position LIMIT 1").get();
  const original = JSON.parse(row.value);
  const altered = structuredClone(original);
  altered.apiKey.tag = Buffer.alloc(16).toString("base64");
  db.prepare("UPDATE providers SET value = ? WHERE entity_key = ?").run(
    JSON.stringify(altered),
    row.entity_key,
  );
  assert.throws(() => createStore({ filename }), /凭据无法解密/);
  db.prepare("UPDATE providers SET value = ? WHERE entity_key = ?").run(
    JSON.stringify({ ...original, id: "another-provider" }),
    row.entity_key,
  );
  assert.throws(() => createStore({ filename }), /凭据无法解密/);
  db.close();
});

test("existing plaintext provider rows are migrated while runtime keys stay usable", (t) => {
  const { filename, seed } = fixture(t);
  createStore({ filename, seed }).close();
  const db = new DatabaseSync(filename);
  const row = db.prepare("SELECT * FROM providers ORDER BY position LIMIT 1").get();
  const provider = { ...JSON.parse(row.value), apiKey: "legacy-fixture-key" };
  db.prepare("UPDATE providers SET value = ? WHERE entity_key = ?").run(
    JSON.stringify(provider),
    row.entity_key,
  );
  db.close();
  const migrated = createStore({ filename });
  assert.equal(migrated.getState().providers[0].apiKey, "legacy-fixture-key");
  migrated.close();
  const inspection = new DatabaseSync(filename);
  assert.ok(
    !inspection
      .prepare("SELECT value FROM providers WHERE entity_key = ?")
      .get(row.entity_key)
      .value.includes("legacy-fixture-key"),
  );
  inspection.close();
});
