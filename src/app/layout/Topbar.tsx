import { ChevronRight, Plus } from "lucide-react";
import type { View } from "../../shared/contracts";
import type { ProjectSummary } from "../../types";
import { IconButton, Select } from "../../ui";

export function Topbar({
  projects,
  project,
  view,
  onNewProject,
  onChooseProject,
}: {
  projects: ProjectSummary[];
  project?: ProjectSummary;
  view: View;
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
            ? "项目群聊"
            : view === "assets"
              ? "资产库"
              : view === "materials"
                ? "素材库"
                : view === "agents"
                  ? "Agent 中心"
                  : "模型接入"}
        </strong>
      </div>
      <div className="topbar-right">
        <div className="mobile-project-controls">
          {view === "workspace" && (
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
          )}
          <IconButton
            label="新建项目群聊"
            title="新建项目群聊"
            onClick={() => onNewProject()}
          >
            <Plus size={18} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
