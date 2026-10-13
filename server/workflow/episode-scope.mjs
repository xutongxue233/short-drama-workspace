/** Whole-project history remains persisted; model and review scopes are per episode. */
export function episodeMessages(project) {
  return (project.messages || []).slice(project.currentEpisode?.startMessageIndex || 0);
}

export function episodeDecisions(project) {
  const baseline = [...(project.currentEpisode?.startDecisions || [])];
  return (project.memory?.decisions || []).filter((decision) => {
    const index = baseline.indexOf(decision);
    if (index < 0) return true;
    baseline.splice(index, 1);
    return false;
  });
}

export function episodeAssets(project) {
  const baseline = new Set(project.currentEpisode?.startAssetIds || []);
  return project.assets.filter(
    (asset) =>
      !baseline.has(asset.id) ||
      (["character", "scene"].includes(asset.type) &&
        asset.locked &&
        !asset.tags.includes("历史版本") &&
        !asset.tags.includes("待更新")),
  );
}

export function episodeMaterials(project, assets = episodeAssets(project)) {
  const baseline = new Set(project.currentEpisode?.startMaterialIds || []);
  const references = new Set(assets.map((asset) => asset.materialId).filter(Boolean));
  return (project.materials || []).filter(
    (material) => !baseline.has(material.id) || references.has(material.id),
  );
}
