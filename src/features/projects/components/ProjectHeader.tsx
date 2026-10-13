import {
  ArrowDownToLine,
  Library,
  BrainCircuit,
  Clapperboard,
  GitBranch,
  Layers3,
  Images,
  MessageCircle,
  PanelRightClose,
  UsersRound,
} from "lucide-react";
import { MemberAvatar } from "../../../components/MemberIdentity";
import type { Tab } from "../../../shared/contracts";
import { projectMembers } from "../../../shared/project-members";
import type { Agent, Project } from "../../../types";
import { Badge, IconButton } from "../../../ui";

export function ProjectHeader({
  project,
  agents,
  tab,
  onTabChange,
  inspectorOpen,
  onToggleInspector,
  onInvite,
  onEpisodes,
}: {
  project: Project;
  agents: Agent[];
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onInvite: () => void;
  onEpisodes: () => void;
}) {
  const path = `/projects/${project.id}`;
  const members = projectMembers(project, agents);
  return (
    <section className="project-header">
      <div className="project-title-row">
        <span className="project-title-icon">
          <Clapperboard size={23} />
        </span>
        <div className="project-title">
          <div>
            <h1 title={project.name}>{project.name}</h1>
            <Badge
              tone={
                project.running ? "accent" : project.approval ? "warning" : "neutral"
              }
            >
              {project.running ? "制作中" : project.approval ? "待确认" : "创作项目"}
            </Badge>
          </div>
          <p title={project.description || "根据本集原文，创作当前一集短剧"}>
            {project.genre}
            <span className="meta-separator">·</span>
            当前第 {project.currentEpisode?.number ?? 1} 集
            <span className="meta-separator">·</span>
            本集 {project.chapters.length} 份原文
          </p>
        </div>
        <div className="project-header-actions">
          <button
            className="project-members-button"
            onClick={onInvite}
            aria-label={`查看群成员，${members.length} 人`}
            title={members.map((member) => member.name).join("、")}
          >
            <span className="project-member-faces" aria-hidden="true">
              {members.slice(0, 2).map((member) => (
                <MemberAvatar key={member.id} member={member} size="small" />
              ))}
            </span>
            <UsersRound className="project-members-icon" size={15} />
            <span>群成员</span>
            <strong>{members.length}</strong>
          </button>
          <IconButton label="剧集档案" onClick={onEpisodes}>
            <Library size={17} />
          </IconButton>
          <a
            className="ui-button ui-button-secondary ui-control-md export-button"
            href={`/api${path}/export`}
            download
          >
            <span className="ui-button-content">
              <ArrowDownToLine size={15} />
              导出项目
            </span>
          </a>
        </div>
      </div>
      <div className="project-tabs">
        <div
          role="tablist"
          aria-label="项目内容"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            );
            const current = tabs.findIndex((item) => item === document.activeElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                    tabs.length;
            tabs[next]?.focus();
            tabs[next]?.click();
          }}
        >
          {(
            [
              { id: "chat", label: "创作群聊", icon: MessageCircle },
              { id: "workflow", label: "制作流程", icon: GitBranch },
              { id: "assets", label: "项目资产", icon: Layers3 },
              { id: "materials", label: "项目素材", icon: Images },
              { id: "memory", label: "项目记忆", icon: BrainCircuit },
            ] as const
          ).map((t) => (
            <button
              role="tab"
              id={`project-tab-${t.id}`}
              aria-controls={`project-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              key={t.id}
              onClick={() => onTabChange(t.id)}
            >
              <t.icon size={16} />
              {t.label}
              {t.id === "assets" && <span>{project.assets.length}</span>}
            </button>
          ))}
        </div>
        <div className="project-tab-tools">
          <IconButton
            className="inspector-toggle"
            label="切换制作概览"
            aria-expanded={inspectorOpen}
            aria-controls="project-inspector"
            onClick={() => onToggleInspector()}
          >
            <PanelRightClose size={17} />
          </IconButton>
        </div>
      </div>
    </section>
  );
}
