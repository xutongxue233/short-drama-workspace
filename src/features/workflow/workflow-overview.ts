import type { Agent, Project } from "../../types";

export function episodeLabel(project: Project) {
  return `第 ${String(project.currentEpisode?.number ?? 1).padStart(2, "0")} 集`;
}

export function episodeTitle(project: Project) {
  const title = project.currentEpisode?.title?.trim() ?? "";
  const defaultTitle = /^第\s*0*(\d+)\s*集$/.exec(title);
  return defaultTitle &&
    Number(defaultTitle[1]) === (project.currentEpisode?.number ?? 1)
    ? ""
    : title;
}

export function workflowOverview(project: Project) {
  const completed = project.nodes.filter((node) => node.status === "completed").length;
  const finished = project.nodes.length > 0 && completed === project.nodes.length;
  const current =
    project.nodes.find((node) => node.id === project.approval?.nodeId) ??
    project.nodes.find((node) => node.status === "running") ??
    project.nodes.find((node) => node.status === "failed") ??
    project.nodes.find((node) => node.status === "waiting") ??
    project.nodes.find((node) => node.status === "pending");
  const next = current
    ? project.nodes
        .slice(project.nodes.indexOf(current) + 1)
        .find((node) => node.status !== "completed")
    : undefined;
  const handoff = project.approval?.nextStep ?? next;
  const state = project.approval
    ? "待你确认"
    : current?.status === "running"
      ? "创作中"
      : current?.status === "failed"
        ? "需处理"
        : current?.status === "waiting"
          ? "待你确认"
          : finished
            ? "流程验收完成"
            : "待开始";
  return { completed, finished, current, handoff, state };
}

export function agentWorkState(project: Project, agent: Agent) {
  const nodes = project.nodes.filter((node) => node.agentId === agent.id);
  if (nodes.some((node) => node.status === "running")) return "创作中";
  if (project.chatPending?.agentId === agent.id) return "回复中";
  if (nodes.some((node) => node.status === "failed")) return "需处理";
  if (
    nodes.some(
      (node) => node.status === "waiting" || node.id === project.approval?.nodeId,
    )
  )
    return "待你确认";
  if (!agent.enabled) return "已停用";
  if (workflowOverview(project).current?.agentId === agent.id) return "待开始";
  if (nodes.some((node) => node.status === "pending")) return "待接手";
  if (nodes.length) return "节点已完成";
  return "待命";
}

export function projectTotals(project: Project) {
  const archived = project.counts
    ? Math.max(0, project.counts.episodes - 1)
    : (project.episodeArchive?.length ?? 0);
  const characters = project.assets.filter(
    (asset) =>
      asset.type === "character" &&
      asset.characterDesign?.subjectType !== "object" &&
      asset.locked &&
      !asset.tags.some((tag) => ["历史版本", "待更新", "待重新生成"].includes(tag)),
  ).length;
  const savedMaterials =
    project.counts?.savedMaterials ??
    (project.materials ?? []).filter((material) => material.status === "local").length;
  return { created: archived + 1, archived, characters, savedMaterials };
}
