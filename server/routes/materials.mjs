import { projectGuard } from "../http/validation.mjs";
import { HttpError } from "../http/errors.mjs";

export function mountMaterialsRoutes(app, { materials, findProject, workflow, chat }) {
  app.get("/api/media/:materialId/file", async (req, res, next) => {
    const { path, material, extension } = await materials.file(req.params.materialId);
    res.type(material.mimeType);
    if (req.query.download === "1")
      res.attachment(
        `${material.name.replace(/[<>:"/\\|?*\r\n]/g, "_").slice(0, 100)}.${extension}`,
      );
    res.sendFile(path, { acceptRanges: true, cacheControl: false }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
  app.post("/api/projects/:id/materials/import", async (req, res) => {
    const project = findProject(req.params.id);
    projectGuard(project);
    await materials.importExisting(project);
    res.json(project);
  });
  app.post("/api/projects/:id/materials/:materialId/download", async (req, res) => {
    const project = findProject(req.params.id);
    await materials.retry(project, req.params.materialId);
    res.json(project);
  });
  app.delete("/api/projects/:id/materials/:materialId", (req, res) => {
    const project = findProject(req.params.id);
    projectGuard(project);
    if (chat.getPending(project.id))
      throw new HttpError(409, "Agent 正在回复，请等待回复结束后再删除素材。");
    materials.remove(project, req.params.materialId, ({ material, assets }) => {
      if (!assets.length) return;
      const ownerIds = new Set(
        assets.flatMap((asset) =>
          (asset.tags || [])
            .filter((tag) => tag.startsWith("node:"))
            .map((tag) => tag.slice(5)),
        ),
      );
      if (material.nodeId) ownerIds.add(material.nodeId);
      if (assets.some((asset) => asset.type === "character"))
        ownerIds.add("characters");
      const index = project.nodes.findIndex((node) => ownerIds.has(node.id));
      if (index >= 0) workflow.invalidateFrom(project, index);
    });
    res.json(project);
  });
}
