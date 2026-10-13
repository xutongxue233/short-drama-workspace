function pagination(options) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new RangeError("无效的分页参数。");
  return { limit, offset };
}

function collectionQuery(db, table, projectId, options, searchFields, order) {
  const { limit, offset } = pagination(options);
  const clauses = ["project_id = ?"];
  const bindings = [projectId];
  for (const field of ["type", "status"])
    if (options[field] && options[field] !== "all") {
      clauses.push(`json_extract(value, '$.${field}') = ?`);
      bindings.push(options[field]);
    }
  const q = String(options.q || "")
    .trim()
    .toLocaleLowerCase();
  if (q) {
    clauses.push(
      `(${searchFields.map((field) => `instr(workbench_lower(COALESCE(json_extract(value, '$.${field}'), '')), ?) > 0`).join(" OR ")})`,
    );
    bindings.push(...searchFields.map(() => q));
  }
  const where = clauses.join(" AND ");
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get(...bindings).count;
  const items = db
    .prepare(
      `SELECT value FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit, offset)
    .map((row) => JSON.parse(row.value));
  return { items, total, offset, limit, hasMore: offset + items.length < total };
}

export function createQueries(db) {
  // SQLite lower() is ASCII-only; match the UI's Unicode case-insensitive search.
  db.function("workbench_lower", { deterministic: true }, (value) =>
    String(value).toLocaleLowerCase(),
  );
  const count = (table, projectId, condition = "", values = []) =>
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ? ${condition}`,
      )
      .get(projectId, ...values).count;
  return {
    listMaterials(projectId, options = {}) {
      return {
        ...collectionQuery(
          db,
          "project_materials",
          projectId,
          options,
          ["name", "model", "prompt"],
          "json_extract(value, '$.createdAt') DESC, id DESC, position ASC",
        ),
        projectTotal: count("project_materials", projectId),
        savedCount: count(
          "project_materials",
          projectId,
          "AND json_extract(value, '$.status') = 'local'",
        ),
      };
    },
    listAssets(projectId, options = {}) {
      return collectionQuery(
        db,
        "project_assets",
        projectId,
        options,
        ["name", "description", "tags"],
        "position ASC",
      );
    },
    listMessages(projectId, options = {}) {
      const { limit } = pagination(options);
      const lower = options.startIndex ?? 0;
      const countAll = count("project_messages", projectId);
      const upper = Math.min(options.before ?? countAll, countAll);
      if (
        !Number.isSafeInteger(lower) ||
        lower < 0 ||
        !Number.isSafeInteger(upper) ||
        upper < 0
      )
        throw new RangeError("无效的消息分页参数。");
      const rows = db
        .prepare(
          "SELECT position, value FROM project_messages WHERE project_id = ? AND position >= ? AND position < ? ORDER BY position DESC LIMIT ?",
        )
        .all(projectId, lower, upper, limit)
        .reverse();
      const first = rows[0]?.position ?? Math.max(lower, upper);
      return {
        items: rows.map((row) => JSON.parse(row.value)),
        total: count("project_messages", projectId, "AND position >= ?", [lower]),
        nextBefore: rows.length && first > lower ? first : null,
        startIndex: first,
        episodeId: options.episodeId,
      };
    },
    getProjectCounts(projectId) {
      return {
        assets: count("project_assets", projectId),
        materials: count("project_materials", projectId),
        savedMaterials: count(
          "project_materials",
          projectId,
          "AND json_extract(value, '$.status') = 'local'",
        ),
        episodes: count("project_episodes", projectId),
        messages: count("project_messages", projectId),
      };
    },
  };
}
