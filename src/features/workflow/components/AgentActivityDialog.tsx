import { ChevronDown, ListChecks } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TextContent } from "../../../components/TextContent";
import { MemberKindBadge } from "../../../components/MemberIdentity";
import { statusNames } from "../../../shared/labels";
import { memberById, messageMember } from "../../../shared/project-members";
import type { Agent, Project } from "../../../types";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Select,
} from "../../../ui";
import {
  activityKindNames,
  activityPreview,
  activityTime,
  buildActivityLog,
  filterActivity,
  type ActivityFilter,
  type ActivityKind,
} from "../activity";
import "../styles/activity.css";

const tones = {
  start: "accent",
  progress: "neutral",
  result: "success",
  approval: "warning",
  approved: "success",
  revision: "warning",
  feedback: "accent",
  error: "danger",
  handoff: "accent",
  completed: "success",
  paused: "warning",
  system: "neutral",
  chat: "neutral",
} as const;

export function AgentActivityDialog({
  project,
  agents,
  initialAgentId,
  initialNodeId,
  onClose,
}: {
  project: Project;
  agents: Agent[];
  initialAgentId?: string;
  initialNodeId?: string;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [agentId, setAgentId] = useState(initialAgentId || "all");
  const [nodeId, setNodeId] = useState(initialNodeId || "all");
  const [kind, setKind] = useState<ActivityFilter>("workflow");
  const [newestFirst, setNewestFirst] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState({ key: "", limit: 50 });
  const entries = useMemo(() => buildActivityLog(project, agents), [project, agents]);
  const filterKey = JSON.stringify([agentId, nodeId, kind, newestFirst]);
  const visibleCount = page.key === filterKey ? page.limit : 50;
  const filtered = filterActivity(entries, { agentId, nodeId, kind });
  const ordered = [...filtered].sort((a, b) => {
    const left = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const right = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return newestFirst ? right - left : left - right;
  });
  const knownIds = new Set([
    ...project.members,
    ...(project.participants ?? []).map((entry) => entry.userId),
    ...(initialAgentId ? [initialAgentId] : []),
    ...entries.flatMap((entry) => entry.relatedAgentIds),
  ]);
  knownIds.delete("user");
  knownIds.delete("system");
  const agentName = (id: string) =>
    id === "system"
      ? "系统"
      : memberById(id, agents, project.participants)?.name ||
        entries.find((entry) => entry.sender?.id === id)?.sender?.displayName ||
        "历史成员";
  const selectedNode = project.nodes.find((node) => node.id === nodeId);
  const episodeNumber = project.currentEpisode?.number || 1;
  const reset = () => {
    setAgentId("all");
    setNodeId("all");
    setKind("workflow");
  };

  return (
    <Dialog
      title="成员工作日志"
      description={`第 ${episodeNumber} 集 · ${project.name}。查看执行、确认、返修和任务交接。`}
      onClose={onClose}
      wide
      className="agent-activity-dialog"
    >
      <DialogBody className="agent-activity-body">
        <div className="activity-filters">
          <Field label="成员" htmlFor={`${fieldId}-agent`}>
            <Select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="all">全部成员</option>
              <option value="user">历史用户</option>
              {[...knownIds].map((id) => (
                <option key={id} value={id}>
                  {agentName(id)} ·{" "}
                  {memberById(id, agents, project.participants)?.kind === "agent"
                    ? "Agent"
                    : memberById(id, agents, project.participants)?.kind === "bot"
                      ? "Bot"
                      : "用户"}
                </option>
              ))}
              <option value="system">系统</option>
            </Select>
          </Field>
          <Field label="制作节点" htmlFor={`${fieldId}-node`}>
            <Select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              <option value="all">全部节点</option>
              {project.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="记录类型" htmlFor={`${fieldId}-kind`}>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as ActivityFilter)}
            >
              <option value="workflow">全部流程记录</option>
              <option value="all">全部记录（含对话）</option>
              {(Object.keys(activityKindNames) as ActivityKind[]).map((value) => (
                <option key={value} value={value}>
                  {activityKindNames[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="activity-filter-hint">
          默认显示流程记录；普通对话可在「记录类型」中查看。
        </p>
        {selectedNode && (
          <section className="activity-node-summary" aria-label="节点当前状态">
            <div>
              <strong>{selectedNode.name}</strong>
              <Badge>{statusNames[selectedNode.status]}</Badge>
            </div>
            <p>{selectedNode.description}</p>
            <span>负责：{agentName(selectedNode.agentId)}</span>
            {selectedNode.startedAt && (
              <span>开始：{activityTime(selectedNode.startedAt)}</span>
            )}
            {selectedNode.completedAt && (
              <span>完成：{activityTime(selectedNode.completedAt)}</span>
            )}
          </section>
        )}
        <div className="activity-list-heading">
          <p role="status">
            {filtered.length} 条记录<span>确认、返修与交接关联负责成员</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewestFirst(!newestFirst)}
          >
            {newestFirst ? "最新在前" : "最早在前"}
          </Button>
        </div>
        {ordered.length ? (
          <ol className="activity-timeline" aria-label="工作记录">
            {ordered.slice(0, visibleCount).map((entry) => {
              const node = project.nodes.find((item) => item.id === entry.nodeId);
              const member = entry.sender
                ? messageMember(
                    {
                      id: entry.id,
                      agentId: entry.agentId,
                      sender: entry.sender,
                      content: "",
                      createdAt: "",
                      type: "text",
                    },
                    project,
                    agents,
                  )
                : memberById(entry.agentId, agents, project.participants);
              return (
                <li
                  key={entry.id}
                  className={`activity-entry activity-entry-${entry.kind}`}
                >
                  <span className="activity-entry-dot" aria-hidden="true" />
                  <article>
                    <div className="activity-entry-heading">
                      <Badge tone={tones[entry.kind]}>
                        {activityKindNames[entry.kind]}
                      </Badge>
                      <strong>{agentName(entry.agentId)}</strong>
                      {member && <MemberKindBadge kind={member.kind} />}
                      <time dateTime={entry.createdAt || undefined}>
                        {activityTime(entry.createdAt)}
                      </time>
                    </div>
                    <div className="activity-entry-context">
                      <span>
                        {node?.name || (entry.nodeId ? "历史节点" : "项目协作")}
                      </span>
                      {node && node.agentId !== entry.agentId && (
                        <span>负责：{agentName(node.agentId)}</span>
                      )}
                      {entry.source === "node" && <span>节点留存记录</span>}
                      {entry.scope === "chat" && <span>群聊回复</span>}
                      {entry.phase === "character-pilot" && <span>角色样板确认</span>}
                      {entry.fromAgentId && entry.toAgentId && (
                        <span>
                          {agentName(entry.fromAgentId)} → {agentName(entry.toAgentId)}
                        </span>
                      )}
                      {entry.source === "history" && (
                        <span className="activity-history-label">依据历史记录整理</span>
                      )}
                      {entry.runId && <span>执行批次：{entry.runId.slice(-8)}</span>}
                      {entry.skills?.map((skill) => (
                        <span key={skill.id}>
                          技能：${skill.name} · v{skill.version}
                        </span>
                      ))}
                    </div>
                    <details
                      className="activity-content"
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (open) next.add(entry.id);
                          else next.delete(entry.id);
                          return next;
                        });
                      }}
                    >
                      <summary>
                        <span className="activity-preview">
                          {activityPreview(entry.content)}
                        </span>
                        <span className="activity-expand-label">
                          <span className="activity-expand-open">展开全文</span>
                          <span className="activity-expand-close">收起全文</span>
                          <ChevronDown size={14} />
                        </span>
                      </summary>
                      {expanded.has(entry.id) && (
                        <div className="activity-full-content">
                          <TextContent text={entry.content} mentions={agents} />
                          {entry.sourceMessageIds && (
                            <section
                              className="activity-evidence"
                              aria-label="交接依据"
                            >
                              <strong>已保存的原始记录</strong>
                              {entry.sourceMessageIds.map((id) => {
                                const evidence = entries.find((item) => item.id === id);
                                return evidence ? (
                                  <div key={id}>
                                    <span>
                                      {activityKindNames[evidence.kind]} ·{" "}
                                      {agentName(evidence.agentId)}
                                      {" · "}
                                      {activityTime(evidence.createdAt)}
                                    </span>
                                    <p>{activityPreview(evidence.content, 420)}</p>
                                  </div>
                                ) : null;
                              })}
                            </section>
                          )}
                        </div>
                      )}
                    </details>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="activity-empty">
            <ListChecks size={30} />
            <strong>
              {entries.length ? "没有符合筛选条件的记录" : "本集尚无工作记录"}
            </strong>
            <p>
              {entries.length
                ? "切换成员、节点或记录类型查看其他工作。"
                : "开始制作后，成员的执行进展、结果与确认反馈会保存在这里。"}
            </p>
            {entries.length > 0 && (
              <Button variant="secondary" size="sm" onClick={reset}>
                重置筛选
              </Button>
            )}
          </div>
        )}
        {ordered.length > visibleCount && (
          <div className="activity-load-more">
            <span>
              已显示 {visibleCount} / {ordered.length} 条
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage({ key: filterKey, limit: visibleCount + 50 })}
            >
              加载更多记录
            </Button>
          </div>
        )}
      </DialogBody>
      <DialogFooter className="activity-footer">
        <p>历史交接依据已保存的确认、完成与执行记录；未记录的调用信息不作推断。</p>
        <Button variant="secondary" onClick={onClose}>
          返回工作台
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
