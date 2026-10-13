import { transactionalRoute } from "../state-transaction.mjs";
import { HttpError } from "../http/errors.mjs";
import {
  bodyObject,
  textInput,
  booleanInput,
  projectGuard,
} from "../http/validation.mjs";
import { remember, addMessage, compressMemory } from "../workflow/memory.mjs";
import { workflowEvent } from "../workflow/events.mjs";

export function mountAssetsRoutes(app, { getState, save, findProject, workflow }) {
  app.patch(
    "/api/projects/:id/assets/:assetId",
    transactionalRoute(getState, (req, res) => {
      const project = findProject(req.params.id);
      projectGuard(project);
      const asset = project.assets.find((item) => item.id === req.params.assetId);
      if (!asset) throw new HttpError(404, "资产不存在");
      if (
        asset.tags.includes("历史版本") &&
        project.episodeArchive?.some((episode) =>
          episode.assets.some((item) => item.id === asset.id),
        )
      )
        throw new HttpError(
          409,
          "此资产属于已归档剧集，仅可查看；请在当前一集创建或修改新的产物。",
        );
      const previous = { ...asset };
      const input = bodyObject(req),
        patch = {};
      if (input.locked !== undefined)
        patch.locked = booleanInput(input.locked, "锁定状态");
      if (input.name !== undefined)
        patch.name = textInput(input.name, "资产名称", {
          max: 120,
          required: true,
        });
      if (input.description !== undefined)
        patch.description = textInput(input.description, "资产描述", {
          max: 4000,
        });
      if (input.content !== undefined)
        patch.content = textInput(input.content, "资产正文", { max: 150000 });
      if (
        asset.locked &&
        (patch.name !== undefined ||
          patch.description !== undefined ||
          patch.content !== undefined) &&
        patch.locked !== false
      )
        throw new HttpError(409, "请先解锁资产，再修改角色标准。");
      const contentChanged = ["name", "description", "content"].some(
        (field) => patch[field] !== undefined && patch[field] !== asset[field],
      );
      const requiresRegeneration =
        contentChanged &&
        asset.type === "character" &&
        (asset.characterDesign ||
          asset.url ||
          asset.materialId ||
          asset.tags.includes("待重新生成"));
      if (
        patch.locked === true &&
        (requiresRegeneration || asset.tags.includes("待重新生成"))
      )
        throw new HttpError(
          409,
          "角色基础设定已更改，旧图片不能重新锁定为标准。请先重新生成角色图片，再确认新形象。",
        );
      if (contentChanged) asset.version += 1;
      const standardChanged =
        contentChanged || (patch.locked === false && asset.locked);
      Object.assign(asset, patch);
      if (contentChanged) asset.tags = [...new Set([...asset.tags, "人工编辑"])];
      if (requiresRegeneration) {
        delete asset.characterDesign;
        asset.locked = false;
        asset.tags = [...new Set([...asset.tags, "待更新", "待重新生成"])];
      }
      if (standardChanged) {
        remember(
          project,
          `人工修改资产标准：${asset.name} / v${asset.version}，${asset.description}。${patch.content !== undefined ? `内容摘录：${asset.content.slice(0, 1000)}` : ""}`,
        );
        if (requiresRegeneration)
          remember(
            project,
            `用户对「角色定妆」的返修要求：角色「${asset.name}」的基础外观已人工修改，请按以下设计修改重新规划中性基础图，不沿用旧图片。身份描述：${asset.description.slice(0, 350)}；正文：${asset.content.slice(0, 850)}。这些内容是人工设计提案，不是新增人物的原著依据。`,
          );
        const affected =
          asset.type === "character" || asset.type === "scene"
            ? "storyboard"
            : asset.type === "storyboard"
              ? "video"
              : asset.type === "script" && asset.tags.includes("node:adaptation")
                ? "compliance"
                : "delivery";
        const ownerId = asset.tags.find((tag) => tag.startsWith("node:"))?.slice(5);
        const ownerIndex = project.nodes.findIndex((node) => node.id === ownerId);
        const affectedIndex = requiresRegeneration
          ? project.nodes.findIndex((node) => node.id === "characters")
          : Math.max(
              project.nodes.findIndex((node) => node.id === affected),
              ownerIndex + 1,
            );
        workflow.invalidateFrom(project, affectedIndex);
        addMessage(
          project,
          "system",
          requiresRegeneration
            ? `「${asset.name}」的基础设定已更改，需要重新生成角色图片。旧图片与素材保留供历史查看，不能继续锁定为角色标准；角色定妆及后续节点需要重新制作与确认。`
            : `「${asset.name}」标准已改变，${project.nodes[affectedIndex] ? `从「${project.nodes[affectedIndex].name}」起的后续节点需要重新制作与确认。` : "请重新确认更新后的交付资料。"}`,
          "system",
          ownerId,
          workflowEvent(project, project.nodes[ownerIndex], "revision_requested", {
            phase: "asset-edited",
          }),
        );
      }
      if (patch.locked !== undefined) {
        remember(
          project,
          `${patch.locked ? "锁定" : "解锁"}资产：${asset.name}（${asset.id} / v${asset.version}）。`,
        );
        addMessage(
          project,
          "system",
          `已${patch.locked ? "锁定" : "解锁"}「${asset.name}」v${asset.version}。${patch.locked ? "后续生成将引用这一标准。" : requiresRegeneration ? "旧图片仅供历史查看，请重新生成基础图后确认新形象。" : "可修改此资产，并重新运行受影响节点。"}`,
          "system",
        );
      }
      if (contentChanged && !requiresRegeneration)
        workflow.reviewEditedAsset(project, asset, previous);
      compressMemory(project);
      save();
      res.json(asset);
    }),
  );
}
