import { publicProvider } from "../providers/config.mjs";
import { workflowReadiness } from "../workflow/readiness.mjs";
import { projectTask } from "./project-tasks.mjs";

/** Test stores can implement just getState/save; production queries run in SQLite. */
export function projectCounts(store, project) {
  return (
    store.getProjectCounts?.(project.id) ?? {
      assets: project.assets.length,
      materials: (project.materials || []).length,
      savedMaterials: (project.materials || []).filter(
        (item) => item.status === "local",
      ).length,
      episodes:
        (project.episodeArchive || []).length + (project.currentEpisode ? 1 : 0),
      messages: project.messages.length,
    }
  );
}

export function messagePage(store, project, { limit = 50, before } = {}) {
  const episodeStart = project.currentEpisode?.startMessageIndex || 0;
  const episodeId = project.currentEpisode?.id ?? null;
  if (store.listMessages)
    return store.listMessages(project.id, {
      limit,
      before,
      startIndex: episodeStart,
      episodeId,
    });
  const end = Math.max(
    episodeStart,
    Math.min(before ?? project.messages.length, project.messages.length),
  );
  const startIndex = Math.max(episodeStart, end - limit);
  return {
    items: project.messages.slice(startIndex, end),
    total: Math.max(0, project.messages.length - episodeStart),
    nextBefore: startIndex > episodeStart ? startIndex : null,
    startIndex,
    episodeId,
  };
}

export function publicProject(project, state, chat) {
  return {
    ...project,
    chatPending: chat.getPending(project.id),
    backgroundTask: projectTask(project),
    workflowIssues: workflowReadiness(project, state),
  };
}

function projectSummary(project, store, chat) {
  const episode = project.currentEpisode;
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    genre: project.genre,
    style: project.style,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    members: project.members,
    running: project.running,
    approval: project.approval,
    chatPending: chat.getPending(project.id),
    backgroundTask: projectTask(project),
    ...(episode
      ? {
          currentEpisode: {
            id: episode.id,
            number: episode.number,
            title: episode.title,
            createdAt: episode.createdAt,
          },
        }
      : {}),
    counts: projectCounts(store, project),
  };
}

export function workspaceSnapshot(
  store,
  chat,
  { projectId, compact = false, history = "recent" } = {},
) {
  const state = store.getState();
  if (!compact && projectId === undefined)
    return {
      ...state,
      projects: state.projects.map((project) => publicProject(project, state, chat)),
      providers: state.providers.map(publicProvider),
    };
  const selected =
    projectId === undefined
      ? state.projects[0]
      : state.projects.find((project) => project.id === projectId);
  const projects = [];
  if (selected) {
    const project = {
      ...publicProject(selected, state, chat),
      counts: projectCounts(store, selected),
      snapshot: { history: compact ? history : "full" },
    };
    if (compact && history !== "full") {
      const { items, ...page } = messagePage(store, selected);
      project.messages = items;
      project.messagePage = page;
      project.episodeArchive = [];
    }
    if (compact) project.materials = [];
    projects.push(project);
  }
  return {
    ...state,
    projects,
    projectSummaries: state.projects.map((project) =>
      projectSummary(project, store, chat),
    ),
    providers: state.providers.map(publicProvider),
  };
}
