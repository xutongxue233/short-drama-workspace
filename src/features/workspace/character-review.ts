import type { Asset, CharacterDesign, Project, WorkflowNode } from "../../types";

function sameDesign(left: CharacterDesign | undefined, right: CharacterDesign) {
  return (
    left?.version === right.version &&
    left.subjectType === right.subjectType &&
    left.baseAppearance === right.baseAppearance &&
    left.sceneStates.length === right.sceneStates.length &&
    left.sceneStates.every(
      (state, index) =>
        state.name === right.sceneStates[index].name &&
        state.description === right.sceneStates[index].description,
    )
  );
}

export function characterReview(project: Project, node?: WorkflowNode) {
  const active = project.assets.filter(
    (asset) =>
      asset.type === "character" &&
      !asset.tags.includes("历史版本") &&
      !asset.tags.includes("待更新") &&
      !asset.tags.includes("待重新生成"),
  );
  const checkpoint = node?.characterGeneration;
  const requiresImages =
    checkpoint?.outputKind === "image" ||
    (checkpoint?.outputKind !== "text" &&
      (Boolean(checkpoint?.stage) ||
        active.some(
          (asset) =>
            asset.url?.trim() &&
            (!checkpoint ||
              checkpoint.plan.some((planned) => planned.name === asset.name)),
        )));
  const missingNames: string[] = [];
  let assets: Asset[];
  if (checkpoint) {
    assets = checkpoint.plan.flatMap((planned) => {
      const standard = active.find(
        (asset) =>
          asset.locked &&
          asset.name === planned.name &&
          (!planned.characterDesign ||
            sameDesign(asset.characterDesign, planned.characterDesign)),
      );
      const expectedContent = planned.characterDesign
        ? planned.content
        : (standard?.content ?? planned.content);
      const draft = active.find(
        (asset) =>
          !asset.locked &&
          asset.name === planned.name &&
          asset.content === expectedContent &&
          asset.tags.includes(`generation:${checkpoint.id}`) &&
          (!planned.characterDesign ||
            sameDesign(asset.characterDesign, planned.characterDesign)),
      );
      const asset =
        draft && (!requiresImages || draft.url?.trim())
          ? draft
          : standard && (!requiresImages || standard.url?.trim())
            ? standard
            : (draft ?? standard);
      if (!asset) missingNames.push(planned.name);
      return asset ? [asset] : [];
    });
  } else {
    const replacedIds = new Set(
      active
        .filter((asset) => !asset.locked)
        .flatMap((asset) =>
          asset.tags
            .filter((tag) => tag.startsWith("replaces:"))
            .map((tag) => tag.slice(9)),
        ),
    );
    assets = active.filter((asset) => !replacedIds.has(asset.id));
  }
  return { assets, missingNames, requiresImages };
}

export const characterImageKey = (asset: Asset) =>
  `${asset.id}:${asset.version}:${asset.url || ""}`;
