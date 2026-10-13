import { now, uid } from "../seed.mjs";
import { activeReference } from "./memory.mjs";
import { resolveCharacterIdentity } from "./character-identity.mjs";

export function upsertAsset(project, nodeId, input) {
  const old = project.assets.find(
    (asset) =>
      asset.type === input.type &&
      asset.name === input.name &&
      !asset.tags.includes("历史版本") &&
      (!asset.locked || asset.tags.includes("待更新")),
  );
  if (
    project.assets.some(
      (asset) =>
        asset.type === input.type &&
        asset.name === input.name &&
        activeReference(asset),
    )
  )
    return;
  if (old?.locked)
    project.assets.push({
      ...old,
      id: uid("asset-history"),
      name: `${old.name} · v${old.version} 归档`,
      tags: [...old.tags.filter((tag) => tag !== "待更新"), "历史版本"],
    });
  const value = {
    id: old?.id || uid("asset"),
    createdAt: old?.createdAt || now(),
    version: old ? old.version + 1 : 1,
    locked: false,
    tags: [],
    ...input,
  };
  value.tags = [...new Set([...(input.tags || []), `node:${nodeId}`, "真实接口"])];
  if (old) project.assets.splice(project.assets.indexOf(old), 1, value);
  else project.assets.push(value);
  return value;
}

const SCENE_ONLY_DESIGN =
  /逆光|剪影|尸斑|全黑眼(?:球)?|眼(?:球|白)全黑|眼眶漆黑|双眼漆黑|半脸遮挡|半张脸.{0,5}遮|遮住半.{0,2}脸|脸.{0,3}藏在阴影|逃跑|倒地|惊吓表情/u;

function negatedDesignConstraint(clause, index) {
  const prefix = clause.slice(0, index);
  const negative = [
    ...prefix.matchAll(
      /不(?:要|得|可|能|是)?|禁止|避免|去掉|移除|并非|而非|无(?!法|论)|没有|未/gu,
    ),
  ].at(-1);
  if (!negative) return false;
  // Parse the negative operator, optional modifiers and its governed action as
  // one phrase: “禁止采用” and “不再佩戴” must not turn that action affirmative.
  const remainder = prefix
    .slice(negative.index + negative[0].length)
    .replace(/^(?:(?:再|额外|另外|允许|准许|应当|应该|可以)\s*)*/u, "");
  const action =
    /^(?:使用|采用|添加|佩戴|穿戴|持有|携带|描绘|呈现|出现|展示|表现|设计|搭配|选择|考虑|加入|生成|穿着|穿上|身穿|改穿|改为|保留|画|做|用|穿|持|戴|带|含|设)/u.exec(
      remainder,
    );
  // Bare 不/未 need an action; “不确定蓝色或灰色” is unresolved, not a ban.
  if (!action && /^(?:不|未)$/u.test(negative[0])) return false;
  if (!action && /^(?:确定|明确|知道|清楚|决定|定下)/u.test(remainder)) return false;
  const tail = remainder.slice(action?.[0].length || 0);
  // A later affirmative predicate starts a new scope even without punctuation:
  // “无胡须的男孩穿蓝衣或灰衣” still contains an unresolved clothing choice.
  return !/(?:改为|改穿|保留|采用|选择|穿着|穿上|身穿|佩戴|持有|呈现|出现|有明显|穿|选|则|却)/u.test(
    tail,
  );
}

function designViolation(clauses, pattern) {
  for (const clause of clauses)
    for (const match of clause.matchAll(new RegExp(pattern.source, "gu")))
      if (!negatedDesignConstraint(clause, match.index)) {
        const start = Math.max(0, match.index - 60);
        return clause.slice(start, start + 160).trim();
      }
  return undefined;
}

function parseCharacterDesign(character, name) {
  if (!Object.hasOwn(character, "characterDesign")) return undefined;
  const design = character.characterDesign;
  if (
    !design ||
    design.version !== 1 ||
    !["person", "object"].includes(design.subjectType) ||
    typeof design.baseAppearance !== "string" ||
    !design.baseAppearance.trim() ||
    design.baseAppearance.length > 5000 ||
    !Array.isArray(design.sceneStates) ||
    design.sceneStates.length > 12
  )
    throw new Error(
      `角色「${name}」的基础设计格式不完整。请提供 characterDesign 的 version: 1、subjectType、baseAppearance 和 sceneStates 数组。`,
    );
  const baseAppearance = design.baseAppearance.trim();
  const clauses = baseAppearance.split(
    /[。；;\n，,！？!?]|但是|然而|不过|但|而是|并且|同时|且/u,
  );
  const alternative = designViolation(clauses, /或|待选|二选一|任选/u);
  if (alternative)
    throw new Error(
      `角色「${name}」的基础外观包含备选方案。命中片段：「${alternative}」。请为五官、发型、服装和配色各确定一个具体设计，不使用“或”“待选”“二选一”。`,
    );
  // This catches explicit scene effects before paying for a base reference.
  // Negative restrictions are allowed; visual approval still verifies the image.
  const sceneContaminated = designViolation(clauses, SCENE_ONLY_DESIGN);
  if (sceneContaminated)
    throw new Error(
      `角色「${name}」的基础外观混入了镜头状态。命中片段：「${sceneContaminated}」。请将逆光、剪影、异常妆效或遮挡等移到 sceneStates；baseAppearance 只保留清楚可见的中性基础设计。`,
    );
  const sceneStates = design.sceneStates.map((state) => {
    if (
      !state ||
      typeof state.name !== "string" ||
      !state.name.trim() ||
      state.name.length > 80 ||
      typeof state.description !== "string" ||
      !state.description.trim() ||
      state.description.length > 1500
    )
      throw new Error(
        `角色「${name}」的镜头状态需要明确的 name 和 description；没有特殊状态时请使用空数组。`,
      );
    return { name: state.name.trim(), description: state.description.trim() };
  });
  return { version: 1, subjectType: design.subjectType, baseAppearance, sceneStates };
}

export function parseCharacterPlan(text, project) {
  let parsed;
  try {
    parsed = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error(
      "角色规划模型未返回有效 JSON。请让文本模型按要求输出 characters 数组后重试。",
    );
  }
  const characters = Array.isArray(parsed) ? parsed : parsed?.characters;
  if (!Array.isArray(characters) || !characters.length || characters.length > 12)
    throw new Error("角色规划必须包含 1 至 12 个当前集需要的角色，不必凑满数量。");
  const names = new Set();
  return characters.map((character) => {
    if (
      !character ||
      typeof character.name !== "string" ||
      !character.name.trim() ||
      character.name.length > 80
    )
      throw new Error("角色规划含有空姓名、过长姓名或重复角色，请检查文本模型输出。");
    const identity = resolveCharacterIdentity(character.name, project);
    const { name } = identity;
    if (names.has(name))
      throw new Error(
        `角色规划中「${name}」通过姓名与称谓归一后重复。请将同一人物合并成一张角色卡，服装或状态变化写在卡片中。`,
      );
    names.add(name);
    const description =
      typeof character.description === "string"
        ? character.description.trim().slice(0, 1500)
        : "";
    const characterDesign = parseCharacterDesign(character, name);
    const appearance = characterDesign
      ? characterDesign.baseAppearance
      : typeof character.appearance === "string"
        ? character.appearance.trim().slice(0, 5000)
        : "";
    const evidence =
      typeof character.sourceEvidence === "string"
        ? character.sourceEvidence.trim().slice(0, 1000)
        : "";
    if (!description || !appearance)
      throw new Error(`角色「${name}」缺少身份描述或视觉设计，请检查模型输出。`);
    return {
      name,
      description,
      appearance,
      ...(characterDesign ? { characterDesign } : {}),
      content: [
        `角色：${name}`,
        ...identity.aliases.map((alias) => `已核实称谓：${alias}`),
        `角色来源：${identity.sourceLabel}`,
        ...(identity.provisional
          ? [
              `暂定身份：从「${identity.group}」中建立的单人占位；真实姓名、关系、年龄与外观尚未由原文确认，后续章节可补充，禁止把设计提案写成原著事实。`,
            ]
          : []),
        `统一风格：${project.style}`,
        `身份与关系：${description}`,
        ...(characterDesign
          ? [
              `主体类型：${characterDesign.subjectType === "person" ? "人物" : "独立静物"}`,
              `基础外观（来源未明确的细节属于待确认设计提案）：${appearance}`,
              "镜头状态（不写入基础设定）：",
              ...(characterDesign.sceneStates.length
                ? characterDesign.sceneStates.map(
                    (state) => `- ${state.name}：${state.description}`,
                  )
                : ["无；沿用中性基础形象。"]),
            ]
          : [`视觉设计提案（来源未明确的外貌、服装与细节需人工确认）：${appearance}`]),
        `规划模型提供的依据（需对照来源复核）：${evidence || identity.sourceLabel}`,
      ].join("\n"),
    };
  });
}
