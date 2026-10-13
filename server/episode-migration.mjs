import { createEpisode, now } from "./seed.mjs";

export const EPISODE_MIGRATION = "project-episode-archive-v1";

/** Add ownership boundaries only; existing approvals and hashes stay valid. */
export function migrateProjectEpisodes(state) {
  let changed = false;
  for (const project of state.projects) {
    if (!project.currentEpisode) {
      project.currentEpisode = createEpisode(1, project.createdAt || now());
      changed = true;
    }
    if (!Array.isArray(project.episodeArchive)) {
      project.episodeArchive = [];
      changed = true;
    }
  }
  return changed;
}
