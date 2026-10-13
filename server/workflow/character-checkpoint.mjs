import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { now, uid } from "../seed.mjs";
import { HttpError } from "../http/errors.mjs";
import { activeReference } from "./memory.mjs";
import { upsertAsset } from "./assets.mjs";
import { VISUAL_PROMPT_VERSION } from "./visual-prompts.mjs";
import { CHARACTER_PLANNING_VERSION } from "./character-planning.mjs";

function creativeDecision(decision) {
  const match = /^用户反馈（交给([^）]+)）：([\s\S]*)$/.exec(decision);
  if (!match) return true;
  let content = match[2].trim();
  for (const prefix of [`@${match[1]}`, `＠${match[1]}`, match[1]])
    if (content.startsWith(prefix)) {
      content = content.slice(prefix.length).replace(/^[\s，,:：]+/, "");
      break;
    }
  // A bare retry instruction changes orchestration, not the creative specification.
  return !/^(?:请)?(?:开始制作|继续制作|恢复制作|重试节点|重试当前节点|重试|暂停制作)[。.!！\s]*$/.test(
    content,
  );
}

export function characterCheckpointKey(
  project,
  agent,
  provider,
  planner,
  textProvider,
  task,
) {
  const binding = (role, service) => ({
    agentId: role.id,
    prompt: role.systemPrompt,
    providerId: service.id,
    protocol: service.protocol,
    kind: service.kind,
    baseUrl: service.baseUrl,
    model: role.model || service.model,
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        visualPromptVersion: VISUAL_PROMPT_VERSION,
        characterPlanningVersion: CHARACTER_PLANNING_VERSION,
        style: project.style,
        visualStyleGuide: project.visualStyleGuide,
        brief: project.productionBrief,
        chapters: project.chapters,
        facts: project.memory.facts,
        decisions: project.memory.decisions.filter(creativeDecision),
        upstream: project.nodes
          .slice(
            0,
            project.nodes.findIndex((node) => node.id === "characters"),
          )
          .filter((node) => node.status === "completed")
          .map((node) => ({ id: node.id, output: node.output })),
        task,
        image: binding(agent, provider),
        text: binding(planner, textProvider),
        // Unapproved edited drafts are replaced during generation. Their revision
        // is captured in decisions; hashing the draft would invalidate its own pilot.
        standards: project.assets.filter(activeReference),
      }),
    )
    .digest("hex");
}

export function characterPilot(project, checkpoint) {
  const planned = checkpoint?.plan.find(
    (character) => character.name === checkpoint.pilotName,
  );
  if (!planned) return undefined;
  const asset = characterDraft(project, checkpoint, planned);
  return asset?.url && asset.characterDesign?.version === 1 ? asset : undefined;
}

export function characterDraft(project, checkpoint, character) {
  return project.assets.find(
    (asset) =>
      asset.type === "character" &&
      asset.name === character.name &&
      asset.content === character.content &&
      asset.tags.includes(`generation:${checkpoint.id}`) &&
      !asset.tags.includes("待更新") &&
      !asset.tags.includes("待重新生成") &&
      !asset.tags.includes("历史版本") &&
      !asset.locked,
  );
}

export function charactersForApproval(project, checkpoint, outputKind) {
  if (
    checkpoint.stage === "pilot" ||
    !Array.isArray(checkpoint.plan) ||
    !checkpoint.plan.length ||
    new Set(checkpoint.plan.map((character) => character.name)).size !==
      checkpoint.plan.length
  )
    throw new HttpError(409, "当前角色清单尚未完成，请重新生成并审核本轮角色。");
  const selected = checkpoint.plan.map((planned) => {
    const standard = project.assets.find(
      (asset) =>
        asset.type === "character" &&
        asset.name === planned.name &&
        activeReference(asset) &&
        !asset.tags.includes("待重新生成") &&
        (!planned.characterDesign ||
          isDeepStrictEqual(asset.characterDesign, planned.characterDesign)),
    );
    // Older checkpoints kept the model's plan while generation upgraded the
    // existing approved text. Match that exact adopted standard on recovery.
    const character = !planned.characterDesign && standard ? standard : planned;
    const draft = characterDraft(project, checkpoint, character);
    const compatible = (asset) =>
      asset &&
      (!planned.characterDesign ||
        (asset.characterDesign?.version === 1 &&
          isDeepStrictEqual(asset.characterDesign, planned.characterDesign))) &&
      (outputKind !== "image" ||
        (typeof asset.url === "string" && Boolean(asset.url.trim())));
    const asset = compatible(draft)
      ? draft
      : compatible(standard)
        ? standard
        : undefined;
    if (!asset)
      throw new HttpError(
        409,
        `角色「${planned.name}」缺少本轮有效的${outputKind === "image" ? "图片或基础设定" : "基础设定"}，请重新生成缺失角色后再确认。`,
      );
    return asset;
  });
  return selected;
}

export function saveCharacterDraft(project, checkpoint, character, replaced) {
  const tags = ["角色定妆", "待确认", `generation:${checkpoint.id}`];
  if (!replaced)
    return upsertAsset(project, "characters", {
      ...character,
      type: "character",
      tags,
    });
  // An image proposal must not silently mutate or unlock an approved text standard.
  const draft = {
    ...character,
    id: uid("asset"),
    type: "character",
    createdAt: now(),
    version: replaced.version + 1,
    locked: false,
    tags: [...tags, "node:characters", "真实接口", `replaces:${replaced.id}`],
  };
  project.assets.push(draft);
  return draft;
}

export function approveCharacterDrafts(project, selected = project.assets) {
  for (const draft of selected) {
    if (
      draft.type !== "character" ||
      draft.locked ||
      draft.tags.includes("待更新") ||
      draft.tags.includes("历史版本")
    )
      continue;
    const replacedId = draft.tags.find((tag) => tag.startsWith("replaces:"))?.slice(9);
    if (!replacedId) continue;
    const replaced = project.assets.find((asset) => asset.id === replacedId);
    if (
      replaced?.type === "character" &&
      replaced.name === draft.name &&
      activeReference(replaced)
    ) {
      replaced.name = `${replaced.name} · v${replaced.version} 归档`;
      replaced.tags = [...new Set([...replaced.tags, "历史版本"])];
    }
    draft.tags = draft.tags.filter((tag) => !tag.startsWith("replaces:"));
  }
}
