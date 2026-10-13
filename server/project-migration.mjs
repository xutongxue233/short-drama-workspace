import { uid, now } from "./seed.mjs";
import { compressMemory } from "./workflow/memory.mjs";

export const PROJECT_MIGRATION = "single-episode-model-workflow-v1";

/** Upgrade old projects without reinterpreting template results as model work. */
export function migrateProjectScope(state) {
  let changed = false;
  for (const project of state.projects) {
    const hadLegacyFields =
      Object.hasOwn(project, "mode") || Object.hasOwn(project, "episodes");
    const wasDemo = project.mode === "demo";
    const multiEpisodeBrief = project.productionBrief?.episodeCount > 1;
    const oldFields = project.approval?.fields || [];
    const fields = oldFields.filter((field) => field.id !== "episodeCount");
    const templateAssets = project.assets.filter(
      (asset) =>
        !asset.tags.includes("历史版本") &&
        (asset.tags.includes("演示提案") ||
          /【演示|演示文字设计提案|规则模板，未调用真实模型/u.test(
            String(asset.content || "").slice(0, 200),
          )),
    );
    if (
      !hadLegacyFields &&
      !multiEpisodeBrief &&
      fields.length === oldFields.length &&
      !templateAssets.length
    )
      continue;
    changed = true;
    delete project.mode;
    delete project.episodes;
    for (const asset of templateAssets) {
      asset.locked = false;
      asset.tags = [...new Set([...asset.tags, "历史版本", "待更新"])];
    }
    if (wasDemo || multiEpisodeBrief) {
      // The store saves a complete pre-migration snapshot before committing.
      // Original chapters, conversations, assets and downloaded files remain.
      for (const node of project.nodes) {
        node.status = "pending";
        node.output = "";
        delete node.error;
        delete node.startedAt;
        delete node.completedAt;
        delete node.characterGeneration;
      }
      for (const asset of project.assets) {
        if (
          !asset.tags.includes("历史版本") &&
          !["character", "scene"].includes(asset.type)
        )
          asset.tags = [...new Set([...asset.tags, "待更新"])];
      }
      project.running = false;
      project.approval = null;
      delete project.productionBrief;
      project.messages.push({
        id: uid("message"),
        agentId: "system",
        type: "system",
        createdAt: now(),
        content: wasDemo
          ? "工作台已统一使用配置的模型创作。此前模板产物仅保留为历史资料，原文、消息与素材均已保留。请根据本集原文从原著拆解开始，制作当前一集。"
          : "工作台现在按已提供原文每轮制作一集。此前多集制作方案需要重新确认；原文、历史产物与锁定角色已保留，请从原著拆解核对本集范围。",
      });
    } else if (fields.length !== oldFields.length) {
      project.approval.fields = fields;
    }
    compressMemory(project);
  }
  return changed;
}
