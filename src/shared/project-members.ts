import type {
  Agent,
  Message,
  Project,
  ProjectAccess,
  ProjectParticipant,
} from "../types";

export const accessLabels: Record<ProjectAccess, string> = {
  owner: "项目所有者",
  editor: "可编辑",
  member: "可讨论",
  viewer: "只读",
};

export interface RosterMember {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent" | "bot";
  isSelf?: boolean;
  access?: ProjectAccess;
  username?: string;
  agent?: Agent;
}

export function projectPermissions(project: Pick<Project, "currentUserAccess">) {
  // Old saved fixtures have no access field. Authenticated API responses always do.
  const access = project.currentUserAccess ?? "owner";
  return {
    canEdit: access === "owner" || access === "editor",
    canChat: access !== "viewer",
    canManageMembers: access === "owner",
  };
}

export function memberById(
  id: string,
  agents: Agent[],
  participants: ProjectParticipant[] = [],
  currentUserId?: string,
): RosterMember | undefined {
  const participant = participants.find((entry) => entry.userId === id);
  if (participant)
    return {
      id,
      name: participant.displayName,
      role: participant.jobTitle || "",
      kind: participant.kind,
      access: participant.access,
      username: participant.username,
      isSelf: id === currentUserId,
    };
  if (id === "user") {
    return { id, name: "历史用户", role: "", kind: "human" };
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

export function messageMember(
  message: Message,
  project: Pick<Project, "participants">,
  agents: Agent[],
  currentUserId?: string,
): RosterMember | undefined {
  if (message.sender) {
    const participant = project.participants?.find(
      (entry) => entry.userId === message.sender!.id,
    );
    return {
      id: message.sender.id,
      name: participant?.displayName || message.sender.displayName,
      role: participant?.jobTitle || "",
      kind: message.sender.kind,
      isSelf: message.sender.id === currentUserId,
      access: participant?.access,
      username: participant?.username,
    };
  }
  return memberById(message.agentId, agents);
}

export function projectMembers(
  project: Pick<Project, "members" | "participants">,
  agents: Agent[],
  currentUserId?: string,
): RosterMember[] {
  const participants = project.participants ?? [];
  const humans = participants.flatMap((entry, index) =>
    participants.findIndex((item) => item.userId === entry.userId) === index
      ? [memberById(entry.userId, agents, participants, currentUserId)!]
      : [],
  );
  // Legacy "user" is a history placeholder, never an invented project owner.
  const legacy =
    !project.participants && project.members.includes("user")
      ? [memberById("user", agents)!]
      : [];
  const ai = [...new Set(project.members)].flatMap((id) => {
    const member = id !== "user" ? memberById(id, agents) : undefined;
    return member ? [member] : [];
  });
  return [...humans, ...legacy, ...ai];
}
