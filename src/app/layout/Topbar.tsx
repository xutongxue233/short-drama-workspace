import { ChevronRight, CircleHelp, Plus } from "lucide-react";
import type { View } from "../../shared/contracts";
import type { Project } from "../../types";
import { IconButton, Select } from "../../ui";

export function Topbar({
  projects,
  project,
  view,
  error,
  onHelp,
  onNewProject,
  onChooseProject,
}: {
  projects: Project[];
  project?: Project;
  view: View;
  error: string;
  onHelp: () => void;
  onNewProject: () => void;
  onChooseProject: (id: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>工作空间</span>
        <ChevronRight size={13} />
        <strong>
          {view === "workspace"
            ? project?.name || "项目群聊"
            : view === "assets"
              ? "全部资产"
              : view === "materials"
                ? "全部素材"
                : view === "agents"
                  ? "Agent 中心"
                  : "模型接入"}
        </strong>
      </div>
      <div className="topbar-right">
        <div className="mobile-project-controls">
          <Select
            aria-label="切换项目"
            value={project?.id || ""}
            onChange={(event) => onChooseProject(event.target.value)}
          >
            {!projects.length && <option value="">暂无项目</option>}
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <IconButton
            label="新建项目群聊"
            title="新建项目群聊"
            onClick={() => onNewProject()}
          >
            <Plus size={18} />
          </IconButton>
        </div>
        <span className="local-pill">
          <span className={`status-dot ${error ? "" : "running"}`} />
          {error ? "连接中断" : "本地已连接"}
        </span>
        <IconButton label="帮助" onClick={() => onHelp()}>
          <CircleHelp size={18} />
        </IconButton>
        <span className="top-avatar">我</span>
      </div>
    </header>
  );
}
