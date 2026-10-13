export const PROJECT_COLLECTIONS = [
  "messages",
  "assets",
  "materials",
  "chapters",
  "nodes",
];

const rootCollections = ["projects", "agents", "providers"];

export const TABLES = [
  { name: "workspace_metadata", columns: ["id", "value", "collections"], keys: ["id"] },
  {
    name: "projects",
    columns: ["id", "position", "value", "collections"],
    keys: ["id"],
  },
  ...["agents", "providers"].map((name) => ({
    name,
    columns: ["entity_key", "id", "position", "value"],
    keys: ["entity_key"],
  })),
  ...[...PROJECT_COLLECTIONS, "episodes"].map((name) => ({
    name: `project_${name}`,
    columns: ["project_id", "entity_key", "id", "position", "value"],
    keys: ["project_id", "entity_key"],
  })),
];

export const rowKey = (table, row) => JSON.stringify(table.keys.map((key) => row[key]));
export const rowValue = (table, row) =>
  JSON.stringify(table.columns.map((column) => row[column]));

export function emptyRows() {
  return new Map(TABLES.map((table) => [table.name, new Map()]));
}

function splitCollections(value, names) {
  const base = { ...value };
  const collections = [];
  for (const name of names) {
    if (!Array.isArray(value[name])) continue;
    collections.push(name);
    delete base[name];
  }
  return { base, collections };
}

/** Keep unknown fields and absent/empty collections distinct across round trips. */
export function encodeState(state) {
  const rows = emptyRows();
  function add(tableName, row) {
    const table = TABLES.find((item) => item.name === tableName);
    const key = rowKey(table, row);
    if (rows.get(tableName).has(key))
      throw new Error(`数据库中存在重复记录：${tableName}`);
    rows.get(tableName).set(key, row);
  }
  function addEntities(tableName, values, projectId, prefix = "") {
    const occurrences = new Map();
    for (const [position, value] of values.entries()) {
      const id = typeof value?.id === "string" ? value.id : null;
      const identity = id === null ? `position:${position}` : `id:${id}`;
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      add(tableName, {
        ...(projectId !== undefined ? { project_id: projectId } : {}),
        entity_key: JSON.stringify([prefix, identity, occurrence]),
        id,
        position,
        value: JSON.stringify(value),
      });
    }
  }
  const root = splitCollections(state, rootCollections);
  add("workspace_metadata", {
    id: 1,
    value: JSON.stringify(root.base),
    collections: JSON.stringify(root.collections),
  });
  for (const name of ["agents", "providers"])
    if (root.collections.includes(name)) addEntities(name, state[name]);
  for (const [position, project] of (state.projects || []).entries()) {
    if (typeof project.id !== "string" || !project.id)
      throw new Error("项目缺少有效 ID，无法安全保存数据库。");
    const { base, collections } = splitCollections(project, [
      ...PROJECT_COLLECTIONS,
      "episodeArchive",
    ]);
    if (project.currentEpisode && typeof project.currentEpisode === "object") {
      collections.push("currentEpisode");
      delete base.currentEpisode;
      addEntities("project_episodes", [project.currentEpisode], project.id, "current");
    }
    if (collections.includes("episodeArchive"))
      addEntities("project_episodes", project.episodeArchive, project.id, "archive");
    add("projects", {
      id: project.id,
      position,
      value: JSON.stringify(base),
      collections: JSON.stringify(collections),
    });
    for (const name of PROJECT_COLLECTIONS)
      if (collections.includes(name))
        addEntities(`project_${name}`, project[name], project.id);
  }
  return rows;
}

export function readRows(db) {
  const rows = emptyRows();
  for (const table of TABLES)
    for (const row of db
      .prepare(`SELECT ${table.columns.join(",")} FROM ${table.name}`)
      .all())
      rows.get(table.name).set(rowKey(table, row), row);
  return rows;
}

export function decodeState(rows) {
  const metadata = [...rows.get("workspace_metadata").values()][0];
  if (!metadata) throw new Error("数据库缺少工作区元数据，请从备份恢复。");
  const state = JSON.parse(metadata.value);
  const rootFields = JSON.parse(metadata.collections);
  const ordered = (name, predicate = () => true) =>
    [...rows.get(name).values()]
      .filter(predicate)
      .sort((left, right) => left.position - right.position);
  for (const name of ["agents", "providers"])
    if (rootFields.includes(name))
      state[name] = ordered(name).map((row) => JSON.parse(row.value));
  if (rootFields.includes("projects"))
    state.projects = ordered("projects").map((row) => {
      const project = JSON.parse(row.value);
      const fields = JSON.parse(row.collections);
      const belongs = (entity) => entity.project_id === row.id;
      for (const name of PROJECT_COLLECTIONS)
        if (fields.includes(name))
          project[name] = ordered(`project_${name}`, belongs).map((entity) =>
            JSON.parse(entity.value),
          );
      const episodes = ordered("project_episodes", belongs);
      if (fields.includes("currentEpisode")) {
        const current = episodes.find(
          (entity) => JSON.parse(entity.entity_key)[0] === "current",
        );
        if (!current) throw new Error("数据库缺少当前剧集，请从备份恢复。");
        project.currentEpisode = JSON.parse(current.value);
      }
      if (fields.includes("episodeArchive"))
        project.episodeArchive = episodes
          .filter((entity) => JSON.parse(entity.entity_key)[0] === "archive")
          .map((entity) => JSON.parse(entity.value));
      return project;
    });
  return state;
}
