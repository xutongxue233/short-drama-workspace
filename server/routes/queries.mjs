import { HttpError } from "../http/errors.mjs";
import {
  messagePage,
  projectCounts,
  publicProject,
  workspaceSnapshot,
} from "../services/workspace-snapshot.mjs";

function queryText(query, name, fallback, max = 200) {
  const value = query[name];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max)
    throw new HttpError(400, `${name} 查询参数无效`);
  return value;
}

function integerQuery(query, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const value = queryText(query, name, undefined);
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new HttpError(400, `${name} 必须是有效整数`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new HttpError(400, `${name} 必须在 ${min} 至 ${max} 之间`);
  return result;
}

function enumQuery(query, name, values, fallback) {
  const value = queryText(query, name, fallback);
  if (!values.includes(value)) throw new HttpError(400, `${name} 查询参数无效`);
  return value;
}

function allowedQuery(query, keys) {
  if (Object.keys(query).some((key) => !keys.includes(key)))
    throw new HttpError(400, "包含不支持的查询参数");
}

function collectionOptions(query, material) {
  allowedQuery(query, [
    "limit",
    "offset",
    "type",
    "q",
    ...(material ? ["status"] : []),
  ]);
  return {
    limit: integerQuery(query, "limit", 24, 1, 100),
    offset: integerQuery(query, "offset", 0, 0),
    type: enumQuery(
      query,
      "type",
      material
        ? ["all", "image", "video", "audio"]
        : ["all", "character", "scene", "storyboard", "script", "video", "audio"],
      "all",
    ),
    q: queryText(query, "q", "", 200).trim(),
    ...(material
      ? {
          status: enumQuery(
            query,
            "status",
            ["all", "local", "remote", "failed", "downloading"],
            "all",
          ),
        }
      : {}),
  };
}

function fallbackCollection(project, options, material) {
  const { limit, offset, type, q, status } = options;
  const collection = material ? project.materials || [] : project.assets;
  const term = q.toLowerCase();
  let items = collection.filter(
    (item) =>
      (type === "all" || item.type === type) &&
      (!material || status === "all" || item.status === status) &&
      (material
        ? [item.name, item.model, item.prompt]
        : [item.name, item.description, ...(item.tags || [])]
      ).some((text) =>
        String(text || "")
          .toLowerCase()
          .includes(term),
      ),
  );
  if (material)
    items = items.toSorted(
      (a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")) ||
        String(b.id).localeCompare(String(a.id)),
    );
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    ...(material
      ? {
          projectTotal: collection.length,
          savedCount: collection.filter((item) => item.status === "local").length,
        }
      : {}),
    offset,
    limit,
    hasMore: offset + limit < items.length,
  };
}

export function mountQueryRoutes(app, { store, getState, findProject, chat }) {
  app.get("/api/state", (req, res) => {
    allowedQuery(req.query, ["projectId", "compact", "history"]);
    const projectId = queryText(req.query, "projectId", undefined);
    if (projectId === "") throw new HttpError(400, "projectId 不能为空");
    const compact = enumQuery(req.query, "compact", ["0", "1"], "0") === "1";
    const history = enumQuery(req.query, "history", ["recent", "full"], "recent");
    res.json(workspaceSnapshot(store, chat, { projectId, compact, history }));
  });
  app.get("/api/projects/:id", (req, res) => {
    allowedQuery(req.query, []);
    const project = findProject(req.params.id);
    res.json({
      ...publicProject(project, getState(), chat),
      counts: projectCounts(store, project),
      snapshot: { history: "full" },
    });
  });
  app.get("/api/projects/:id/messages", (req, res) => {
    allowedQuery(req.query, ["limit", "before"]);
    const project = findProject(req.params.id);
    res.json(
      messagePage(store, project, {
        limit: integerQuery(req.query, "limit", 50, 1, 100),
        before: integerQuery(req.query, "before", undefined, 0),
      }),
    );
  });
  app.get("/api/projects/:id/materials", (req, res) => {
    const project = findProject(req.params.id);
    const options = collectionOptions(req.query, true);
    const result =
      store.listMaterials?.(project.id, options) ??
      fallbackCollection(project, options, true);
    res.json({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        nodeName: project.nodes.find((node) => node.id === item.nodeId)?.name,
      })),
    });
  });
  app.get("/api/projects/:id/assets", (req, res) => {
    const project = findProject(req.params.id);
    const options = collectionOptions(req.query, false);
    res.json(
      store.listAssets?.(project.id, options) ??
        fallbackCollection(project, options, false),
    );
  });
}
