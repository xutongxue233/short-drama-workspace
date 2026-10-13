import {
  Bot,
  CircleHelp,
  Clapperboard,
  Film,
  Layers3,
  Images,
  MessageCircle,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import type { View } from "../../shared/contracts";
import type { ProjectSummary } from "../../types";
import { IconButton } from "../../ui";

export function Sidebar({
  projects,
  project,
  view,
  onNavigate,
  onHelp,
  onNewProject,
  onChooseProject,
}: {
  projects: ProjectSummary[];
  project?: ProjectSummary;
  view: View;
  onNavigate: (view: View) => void;
  onHelp: () => void;
  onNewProject: () => void;
  onChooseProject: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  return (
    <aside className="sidebar">
      <a
        className="brand"
        href="#"
        aria-label="映序 Studio · 返回项目群聊"
        title="返回项目群聊"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("workspace");
        }}
      >
        <span className="brand-mark">
          <Clapperboard size={24} />
        </span>
        <div>
          <strong>
            映序<span> STUDIO</span>
          </strong>
        </div>
      </a>
      <nav className="main-nav" aria-label="主导航">
        <button
          title="项目群聊"
          aria-label="项目群聊"
          aria-current={view === "workspace" ? "page" : undefined}
          className={view === "workspace" ? "active" : ""}
          onClick={() => onNavigate("workspace")}
        >
          <MessageCircle size={18} />
          <span className="nav-text">项目群聊</span>
        </button>
        <button
          title="资产库"
          aria-label="资产库"
          aria-current={view === "assets" ? "page" : undefined}
          className={view === "assets" ? "active" : ""}
          onClick={() => onNavigate("assets")}
        >
          <Layers3 size={18} />
          <span className="nav-text">资产库</span>
        </button>
        <button
          title="素材库"
          aria-label="素材库"
          aria-current={view === "materials" ? "page" : undefined}
          className={view === "materials" ? "active" : ""}
          onClick={() => onNavigate("materials")}
        >
          <Images size={18} />
          <span className="nav-text">素材库</span>
        </button>
        <button
          title="Agent 中心"
          aria-label="Agent 中心"
          aria-current={view === "agents" ? "page" : undefined}
          className={view === "agents" ? "active" : ""}
          onClick={() => onNavigate("agents")}
        >
          <Bot size={18} />
          <span className="nav-text">Agent 中心</span>
        </button>
        <button
          title="模型接入"
          aria-label="模型接入"
          aria-current={view === "models" ? "page" : undefined}
          className={view === "models" ? "active" : ""}
          onClick={() => onNavigate("models")}
        >
          <Settings2 size={18} />
          <span className="nav-text">模型接入</span>
        </button>
      </nav>
      <div className="project-section-title">
        <span>
          我的项目 <small>{projects.length}</small>
        </span>
        <div>
          <IconButton
            size="sm"
            title="搜索项目"
            label="搜索项目"
            aria-expanded={showSearch}
            onClick={() => {
              setShowSearch(!showSearch);
              if (showSearch) setSearch("");
            }}
          >
            <Search size={15} />
          </IconButton>
        </div>
      </div>
      {showSearch && (
        <input
          className="project-search"
          aria-label="搜索项目名称"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索项目名称…"
        />
      )}
      <div className="project-list">
        {projects
          .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
          .map((p, i) => (
            <button
              key={p.id}
              className={`project-item ${view === "workspace" && p.id === project?.id ? "selected" : ""}`}
              title={p.name}
              aria-current={
                view === "workspace" && p.id === project?.id ? "page" : undefined
              }
              onClick={() => onChooseProject(p.id)}
            >
              <span className={`project-cover cover-${i % 4}`}>
                <Film size={18} />
              </span>
              <span className="project-item-info">
                <strong title={p.name}>{p.name}</strong>
                <small>
                  <i
                    className={`status-dot ${p.running ? "running" : p.approval ? "waiting" : ""}`}
                  />
                  {p.running
                    ? "制作进行中"
                    : p.approval
                      ? "等待你的确认"
                      : `${p.genre} · ${p.style}`}
                </small>
              </span>
              {p.approval && <span className="project-unread">1</span>}
            </button>
          ))}
        {search.trim() &&
          !projects.some((item) =>
            item.name.toLowerCase().includes(search.trim().toLowerCase()),
          ) && (
            <div className="project-empty" role="status">
              没有找到匹配项目
            </div>
          )}
      </div>
      <button
        className="new-project-button"
        aria-label="新建创作项目"
        title="新建创作项目"
        onClick={() => onNewProject()}
      >
        <Plus size={17} />
        <span className="nav-text">新建创作项目</span>
      </button>
      <div className="sidebar-bottom">
        <button
          className="sidebar-help"
          aria-label="使用说明"
          title="使用说明"
          onClick={onHelp}
        >
          <CircleHelp size={18} />
          <span className="nav-text">使用说明</span>
        </button>
      </div>
    </aside>
  );
}
