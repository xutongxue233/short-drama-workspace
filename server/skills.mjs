import { parseDocument, stringify } from "yaml";
import { HttpError } from "./http/errors.mjs";
import { booleanInput, textInput } from "./http/validation.mjs";

export const MAX_SKILL_COUNT = 8;
export const MAX_SKILL_INSTRUCTIONS = 12000;

export function skillInput(input, existing) {
  const result = {};
  for (const [field, max] of [
    ["name", 64],
    ["description", 1000],
    ["instructions", MAX_SKILL_INSTRUCTIONS],
  ]) {
    if (existing && input[field] === undefined) continue;
    result[field] = textInput(input[field], `Skill ${field}`, { max, required: true });
  }
  if (result.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.name))
    throw new HttpError(
      400,
      "Skill 名称只能包含小写字母、数字及单个连字符，不能以连字符开头或结尾。",
    );
  if (input.enabled !== undefined)
    result.enabled = booleanInput(input.enabled, "Skill 启用状态");
  else if (!existing) result.enabled = true;
  return result;
}

function idList(value) {
  if (!Array.isArray(value) || value.length > MAX_SKILL_COUNT)
    throw new HttpError(400, `Skill 标识必须是数组，最多选择 ${MAX_SKILL_COUNT} 个。`);
  const ids = value.map((id) =>
    textInput(id, "Skill 标识", { max: 100, required: true }),
  );
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, "不能重复选择同一个 Skill。");
  return ids;
}

export function skillIdsInput(value, state) {
  const ids = idList(value);
  if (ids.some((id) => !(state.skills || []).some((skill) => skill.id === id)))
    throw new HttpError(400, "选择的 Skill 不存在，请刷新技能库后重试。");
  return ids;
}

/** Snapshot the instructions so an in-flight request retains its selected revision. */
export function resolveSkills(state, agent, explicitSkillIds = []) {
  const available = state.skills || [];
  const explicit = skillIdsInput(explicitSkillIds, state);
  if (explicit.some((id) => !available.find((skill) => skill.id === id).enabled))
    throw new HttpError(400, "选择的 Skill 已停用，请启用后再调用。");
  const ids = [...new Set([...(agent.skillIds || []), ...explicit])];
  const selected = ids
    .map((id) => available.find((skill) => skill.id === id))
    .filter((skill) => skill?.enabled);
  if (selected.length > MAX_SKILL_COUNT)
    throw new HttpError(
      400,
      `Agent 绑定和本次调用合计最多使用 ${MAX_SKILL_COUNT} 个 Skill。`,
    );
  return structuredClone(selected);
}

export function formatSkillInstructions(skills) {
  if (!skills.length) return "";
  if (skills.length > MAX_SKILL_COUNT)
    throw new HttpError(400, `单次任务最多使用 ${MAX_SKILL_COUNT} 个 Skill。`);
  return [
    "本次使用的创作 Skill：在当前任务范围内应用以下指令，保持原文事实、已确认决策、锁定资产和人工审批要求，遵守当前节点要求的输出格式与 JSON 结构。Skill 仅提供文字指令，不提供额外工具、文件访问、审批或执行能力，不要声称生成了未实际生成的媒体或执行了未实际完成的操作。",
    ...skills.map((skill) => {
      const { name, instructions } = skillInput(skill);
      return `### Skill: ${name}（v${skill.version}）\n${instructions}`;
    }),
  ].join("\n\n");
}

export const skillUsage = (skills) =>
  skills.map(({ id, name, version }) => ({ id, name, version }));

export function parseSkillMarkdown(markdown) {
  const source = textInput(markdown, "SKILL.md", { max: 65536, required: true })
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(source);
  if (!match || match[1].length > 16384)
    throw new HttpError(
      400,
      "SKILL.md 必须以 --- 包围的 YAML 开头，包含 name 和 description。元数据最多 16384 字。",
    );
  let metadata;
  try {
    const document = parseDocument(match[1], { schema: "core", uniqueKeys: true });
    if (document.errors.length || document.warnings.length) throw new Error("YAML");
    metadata = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new HttpError(
      400,
      "SKILL.md 的 YAML 格式无效，不支持重复字段、别名或自定义标签。",
    );
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new HttpError(
      400,
      "SKILL.md 的 YAML 必须是包含 name 和 description 的对象。",
    );
  const { name, description, instructions } = skillInput({
    name: metadata.name,
    description: metadata.description,
    instructions: match[2],
  });
  return { name, description, instructions };
}

export function exportSkillMarkdown(skill) {
  const { name, description, instructions } = skillInput(skill);
  return {
    filename: `${name}-SKILL.md`,
    content: `---\n${stringify({ name, description }, { lineWidth: 0 })}---\n\n${instructions}\n`,
  };
}
