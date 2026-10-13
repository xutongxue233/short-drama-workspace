import { HttpError } from "../http/errors.mjs";
import { textInput, booleanInput } from "../http/validation.mjs";
import { NODE_DEFINITIONS } from "../seed.mjs";

const BUILTIN_AGENTS = new Set(NODE_DEFINITIONS.map((node) => node[3]));
const TEXT_FIELDS = [
  ["name", 80, true],
  ["role", 80, true],
  ["description", 1000, false],
  ["systemPrompt", 12000, true],
  ["model", 200, false],
  ["providerId", 100, false],
];

/** Validate only supplied fields so older saved agents can still be maintained. */
export function agentInput(input, providers, { creating = false, existing } = {}) {
  const patch = creating
    ? { description: "", color: "#6e56cf", providerId: "", model: "", enabled: true }
    : {};
  for (const [field, max, required] of TEXT_FIELDS) {
    if (Object.hasOwn(input, field) || (creating && required))
      patch[field] = textInput(input[field], field, { max, required });
  }
  if (Object.hasOwn(input, "enabled"))
    patch.enabled = booleanInput(input.enabled, "启用状态");
  if (Object.hasOwn(input, "color")) {
    patch.color = textInput(input.color, "头像颜色", { max: 7, required: true });
    if (!/^#[0-9a-f]{6}$/i.test(patch.color))
      throw new HttpError(400, "头像颜色必须是 #RRGGBB 格式的六位十六进制颜色");
  }
  if (
    patch.providerId &&
    !providers.some((provider) => provider.id === patch.providerId)
  )
    throw new HttpError(400, "选择的模型接口不存在");
  // An override belongs to its provider; keep it only when explicitly resupplied.
  if (
    existing &&
    Object.hasOwn(patch, "providerId") &&
    patch.providerId !== existing.providerId &&
    !Object.hasOwn(input, "model")
  )
    patch.model = "";
  return patch;
}

export function assertAgentNameAvailable(name, agents, existing) {
  if (name === undefined || name === existing?.name) return;
  const normalized = name.trim().toLowerCase();
  if (
    agents.some(
      (agent) => agent !== existing && agent.name?.trim().toLowerCase() === normalized,
    )
  )
    throw new HttpError(
      409,
      "Agent 名称已存在，请使用不同名称，以便在项目中准确 @提及。",
    );
}

/** Include nested handoffs, checkpoints and archived episodes, not just members. */
function referencesAgent(value, agentId) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/^(?:agentId|fromAgentId|toAgentId)$/.test(key) && child === agentId)
      return true;
    if (
      ["members", "agentIds"].includes(key) &&
      Array.isArray(child) &&
      child.includes(agentId)
    )
      return true;
    return referencesAgent(child, agentId);
  });
}

export function assertAgentCanDelete(agent, projects) {
  if (BUILTIN_AGENTS.has(agent.id))
    throw new HttpError(
      409,
      "内置 Agent 负责固定制作节点，不能删除；如暂时不用，请停用。",
    );
  const project = projects.find((item) => referencesAgent(item, agent.id));
  if (project)
    throw new HttpError(
      409,
      `Agent 已被项目「${project.name}」的成员、工作流或历史记录引用，不能删除；请停用以保留历史。`,
    );
}
