import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCheck,
  Clapperboard,
  FileText,
  Film,
  Users,
} from "lucide-react";
import { Avatar } from "../../../components/AgentAvatar";
import { MemberAvatar, MemberKindBadge } from "../../../components/MemberIdentity";
import { TextContent } from "../../../components/TextContent";
import type { Action } from "../../../shared/contracts";
import { memberById, projectMembers } from "../../../shared/project-members";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Button } from "../../../ui";
import { ApprovalCard } from "./ApprovalCard";
import { WorkflowStatusCard } from "./WorkflowStatusCard";

export function ChatHistory({
  project,
  agents,
  busy,
  onAction,
  onNode,
  onAssets,
  historyRef,
  pendingAgentId,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onNode: (node: WorkflowNode) => void;
  onAssets: () => void;
  historyRef: React.Ref<HTMLDivElement>;
  pendingAgentId?: string | null;
}) {
  const done =
    project.nodes.length > 0 &&
    project.nodes.every((node) => node.status === "completed");
  const mentions = [...agents, { id: "user", name: "你" }];
  return (
    <div className="chat-history" ref={historyRef}>
      <div className="chat-date">
        <span />
        {new Date(
          project.currentEpisode?.createdAt || project.createdAt,
        ).toLocaleDateString("zh-CN", {
          month: "long",
          day: "numeric",
        })}{" "}
        · 第 {project.currentEpisode?.number ?? 1} 集创作记录
        <span />
      </div>
      <div className="project-intro">
        <span className="intro-icon">
          <Clapperboard size={25} />
        </span>
        <div>
          <h2>
            {project.name}
            <span>创作群</span>
          </h2>
          <p>导入本集原文，和团队一起创作当前一集。</p>
          {!!project.episodeArchive?.length && (
            <p>历集原文、产物与对话可在「剧集档案」查看。</p>
          )}
        </div>
        <div className="intro-tags">
          <span>
            <BookOpen size={12} />
            {project.chapters.length} 份本集原文
          </span>
          <span>
            <Film size={12} />
            {project.style || "风格待确认"}
          </span>
          <span>
            <Users size={12} />
            {projectMembers(project, agents).length} 位成员
          </span>
          {project.productionBrief && (
            <span>
              <Clapperboard size={12} />第 {project.currentEpisode?.number ?? 1} 集 ·{" "}
              {project.productionBrief.durationSeconds} 秒 ·{" "}
              {project.productionBrief.aspectRatio}
            </span>
          )}
        </div>
      </div>
      {project.messages
        .slice(project.currentEpisode?.startMessageIndex ?? 0)
        .map((message) => {
          const isUser = message.agentId === "user";
          // Earlier versions saved chat failures as quiet system notices.
          const legacyFailure =
            message.type === "system" &&
            message.agentId === "system" &&
            /^反馈已保存，但「(.+?)」本次回复未完成：/.exec(message.content);
          const isFailure = message.type === "error" || Boolean(legacyFailure);
          const agent = agents.find((a) =>
            legacyFailure ? a.name === legacyFailure[1] : a.id === message.agentId,
          );
          const member = memberById(agent?.id || message.agentId, agents);
          if (message.type === "system" && !isFailure)
            return (
              <div className="system-message" key={message.id}>
                <span />
                <p>{message.content}</p>
                <span />
              </div>
            );
          return (
            <article
              className={`message ${isUser ? "from-user" : ""}`}
              key={message.id}
            >
              {member ? <MemberAvatar member={member} /> : <Avatar agent={agent} />}
              <div className="message-main">
                <header>
                  <strong>{member?.name || "历史成员"}</strong>
                  {member && (
                    <>
                      <MemberKindBadge kind={member.kind} />
                      <span className="message-member-role">{member.role}</span>
                    </>
                  )}
                  <time
                    dateTime={message.createdAt}
                    title={new Date(message.createdAt).toLocaleString("zh-CN")}
                  >
                    {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <div
                  className={`message-bubble ${message.type === "result" ? "result" : ""} ${isFailure ? "reply-error" : ""}`}
                >
                  {isFailure && (
                    <div className="reply-error-title">
                      <AlertCircle size={16} />
                      <strong>
                        {message.nodeId ? "节点执行未完成" : "回复未完成"}
                      </strong>
                    </div>
                  )}
                  <TextContent text={message.content} mentions={mentions} />
                  {legacyFailure && (
                    <p className="reply-error-help">
                      请在模型接入中检查服务状态，并在 Agent
                      中心核对该成员的模型绑定后重新发送。
                    </p>
                  )}
                  {message.type === "result" && message.nodeId && (
                    <button
                      className="message-result-link"
                      onClick={() => {
                        const n = project.nodes.find((n) => n.id === message.nodeId);
                        if (n) onNode(n);
                      }}
                    >
                      <FileText size={14} />
                      查看节点成果
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      {pendingAgentId && (
        <div className="chat-reply-pending" role="status" aria-live="polite">
          <Avatar agent={agents.find((agent) => agent.id === pendingAgentId)} />
          <div>
            <strong>
              {agents.find((agent) => agent.id === pendingAgentId)?.name || "Agent"}
              正在回复…
            </strong>
            <p>正在读取项目上下文并组织回复，请稍候。</p>
          </div>
          <span className="reply-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {project.approval && (
        <ApprovalCard
          key={project.approval.id}
          project={project}
          busy={busy}
          onAction={onAction}
          agents={agents}
          onAssets={onAssets}
        />
      )}
      {!!project.workflowIssues?.length && (
        <details className="workflow-readiness">
          <summary>
            <AlertCircle size={14} />
            {new Set(project.workflowIssues.map((issue) => issue.agentId)).size}{" "}
            位成员的模型配置需要处理
          </summary>
          <ul>
            {project.workflowIssues.map((issue) => (
              <li key={issue.nodeId}>
                <strong>
                  {project.nodes.find((node) => node.id === issue.nodeId)?.name}：
                </strong>
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!project.approval && !pendingAgentId && (
        <WorkflowStatusCard
          project={project}
          agents={agents}
          busy={busy}
          onAction={onAction}
        />
      )}
      {project.running && (
        <div className="typing-message">
          <Avatar
            agent={agents.find(
              (a) =>
                a.id === project.nodes.find((n) => n.status === "running")?.agentId,
            )}
          />
          <div>
            <span />
            <span />
            <span />
          </div>
          <small>
            {agents.find(
              (agent) =>
                agent.id ===
                project.nodes.find((node) => node.status === "running")?.agentId,
            )?.name || "创作团队"}
            正在进行「
            {project.nodes.find((node) => node.status === "running")?.name ||
              "制作节点"}
            」…
          </small>
        </div>
      )}
      {done && (
        <div className="finished-card">
          <CheckCheck size={23} />
          <div>
            <strong>本轮制作流程已完成</strong>
            <p>创作成果已保存，可以查看资产并导出项目。</p>
          </div>
          <Button variant="secondary" onClick={onAssets}>
            查看成果
          </Button>
        </div>
      )}
    </div>
  );
}
