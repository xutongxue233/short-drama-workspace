import { addMessage } from "./memory.mjs";
import { episodeMessages } from "./episode-scope.mjs";

export function workflowEvent(project, node, kind, extra = {}) {
  const prior = episodeMessages(project).findLast(
    (message) =>
      message.nodeId === node?.id &&
      message.event?.scope === "workflow" &&
      message.event.runId,
  );
  return {
    kind,
    scope: "workflow",
    ...(prior ? { runId: prior.event.runId } : {}),
    ...extra,
  };
}

/** Record a handoff only once the receiving node actually starts work. */
export function recordNodeStart(project, node, runId, usesModel = true) {
  const history = episodeMessages(project);
  const lastStart = history.findLast(
    (message) =>
      (message.event?.scope === "workflow" && message.event.kind === "start") ||
      (!message.event &&
        message.nodeId &&
        message.type === "system" &&
        /^开始「/.test(message.content)),
  );
  const previous = project.nodes[project.nodes.indexOf(node) - 1];
  if (previous?.status === "completed" && lastStart?.nodeId !== node.id) {
    addMessage(
      project,
      "producer",
      `「${previous.name}」已完成交接，「${node.name}」负责人已接手本集任务。`,
      "system",
      node.id,
      workflowEvent(project, node, "handoff", {
        runId,
        fromAgentId: previous.agentId,
        toAgentId: node.agentId,
        fromNodeId: previous.id,
        toNodeId: node.id,
      }),
    );
  }
  return addMessage(
    project,
    node.agentId,
    usesModel
      ? `开始「${node.name}」。正在调用已配置的模型接口。已带入本项目原文、确认决策与锁定资产。`
      : `开始「${node.name}」。正在复核本集已有检查点和锁定角色资料，本次未提交新的模型请求。`,
    "system",
    node.id,
    workflowEvent(project, node, "start", { runId }),
  );
}

export function approvalEvent(project, node, kind, approval) {
  return workflowEvent(project, node, kind, {
    approvalId: approval.id,
    ...(approval.phase ? { phase: approval.phase } : {}),
  });
}
