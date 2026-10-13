import { PROJECT_COLLECTIONS } from "./codec.mjs";

export const SCHEMA_VERSION = 1;
export const STORAGE_MIGRATION = "normalized-project-storage-v1";

export function createSchema(db) {
  db.exec(`
    CREATE TABLE workspace_metadata (
      id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL,
      collections TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, position INTEGER NOT NULL, value TEXT NOT NULL,
      collections TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX projects_position ON projects(position);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS migration_backups (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  for (const name of ["agents", "providers"])
    db.exec(`CREATE TABLE ${name} (
      entity_key TEXT PRIMARY KEY, id TEXT, position INTEGER NOT NULL,
      value TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
  for (const name of [...PROJECT_COLLECTIONS, "episodes"])
    db.exec(`
      CREATE TABLE project_${name} (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_key TEXT NOT NULL, id TEXT, position INTEGER NOT NULL,
        value TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, entity_key)
      );
      CREATE INDEX project_${name}_position ON project_${name}(project_id, position);
      CREATE INDEX project_${name}_id ON project_${name}(project_id, id);
    `);
  db.exec(
    `CREATE INDEX project_materials_created ON project_materials(project_id, json_extract(value, '$.createdAt') DESC, id DESC)`,
  );
}

export function guardLegacyWriter(db, legacyExists) {
  if (legacyExists) {
    db.exec("ALTER TABLE workspace RENAME TO workspace_legacy_v0");
    db.exec(
      "CREATE VIEW workspace AS SELECT id, value, updated_at FROM workspace_legacy_v0",
    );
  } else {
    db.exec(
      "CREATE VIEW workspace AS SELECT 1 AS id, NULL AS value, NULL AS updated_at WHERE 0",
    );
  }
}
