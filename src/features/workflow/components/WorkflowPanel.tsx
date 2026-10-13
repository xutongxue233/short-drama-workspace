import {
  BookOpen,
  CheckCheck,
  ChevronRight,
  ListChecks,
  MessageCircle,
  Play,
} from "lucide-react";
import { Avatar } from "../../../components/AgentAvatar";
import { statusNames } from "../../../shared/labels";
import { failureSummary } from "../../../shared/workflow-failure";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Badge, Button } from "../../../ui";
import { episodeLabel, episodeTitle, workflowOverview } from "../workflow-overview";

export function WorkflowPanel({
  project,
  agents,
  onNode,
  onRun,
  onChat,
  onSource,
  onActivity,
  onEpisodes,
  busy,
}: {
  project: Project;
  agents: Agent[];
  onNode: (node: WorkflowNode) => void;
  onRun: () => void;
  onChat: () => void;
  onSource: () => void;
  onActivity?: (agentId?: string, nodeId?: string) => void;
  onEpisodes?: () => void;
  busy: boolean;
}) {
  const { finished, completed, current, handoff, state } = workflowOverview(project);
  const failed = project.nodes.some((n) => n.status === "failed");
  const title = episodeTitle(project);
  return (
    <div className="tab-content workflow-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">本集制作</div>
          <h2>{episodeLabel(project)} · 制作流程</h2>
          <p>
            {title ? `${title} · ` : ""}
            总制片协调本集节点，关键决策由你确认。
          </p>
        </div>
        <div className="workflow-heading-actions">
          {onEpisodes && (
            <Button size="sm" onClick={onEpisodes}>
              剧集档案
            </Button>
          )}
          {onActivity && (
            <Button size="sm" onClick={() => onActivity()}>
              <ListChecks size={14} />
              工作记录
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || project.running || finished}
            onClick={
              project.approval ? onChat : !project.chapters.length ? onSource : onRun
            }
          >
            {project.approval ? (
              <MessageCircle size={15} />
            ) : !project.chapters.length ? (
              <BookOpen size={15} />
            ) : finished ? (
              <CheckCheck size={15} />
            ) : (
              <Play size={15} />
            )}
            {project.running
              ? "正在制作"
              : project.approval
                ? "前往群聊确认"
                : !project.chapters.length
                  ? "导入本集原文"
                  : finished
                    ? "流程验收完成"
                    : failed
                      ? "重试失败节点"
                      : "继续制作"}
          </Button>
        </div>
      </div>
      <div className="workflow-current-summary">
        <div>
          <span>本集节点进度</span>
          <strong>
            {completed} / {project.nodes.length} 已完成
          </strong>
        </div>
        <p>
          {finished
            ? "流程验收完成，请在交付清单中核对实际视频与待办。"
            : `${current?.name ?? "等待制作节点"} · ${state}${current ? ` · ${agents.find((agent) => agent.id === current.agentId)?.name ?? "未配置 Agent"}` : ""}`}
        </p>
        {current?.status === "failed" && current.error && (
          <p className="workflow-current-error">{failureSummary(current.error)}</p>
        )}
        {handoff && (
          <small>
            {project.approval ? "确认后" : "完成后"}交给{" "}
            {agents.find((agent) => agent.id === handoff.agentId)?.name ??
              "下一位 Agent"}{" "}
            · {handoff.name}
          </small>
        )}
      </div>
      <div className="workflow-cards">
        {project.nodes.map((n, i) => (
          <div className="workflow-card-entry" key={n.id}>
            <button className={`workflow-card ${n.status}`} onClick={() => onNode(n)}>
              <span className="workflow-card-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="workflow-card-main">
                <div>
                  <h3>{n.name}</h3>
                  <Badge
                    tone={
                      n.status === "waiting"
                        ? "warning"
                        : n.status === "completed"
                          ? "success"
                          : n.status === "failed"
                            ? "danger"
                            : n.status === "running"
                              ? "accent"
                              : "neutral"
                    }
                  >
                    {statusNames[n.status]}
                  </Badge>
                </div>
                <p>{n.description}</p>
                <footer>
                  <Avatar agent={agents.find((a) => a.id === n.agentId)} size="small" />
                  {agents.find((a) => a.id === n.agentId)?.name}
                  <span>
                    {(n.error && failureSummary(n.error)) ||
                      (n.output ? "成果已记录，点击查看" : "完成前置节点后开始")}
                  </span>
                </footer>
              </div>
              <ChevronRight size={18} />
            </button>
            {onActivity && (
              <button
                className="workflow-node-log"
                onClick={() => onActivity(n.agentId, n.id)}
                aria-label={`查看 ${n.name} 的工作记录`}
              >
                <ListChecks size={12} />
                节点记录
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
