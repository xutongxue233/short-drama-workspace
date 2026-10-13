import type { EpisodeArchive, Project } from "../../types";

export function canStartNextEpisode(project: Project) {
  return (
    !project.running &&
    !project.backgroundTask &&
    !project.approval &&
    !project.chatPending &&
    project.nodes.length > 0 &&
    project.nodes.every((node) => node.status === "completed")
  );
}

/** A read-only historical view; archived messages already have episode boundaries. */
export function archivedEpisodeProject(
  project: Project,
  episode: EpisodeArchive,
): Project {
  return {
    ...project,
    currentEpisode: {
      id: episode.id,
      number: episode.number,
      title: episode.title,
      createdAt: episode.createdAt,
      startMessageIndex: 0,
      startAssetIds: [],
      startMaterialIds: [],
    },
    chapters: episode.chapters,
    nodes: episode.nodes,
    messages: episode.messages,
    assets: episode.assets,
    materials: episode.materials,
    memory: episode.memory,
    productionBrief: episode.productionBrief,
    running: false,
    backgroundTask: null,
    chatPending: null,
    approval: null,
    workflowIssues: [],
  };
}
