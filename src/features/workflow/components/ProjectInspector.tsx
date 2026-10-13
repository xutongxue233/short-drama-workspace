import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  ListChecks,
  LoaderCircle,
  Pause,
  Plus,
} from "lucide-react";
import { Avatar } from "../../../components/AgentAvatar";
import { MemberAccessBadge, MemberIdentity } from "../../../components/MemberIdentity";
import type { Tab } from "../../../shared/contracts";
import { statusNames } from "../../../shared/labels";
import { projectMembers, projectPermissions } from "../../../shared/project-members";
import { failureSummary } from "../../../shared/workflow-failure";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Alert, Badge, IconButton } from "../../../ui";
import {
  agentWorkState,
  episodeLabel,
  episodeTitle,
  projectTotals,
  workflowOverview,
} from "../workflow-overview";

export function ProjectInspector({
  project,
  agents,
  onTabChange,
  onNode,
  onInvite,
  onActivity,
  onEpisodes,
  currentUserId,
}: {
  project: Project;
  agents: Agent[];
  onTabChange: (tab: Tab) => void;
  onNode: (node: WorkflowNode) => void;
  onInvite: () => void;
  onActivity?: (agentId?: string, nodeId?: string) => void;
  onEpisodes?: () => void;
  currentUserId?: string;
}) {
  const totals = projectTotals(project);
  const { completed, finished, current, handoff, state } = workflowOverview(project);
  const owner = agents.find((agent) => agent.id === current?.agentId);
  const nextOwner = agents.find((agent) => agent.id === handoff?.agentId);
  const title = episodeTitle(project);
  const members = projectMembers(project, agents, currentUserId);
  const { canEdit } = projectPermissions(project);
  return (
    <aside className="inspector" id="project-inspector" aria-label="项目与本集制作概览">
      <div className="inspector-heading">
        <h3>项目概况</h3>
        {onEpisodes && (
          <button className="text-button" onClick={onEpisodes}>
            剧集档案 <ChevronRight size={12} />
          </button>
        )}
      </div>
      <dl className="project-overview-stats">
        <div>
          <dt>已建剧集</dt>
          <dd>
            {totals.created}
            <small>集</small>
          </dd>
        </div>
        <div>
          <dt>已归档</dt>
          <dd>
            {totals.archived}
            <small>集</small>
          </dd>
        </div>
        <div>
          <dt>锁定角色</dt>
          <dd>
            {totals.characters}
            <small>位</small>
          </dd>
        </div>
        <div>
          <dt>本地素材</dt>
          <dd>
            {totals.savedMaterials}
            <small>份</small>
          </dd>
        </div>
      </dl>
      <section className="episode-overview" aria-label="本集制作">
        <div className="inspector-section-title">
          <h4>{episodeLabel(project)} · 本集制作</h4>
          <button className="text-button" onClick={() => onTabChange("workflow")}>
            流程 <ChevronRight size={12} />
          </button>
        </div>
        {title && <p className="episode-overview-title">{title}</p>}
        <div className={`current-task-card ${current?.status ?? "completed"}`}>
          <div className="current-task-state">
            <span>当前任务</span>
            <Badge
              tone={
                state === "需处理"
                  ? "danger"
                  : state === "待你确认"
                    ? "warning"
                    : state === "创作中"
                      ? "accent"
                      : "neutral"
              }
            >
              {!canEdit && state === "待你确认" ? "待团队确认" : state}
            </Badge>
          </div>
          <strong>
            {current?.name ?? (finished ? "本集流程验收完成" : "尚无制作节点")}
          </strong>
          {current && (
            <p className="current-task-owner">
              <Avatar agent={owner} size="small" />
              <span>{owner?.name ?? "未配置 Agent"}</span>
              {onActivity && (
                <button
                  className="text-button"
                  onClick={() => onActivity(current.agentId, current.id)}
                >
                  工作记录
                </button>
              )}
            </p>
          )}
          {current?.error && current.status === "failed" && (
            <Alert tone="danger">{failureSummary(current.error)}</Alert>
          )}
          {project.approval && (
            <p className="current-task-hint">{project.approval.title}</p>
          )}
          {finished && (
            <p className="current-task-hint">请在交付清单中核对实际视频与待办。</p>
          )}
          {handoff && (
            <p className="current-task-handoff">
              <ArrowRight size={12} />
              <span>
                {project.approval ? "确认后" : "完成后"}交给{" "}
                {nextOwner?.name ?? "下一位 Agent"} · {handoff.name}
              </span>
            </p>
          )}
          {(project.approval || current?.status === "failed") && (
            <button
              className="current-task-action"
              onClick={() =>
                project.approval ? onTabChange("chat") : current && onNode(current)
              }
            >
              {project.approval
                ? canEdit
                  ? "前往群聊确认"
                  : "查看待确认事项"
                : canEdit
                  ? "查看问题与重试"
                  : "查看问题"}
              <ChevronRight size={12} />
            </button>
          )}
        </div>
        <details
          className="episode-node-details"
          key={`${project.id}:${project.currentEpisode?.id ?? "first"}`}
        >
          <summary className="episode-node-progress">
            <span>本集节点</span>
            <strong>
              {completed} / {project.nodes.length} 已完成
            </strong>
            <ChevronRight size={13} />
          </summary>
          <div className="workflow-steps">
            {project.nodes.map((node, i) => (
              <button
                className={`workflow-step ${node.status}`}
                key={node.id}
                onClick={() => onNode(node)}
                aria-label={`${node.name} · ${statusNames[node.status]}，查看节点`}
              >
                <span className="step-marker">
                  {node.status === "completed" ? (
                    <Check size={11} />
                  ) : node.status === "running" ? (
                    <LoaderCircle size={11} className="spin" />
                  ) : node.status === "waiting" ? (
                    <Pause size={10} />
                  ) : node.status === "failed" ? (
                    <CircleAlert size={11} />
                  ) : (
                    i + 1
                  )}
                </span>
                <strong>{node.name}</strong>
                <small>{statusNames[node.status]}</small>
              </button>
            ))}
          </div>
        </details>
      </section>
      <div className="inspector-divider" />
      <div className="inspector-section-title">
        <h4>群成员</h4>
        <span>
          {members.length} 位成员
          <IconButton size="sm" label="查看群成员" onClick={onInvite}>
            <Plus size={15} />
          </IconButton>
        </span>
      </div>
      {onActivity && (
        <button className="agent-records-link" onClick={() => onActivity()}>
          <ListChecks size={13} />
          全部工作记录
          <ChevronRight size={12} />
        </button>
      )}
      <div className="member-list">
        {members.map((member) => {
          const workState = member.agent
            ? agentWorkState(project, member.agent)
            : project.approval && ["owner", "editor"].includes(member.access || "")
              ? "待确认"
              : "";
          const details = (
            <>
              <MemberIdentity member={member} size="small" />
              <MemberAccessBadge member={member} />
              {workState && (
                <span
                  className={`member-status ${["创作中", "回复中"].includes(workState) ? "working" : workState === "需处理" ? "attention" : ""}`}
                >
                  {workState}
                </span>
              )}
              {onActivity && <ChevronRight size={12} />}
            </>
          );
          return onActivity ? (
            <button
              key={member.id}
              className="member"
              onClick={() => onActivity(member.id)}
              aria-label={`查看 ${member.name} 的工作记录${workState ? ` · ${workState}` : ""}`}
            >
              {details}
            </button>
          ) : (
            <div key={member.id} className="member">
              {details}
            </div>
          );
        })}
      </div>
      <button className="memory-mini" onClick={() => onTabChange("memory")}>
        <BrainCircuit size={19} />
        <span>
          <strong>跨集记忆</strong>
          <small>
            {project.memory.facts.length} 条事实 · {project.memory.decisions.length}{" "}
            项决策
          </small>
        </span>
        <ChevronRight size={15} />
      </button>
    </aside>
  );
}
