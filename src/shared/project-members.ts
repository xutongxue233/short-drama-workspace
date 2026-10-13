import type { Agent, Project } from "../types";

export interface RosterMember {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent";
  agent?: Agent;
}

export function memberById(id: string, agents: Agent[]): RosterMember | undefined {
  if (id === "user") {
    return { id, name: "我", role: "项目负责人", kind: "human" };
  }
  const agent = agents.find((entry) => entry.id === id);
  if (!agent) return undefined;
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role === "主控 Agent" ? "制作统筹" : agent.role,
    kind: "agent",
    agent,
  };
}

export function projectMembers(
  project: Pick<Project, "members">,
  agents: Agent[],
): RosterMember[] {
  return [...new Set(["user", ...project.members])].flatMap((id) => {
    const member = memberById(id, agents);
    return member ? [member] : [];
  });
}
