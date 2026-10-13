import {
  decodeState,
  emptyRows,
  encodeState,
  readRows,
  rowValue,
  TABLES,
} from "./codec.mjs";
import {
  createSchema,
  guardLegacyWriter,
  SCHEMA_VERSION,
  STORAGE_MIGRATION,
} from "./schema.mjs";

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    operation();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createWriter(db) {
  const prepared = TABLES.map((table) => ({
    ...table,
    upsert: db.prepare(
      `INSERT INTO ${table.name} (${[...table.columns, "updated_at"].join(",")}) VALUES (${[...table.columns, "updated_at"].map(() => "?").join(",")}) ON CONFLICT (${table.keys.join(",")}) DO UPDATE SET ${[
        ...table.columns,
        "updated_at",
      ]
        .filter((column) => !table.keys.includes(column))
        .map((column) => `${column}=excluded.${column}`)
        .join(",")}`,
    ),
    remove: db.prepare(
      `DELETE FROM ${table.name} WHERE ${table.keys.map((key) => `${key}=?`).join(" AND ")}`,
    ),
  }));
  return (previous, next) => {
    const updatedAt = new Date().toISOString();
    // Children disappear before parents; parents exist before children are inserted.
    for (const table of [...prepared].reverse())
      for (const [key, row] of previous.get(table.name))
        if (!next.get(table.name).has(key))
          table.remove.run(...table.keys.map((column) => row[column]));
    for (const table of prepared)
      for (const [key, row] of next.get(table.name)) {
        const old = previous.get(table.name).get(key);
        if (old && rowValue(table, old) === rowValue(table, row)) continue;
        table.upsert.run(...table.columns.map((column) => row[column]), updatedAt);
      }
  };
}

function migrateState(state, migrations) {
  const backups = [];
  for (const [migrate, id] of migrations) {
    const before = JSON.stringify(state);
    if (migrate(state)) backups.push({ id, value: before });
  }
  return backups;
}

function saveBackups(db, backups) {
  if (!backups.length) return;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO migration_backups(id,value,created_at) VALUES(?,?,?)",
  );
  for (const { id, value } of backups) insert.run(id, value, new Date().toISOString());
}

/** Schema and legacy content migrations commit together, or leave the old DB intact. */
export function createPersistence(db, { seed, migrations = [], credentials }) {
  const encode = (state) => encodeState(credentials ? credentials.seal(state) : state);
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version !== 0 && version !== SCHEMA_VERSION)
    throw new Error(
      `不支持数据库版本 ${version}，当前应用仅支持版本 ${SCHEMA_VERSION}。请使用兼容版本的应用。`,
    );
  let state;
  let cache;
  let write;
  if (version === 0) {
    const legacy = db
      .prepare("SELECT type FROM sqlite_master WHERE name = 'workspace'")
      .get();
    if (legacy && legacy.type !== "table")
      throw new Error("数据库版本标记缺失，无法安全迁移，请从备份恢复。");
    const original =
      legacy && db.prepare("SELECT value FROM workspace WHERE id = 1").get();
    state = original ? JSON.parse(original.value) : seed();
    const backups = migrateState(state, migrations);
    if (original) backups.unshift({ id: STORAGE_MIGRATION, value: original.value });
    const next = encode(state);
    transaction(db, () => {
      createSchema(db);
      saveBackups(db, backups);
      write = createWriter(db);
      write(emptyRows(), next);
      guardLegacyWriter(db, Boolean(legacy));
      db.prepare(
        "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
      ).run(SCHEMA_VERSION, STORAGE_MIGRATION, new Date().toISOString());
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    cache = next;
  } else {
    const marker = db
      .prepare("SELECT name FROM schema_migrations WHERE version = ?")
      .get(SCHEMA_VERSION);
    if (marker?.name !== STORAGE_MIGRATION)
      throw new Error("数据库迁移记录不完整，请从备份恢复。");
    cache = readRows(db);
    state = decodeState(cache);
    credentials?.open(state);
    write = createWriter(db);
    const backups = migrateState(state, migrations);
    if (backups.length) {
      const next = encode(state);
      transaction(db, () => {
        saveBackups(db, backups);
        write(cache, next);
      });
      cache = next;
    }
  }
  return {
    state,
    save() {
      const next = encode(state);
      transaction(db, () => write(cache, next));
      // A failed transaction must leave this baseline unchanged for the next retry.
      cache = next;
    },
  };
}
