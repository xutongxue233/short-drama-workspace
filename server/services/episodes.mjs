import { HttpError } from "../http/errors.mjs";
import { createEpisode, createNodes, NODE_DEFINITIONS, now } from "../seed.mjs";
import { addMessage, compressMemory, activeReference } from "../workflow/memory.mjs";
import {
  episodeAssets,
  episodeMaterials,
  episodeMessages,
} from "../workflow/episode-scope.mjs";

/** Finish the production review, archive an immutable copy, and open the next round. */
export function beginNextEpisode(project, { title = "", chatPending = false } = {}) {
  if (project.running || chatPending || project.chatPending)
    throw new HttpError(409, "Agent 仍在工作，请等待当前任务结束后创建下一集。");
  if (
    project.approval ||
    project.nodes.length !== NODE_DEFINITIONS.length ||
    NODE_DEFINITIONS.some(
      ([id]) =>
        !project.nodes.some((node) => node.id === id && node.status === "completed"),
    )
  )
    throw new HttpError(
      409,
      "请先完成并确认本集的全部制作节点，再归档并创建下一集。流程验收不代表成片已经完成。",
    );
  const current = project.currentEpisode;
  const time = now();
  const assets = episodeAssets(project);
  const snapshot = structuredClone({
    id: current.id,
    number: current.number,
    title: current.title,
    createdAt: current.createdAt,
    archivedAt: time,
    chapters: project.chapters,
    nodes: project.nodes,
    ...(project.productionBrief ? { productionBrief: project.productionBrief } : {}),
    memory: project.memory,
    messages: episodeMessages(project),
    assets,
    materials: episodeMaterials(project, assets),
  });
  project.episodeArchive.push(snapshot);
  // Shared, approved identity standards outlive an episode. All other old
  // proposals stay available in history but cannot become the next script.
  for (const asset of project.assets) {
    if (["character", "scene"].includes(asset.type) && activeReference(asset)) continue;
    asset.tags = [...new Set([...asset.tags, "历史版本"])];
  }
  project.currentEpisode = {
    ...createEpisode(current.number + 1, time, title),
    startMessageIndex: project.messages.length,
    startAssetIds: project.assets.map((asset) => asset.id),
    startMaterialIds: (project.materials || []).map((material) => material.id),
    startDecisions: [...project.memory.decisions],
  };
  project.nodes = createNodes();
  project.chapters = [];
  project.approval = null;
  project.running = false;
  delete project.productionBrief;
  addMessage(
    project,
    "system",
    `第 ${current.number} 集的制作记录已归档，已创建第 ${project.currentEpisode.number} 集「${project.currentEpisode.title}」。请导入本集原文后开始制作。已锁定角色和场景标准、项目事实、历集聊天与素材均已保留；上集的原文、审批和剧本不会作为本集已批准内容。归档表示制作流程已验收，不代表全部镜头或最终成片已经完成。`,
    "system",
  );
  compressMemory(project);
  return project;
}
