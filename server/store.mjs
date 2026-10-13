import { DatabaseSync } from "node:sqlite";
import { acquireStoreOwnership } from "./store-ownership.mjs";
import { createSeedState } from "./seed.mjs";
import { readConfig } from "./config.mjs";
import { migrateProjectScope, PROJECT_MIGRATION } from "./project-migration.mjs";
import { migrateProjectEpisodes, EPISODE_MIGRATION } from "./episode-migration.mjs";

/** A single local SQLite transaction stores each complete, durable checkpoint. */
export function createStore({
  filename = readConfig().databaseFile,
  seed = createSeedState,
} = {}) {
  const releaseOwnership = acquireStoreOwnership(filename);
  let db;
  try {
    db = new DatabaseSync(filename);
    db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    const row = db.prepare("SELECT value FROM workspace WHERE id = 1").get();
    let state = row ? JSON.parse(row.value) : seed();
    const statement = db.prepare(
      "INSERT INTO workspace(id,value,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    );
    const save = () => statement.run(JSON.stringify(state), new Date().toISOString());
    for (const [migrate, migrationId] of [
      [migrateProjectScope, PROJECT_MIGRATION],
      [migrateProjectEpisodes, EPISODE_MIGRATION],
    ]) {
      const beforeMigration = JSON.stringify(state);
      if (!migrate(state)) continue;
      // Keep a private recovery snapshot in SQLite; it is never exposed by /state
      // or project export. Preserve the first snapshot across subsequent restarts.
      db.exec(
        "CREATE TABLE IF NOT EXISTS migration_backups (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL)",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT OR IGNORE INTO migration_backups(id,value,created_at) VALUES(?,?,?)",
        ).run(migrationId, beforeMigration, new Date().toISOString());
        save();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    // No task can still be running after process restart. Its last finished work is retained.
    for (const project of state.projects) {
      const openDiscussions = new Map();
      for (const message of project.messages.slice(
        project.currentEpisode?.startMessageIndex || 0,
      )) {
        const event = message.event;
        if (event?.scope !== "chat" || !event.runId) continue;
        if (event.kind === "start") openDiscussions.set(event.runId, message);
        if (["result", "error", "paused"].includes(event.kind))
          openDiscussions.delete(event.runId);
      }
      for (const [runId, started] of openDiscussions) {
        project.messages.push({
          id: crypto.randomUUID(),
          agentId: started.agentId,
          type: "system",
          content: "已从本地记录恢复。上次讨论回复被中断，原消息保留，可重新发送。",
          createdAt: new Date().toISOString(),
          ...(started.replyTo ? { replyTo: started.replyTo } : {}),
          event: { kind: "paused", scope: "chat", phase: "recovered", runId },
        });
      }
      if (project.running || project.nodes.some((node) => node.status === "running")) {
        const interrupted = project.nodes.find((node) => node.status === "running");
        const execution =
          interrupted &&
          project.messages.findLast(
            (message) =>
              message.nodeId === interrupted.id &&
              message.event?.scope === "workflow" &&
              message.event.runId,
          );
        project.running = false;
        for (const node of project.nodes) {
          if (node.status === "running") {
            node.status = "pending";
            node.error = "上次运行被中断，已恢复到最近检查点，可继续制作。";
          }
        }
        project.messages.push({
          id: crypto.randomUUID(),
          agentId: "system",
          type: "system",
          content: "已从本地检查点恢复。未完成的节点等待继续，已确认资产和记忆已保留。",
          createdAt: new Date().toISOString(),
          ...(interrupted ? { nodeId: interrupted.id } : {}),
          event: {
            kind: "paused",
            scope: "workflow",
            phase: "recovered",
            ...(execution ? { runId: execution.event.runId } : {}),
          },
        });
      }
    }
    save();
    let closed = false;
    return {
      getState: () => state,
      save,
      close() {
        if (closed) return;
        closed = true;
        try {
          db.close();
        } finally {
          releaseOwnership();
        }
      },
      filename,
    };
  } catch (error) {
    try {
      db?.close();
    } finally {
      releaseOwnership();
    }
    throw error;
  }
}
