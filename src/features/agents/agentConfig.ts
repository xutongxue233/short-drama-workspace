import type { Agent } from "../../types";

const builtInIds = new Set([
  "producer",
  "writer",
  "compliance",
  "character",
  "director",
  "video",
  "editor",
]);

export const isBuiltInAgent = (agent: Agent) => builtInIds.has(agent.id);

export function agentCopyName(agent: Agent, agents: Agent[]) {
  const names = new Set(agents.map((item) => item.name.trim().toLowerCase()));
  let number = 1;
  while (true) {
    const suffix = number === 1 ? "（副本）" : `（副本 ${number}）`;
    const name = `${agent.name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!names.has(name.toLowerCase())) return name;
    number += 1;
  }
}

export const agentColors = [
  { value: "#7160cf", label: "紫色" },
  { value: "#3b82f6", label: "蓝色" },
  { value: "#0891b2", label: "青色" },
  { value: "#059669", label: "绿色" },
  { value: "#d97706", label: "琥珀色" },
  { value: "#dc5d73", label: "玫瑰色" },
];

export const emptyAgent: Agent = {
  id: "",
  name: "",
  role: "",
  description: "",
  systemPrompt: "",
  providerId: "",
  model: "",
  enabled: true,
  color: agentColors[0].value,
};
