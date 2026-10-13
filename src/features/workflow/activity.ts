import type { Agent, Message, Project } from "../../types";

export const activityKindNames = {
  start: "开始执行",
  progress: "执行进展",
  result: "创作结果",
  approval: "请求确认",
  approved: "已确认",
  revision: "退回修改",
  feedback: "人工反馈",
  error: "错误记录",
  handoff: "任务交接",
  completed: "节点完成",
  paused: "已暂停",
  system: "系统记录",
  chat: "普通对话",
} as const;

export type ActivityKind = keyof typeof activityKindNames;
export type ActivityFilter = ActivityKind | "workflow" | "all";
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  agentId: string;
  relatedAgentIds: string[];
  nodeId?: string;
  relatedNodeIds: string[];
  content: string;
  createdAt?: string;
  source: "message" | "node" | "history";
  sourceMessageIds?: string[];
  phase?: string;
  scope?: "workflow" | "chat";
  runId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  fromNodeId?: string;
  toNodeId?: string;
}

function messageKind(message: Message): ActivityKind {
  if (message.event) {
    const eventKinds: Record<NonNullable<Message["event"]>["kind"], ActivityKind> = {
      start: "start",
      result: "result",
      approval_requested: "approval",
      approved: "approved",
      revision_requested: "revision",
      handoff: "handoff",
      error: "error",
      paused: "paused",
      completed: "completed",
      progress: "progress",
    };
    return eventKinds[message.event.kind];
  }
  if (message.type === "error") return "error";
  if (
    message.type === "system" &&
    /^反馈已保存，但「(.+?)」本次回复未完成：/.test(message.content)
  )
    return "error";
  if (message.type === "approval") return "approval";
  if (message.type === "result") return "result";
  if (message.agentId === "user" && message.nodeId) {
    if (/^已确认「[^」]+」/.test(message.content)) return "approved";
    if (/^采用「[^」]+」角色样板，继续制作其余角色。/.test(message.content))
      return "approved";
    if (/^请返修「[^」]+」：/.test(message.content)) return "revision";
    return "feedback";
  }
  if (message.type === "system") {
    if (message.nodeId && /^开始「/.test(message.content)) return "start";
    if (/^已暂停制作。/.test(message.content)) return "paused";
    return message.nodeId ? "progress" : "system";
  }
  return message.nodeId ? "progress" : "chat";
}

export function buildActivityLog(
  project: Project,
  agents: Pick<Agent, "id" | "name">[] = [],
): ActivityEntry[] {
  const episode = project.currentEpisode;
  const requestedStart = episode?.startMessageIndex ?? 0;
  const start = Number.isFinite(requestedStart)
    ? Math.max(0, Math.floor(requestedStart))
    : 0;
  const entries: ActivityEntry[] = project.messages.slice(start).map((message) => {
    const owner = project.nodes.find((node) => node.id === message.nodeId)?.agentId;
    const legacyFailureName =
      message.type === "system"
        ? /^反馈已保存，但「(.+?)」本次回复未完成：/.exec(message.content)?.[1]
        : undefined;
    const failedAgent = legacyFailureName
      ? agents.find((agent) => agent.name === legacyFailureName)?.id
      : undefined;
    const invitedName = /^总制片邀请了 (.+) 加入项目群$/.exec(message.content)?.[1];
    const invitedAgent = agents.find((agent) => agent.name === invitedName)?.id;
    const relatedNodeIds = [
      ...new Set(
        [message.nodeId, message.event?.fromNodeId, message.event?.toNodeId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    return {
      id: message.id,
      kind: messageKind(message),
      agentId: message.agentId,
      relatedAgentIds: [
        ...new Set([
          message.agentId,
          ...(owner ? [owner] : []),
          ...(failedAgent ? [failedAgent] : []),
          ...(invitedAgent ? [invitedAgent, "producer"] : []),
          ...[message.event?.fromAgentId, message.event?.toAgentId].filter(
            (id): id is string => Boolean(id),
          ),
        ]),
      ],
      nodeId: message.nodeId,
      relatedNodeIds,
      content: message.content,
      createdAt: message.createdAt,
      source: "message",
      phase:
        message.event?.phase ||
        (message.agentId === "user" && /^采用「[^」]+」角色样板，/.test(message.content)
          ? "character-pilot"
          : undefined),
      runId: message.event?.runId,
      scope: message.event?.scope,
      fromAgentId: message.event?.fromAgentId,
      toAgentId: message.event?.toAgentId,
      fromNodeId: message.event?.fromNodeId,
      toNodeId: message.event?.toNodeId,
    };
  });

  // Older projects can retain node output without its original chat message.
  // Show this evidence explicitly, without inventing a result/error timestamp.
  for (const node of project.nodes) {
    const recorded = entries.filter((entry) => entry.nodeId === node.id);
    const append = (kind: ActivityKind, content: string, createdAt?: string) => {
      entries.push({
        id: `node:${node.id}:${kind}`,
        kind,
        agentId: node.agentId,
        relatedAgentIds: [node.agentId],
        nodeId: node.id,
        relatedNodeIds: [node.id],
        content,
        createdAt,
        source: "node",
      });
    };
    if (node.startedAt && !recorded.some((entry) => entry.kind === "start"))
      append("start", `节点记录：开始「${node.name}」。`, node.startedAt);
    if (
      node.output &&
      !recorded.some(
        (entry) => entry.kind === "result" && entry.content === node.output,
      )
    )
      append("result", node.output);
    const error = node.error;
    if (
      error &&
      !recorded.some((entry) => entry.kind === "error" && entry.content.includes(error))
    )
      append("error", error);
    if (
      project.approval?.nodeId === node.id &&
      !recorded.some((entry) => entry.kind === "approval")
    )
      append(
        "approval",
        `${project.approval.title}\n\n${project.approval.description}`,
      );
  }
  return addHistoricalHandoffs(entries, project, agents);
}

// Old releases saved approval and execution separately. A handoff is only
// reconstructed between adjacent nodes using both records; it is never a new
// persisted event, nor evidence that a retried or sample-only node completed.
function addHistoricalHandoffs(
  entries: ActivityEntry[],
  project: Project,
  agents: Pick<Agent, "id" | "name">[],
) {
  const ready = new Map<string, ActivityEntry>();
  const consumed = new Set<string>();
  const explicit = new Set<string>();
  const output: ActivityEntry[] = [];
  const name = (id: string) => agents.find((agent) => agent.id === id)?.name || id;
  for (const entry of entries) {
    if (entry.source !== "message" || entry.scope === "chat") {
      output.push(entry);
      continue;
    }
    if (entry.kind === "handoff" && entry.fromNodeId && entry.toNodeId)
      explicit.add(`${entry.fromNodeId}:${entry.toNodeId}`);
    if (entry.kind === "start" && entry.nodeId) {
      const index = project.nodes.findIndex((node) => node.id === entry.nodeId);
      const previous = project.nodes[index - 1];
      const current = project.nodes[index];
      const evidence = previous ? ready.get(previous.id) : undefined;
      const pair = `${previous?.id}:${entry.nodeId}`;
      if (evidence && !consumed.has(evidence.id)) {
        consumed.add(evidence.id);
        if (!explicit.has(pair))
          output.push({
            id: `history:handoff:${evidence.id}:${entry.id}`,
            kind: "handoff",
            agentId: "system",
            relatedAgentIds: [previous.agentId, current.agentId],
            relatedNodeIds: [previous.id, current.id],
            nodeId: current.id,
            fromAgentId: previous.agentId,
            toAgentId: current.agentId,
            fromNodeId: previous.id,
            toNodeId: current.id,
            content: `「${previous.name}」${evidence.kind === "approved" ? "已确认" : "已完成"}后，${name(current.agentId)}开始「${current.name}」。交接：${name(previous.agentId)} → ${name(current.agentId)}。`,
            createdAt: entry.createdAt,
            source: "history",
            sourceMessageIds: [evidence.id, entry.id],
          });
      }
      explicit.delete(pair);
      ready.delete(entry.nodeId);
    }
    const node = project.nodes.find((item) => item.id === entry.nodeId);
    const automaticLegacyCompletion =
      entry.kind === "result" &&
      node?.id === "compliance" &&
      node.status === "completed" &&
      Boolean(node.completedAt) &&
      node.completedAt === entry.createdAt;
    if (
      entry.nodeId &&
      ((entry.kind === "approved" && entry.phase !== "character-pilot") ||
        entry.kind === "completed" ||
        automaticLegacyCompletion)
    )
      ready.set(entry.nodeId, entry);
    if (
      entry.nodeId &&
      ["revision", "error", "approval", "paused"].includes(entry.kind)
    )
      ready.delete(entry.nodeId);
    if (
      entry.kind === "system" &&
      /^(原文已保存到本项目。|统一视觉标准已更新，)/.test(entry.content)
    )
      ready.clear();
    output.push(entry);
  }
  return output;
}

export function filterActivity(
  entries: ActivityEntry[],
  {
    agentId = "all",
    nodeId = "all",
    kind = "workflow",
  }: { agentId?: string; nodeId?: string; kind?: ActivityFilter },
) {
  const matchesKind = (entry: ActivityEntry) => {
    if (kind === "all") return true;
    const isChat = entry.scope ? entry.scope === "chat" : entry.kind === "chat";
    if (kind === "workflow") return !isChat;
    if (kind === "chat") return isChat;
    return entry.kind === kind;
  };
  return entries.filter(
    (entry) =>
      (agentId === "all" || entry.relatedAgentIds.includes(agentId)) &&
      (nodeId === "all" || entry.relatedNodeIds.includes(nodeId)) &&
      matchesKind(entry),
  );
}

export function activityPreview(content: string, maxLength = 160) {
  const compact = content
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength)}…`
    : compact || "该记录没有正文。";
}

export function activityTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
