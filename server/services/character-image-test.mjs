import { ProviderError } from "../providers/errors.mjs";
import { textInput } from "../http/validation.mjs";
import { activeReference } from "../workflow/memory.mjs";
import { buildCharacterImagePrompt } from "../workflow/visual-prompts.mjs";

/** A test may reuse one approved project portrait without replacing its asset. */
export function characterImageTestInput(project, provider, input) {
  if (Object.hasOwn(input, "references") || Object.hasOwn(input, "referenceAssets"))
    throw new ProviderError(
      "角色参考测试只接受项目内的 characterAssetId，不接受自定义参考地址。",
      400,
    );
  if (input.characterAssetId === undefined) {
    return {
      prompt:
        input.prompt === undefined
          ? "二次元动画风格的旧宅木门场景设定图，冷灰紫色调，柔和月光，整洁构图，无人物、无文字、无血腥。用于短剧工作台图片接口验证。"
          : textInput(input.prompt, "测试提示词", { max: 6000, required: true }),
      references: [],
    };
  }
  if (Object.hasOwn(input, "prompt"))
    throw new ProviderError(
      "选择已批准角色后，测试提示词由项目设定构建，不能同时传入自由提示词。",
      400,
    );
  const id = textInput(input.characterAssetId, "角色资产", {
    max: 100,
    required: true,
  });
  const character = project.assets?.find((asset) => asset.id === id);
  if (
    !character ||
    character.type !== "character" ||
    !Array.isArray(character.tags) ||
    !activeReference(character)
  )
    throw new ProviderError(
      "请选择此项目有效锁定的角色资产，历史版本或待更新角色不能用于参考测试。",
      400,
    );
  if (
    character.characterDesign?.version !== 1 ||
    character.characterDesign.subjectType !== "person" ||
    !character.characterDesign.baseAppearance?.trim()
  )
    throw new ProviderError(
      "角色参考测试需要已批准的人物基础设定；道具或未整理的旧设定不能作为人物参考。",
      400,
    );
  if (typeof character.url !== "string" || !character.url.trim())
    throw new ProviderError("此角色没有可用的参考图，请先保存角色基础图片。", 400);
  const references = [
    {
      id: character.id,
      name: character.name,
      type: "character",
      version: character.version,
      locked: true,
      url: character.url,
      ...(character.materialId ? { materialId: character.materialId } : {}),
      content: character.characterDesign.baseAppearance,
    },
  ];
  return {
    character,
    references,
    prompt: buildCharacterImagePrompt(project, character, {
      references,
      compact: provider.protocol === "minimax",
    }),
  };
}
