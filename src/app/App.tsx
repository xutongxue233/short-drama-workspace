import { Clapperboard, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentCenter } from "../features/agents";
import { AssetDialog, AssetLibrary } from "../features/assets";
import {
  InviteAgentsDialog,
  NewProjectDialog,
  SourceDialog,
} from "../features/projects";
import {
  NodeDialog,
  AgentActivityDialog,
  EpisodeArchiveDialog,
  archivedEpisodeProject,
} from "../features/workflow";
import { ProjectWorkspace } from "../features/workspace";
import { ModelCenter } from "../features/models";
import { MaterialLibrary } from "../features/materials";
import type { AssetSelection, Tab, View } from "../shared/contracts";
import type { Project, WorkflowNode } from "../types";
import { Button } from "../ui";
import { HelpDialog } from "./components/HelpDialog";
import { LoadingScreen } from "./components/LoadingScreen";
import { Toast } from "./components/Toast";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import { useWorkspaceState } from "./useWorkspaceState";

/** Composes application navigation and feature entry points. Feature state stays local. */
export default function App() {
  const { state, error, busy, toast, refresh, mutate, action, notify, dismissToast } =
    useWorkspaceState();
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem("yingxu-project") || "";
    } catch {
      return "";
    }
  });
  const [view, setView] = useState<View>("workspace");
  const [tab, setTab] = useState<Tab>("chat");
  const [newProject, setNewProject] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [asset, setAsset] = useState<AssetSelection | null>(null);
  const [node, setNode] = useState<WorkflowNode | null>(null);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [activity, setActivity] = useState<{
    agentId?: string;
    nodeId?: string;
    episodeId?: string;
  } | null>(null);
  useEffect(() => {
    try {
      if (projectId) localStorage.setItem("yingxu-project", projectId);
    } catch {
      /* The active project is usable without browser storage. */
    }
  }, [projectId]);
  const project = projectId
    ? state?.projects.find((item) => item.id === projectId)
    : state?.projects[0];
  const path = project ? `/projects/${project.id}` : "";
  const projectBusy = busy || Boolean(project?.backgroundTask);
  const chooseProject = (id: string) => {
    setProjectId(id);
    setView("workspace");
    setTab("chat");
    setNode(null);
    setAsset(null);
    setSourceOpen(false);
    setInviteOpen(false);
    setEpisodesOpen(false);
    setActivity(null);
  };
  const activeNode = node
    ? project?.nodes.find((item) => item.id === node.id) || node
    : null;
  const assetProject = asset
    ? state?.projects.find((item) => item.id === asset.projectId)
    : undefined;
  const activeAsset = asset
    ? assetProject?.assets.find((item) => item.id === asset.asset.id) || asset.asset
    : undefined;
  const activityEpisode = project?.episodeArchive?.find(
    (episode) => episode.id === activity?.episodeId,
  );
  const activityProject =
    project && activityEpisode
      ? archivedEpisodeProject(project, activityEpisode)
      : project;
  if (!state) return <LoadingScreen error={error} onRetry={() => void refresh()} />;
  return (
    <div className="app-shell">
      <Sidebar
        projects={state.projects}
        project={project}
        view={view}
        error={error}
        onNavigate={setView}
        onHelp={() => setHelpOpen(true)}
        onNewProject={() => setNewProject(true)}
        onChooseProject={chooseProject}
      />
      <main className="main-shell">
        <Topbar
          projects={state.projects}
          project={project}
          view={view}
          error={error}
          onHelp={() => setHelpOpen(true)}
          onNewProject={() => setNewProject(true)}
          onChooseProject={chooseProject}
        />
        {error && (
          <div className="connection-error" role="alert">
            连接暂时中断：{error}
            <button onClick={() => void refresh()}>重试</button>
          </div>
        )}
        {view === "agents" ? (
          <div key="agents" className="management-scroll">
            <AgentCenter state={state} mutate={mutate} notify={notify} />
          </div>
        ) : view === "models" ? (
          <div key="models" className="management-scroll">
            <ModelCenter state={state} mutate={mutate} notify={notify} />
          </div>
        ) : view === "assets" ? (
          <AssetLibrary key="assets" projects={state.projects} onOpen={setAsset} />
        ) : view === "materials" ? (
          <MaterialLibrary
            key="materials"
            projects={state.projects}
            busy={busy}
            onAction={action}
          />
        ) : project ? (
          <ProjectWorkspace
            project={project}
            agents={state.agents}
            tab={tab}
            onTabChange={setTab}
            inspectorOpen={inspectorOpen}
            onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
            busy={projectBusy}
            onAction={action}
            onSource={() => setSourceOpen(true)}
            onInvite={() => setInviteOpen(true)}
            onAsset={setAsset}
            onNode={setNode}
            onEpisodes={() => setEpisodesOpen(true)}
            onActivity={(agentId, nodeId) => setActivity({ agentId, nodeId })}
          />
        ) : projectId && state.projects.length ? (
          <div className="empty-state">
            <h2>所选项目暂未加载</h2>
            <p>请重新同步工作台，或从项目列表选择要继续的项目。</p>
            <Button onClick={() => void refresh()}>重新同步</Button>
          </div>
        ) : (
          <div className="empty-state">
            <Clapperboard size={35} />
            <h2>开始你的第一部短剧</h2>
            <p>创建项目群聊，导入本集要改编的原文，让团队创作当前一集。</p>
            <Button variant="primary" onClick={() => setNewProject(true)}>
              <Plus size={16} />
              新建项目
            </Button>
          </div>
        )}
      </main>
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
      {newProject && (
        <NewProjectDialog
          onClose={() => setNewProject(false)}
          onCreate={async (data) => {
            const result = (await mutate("/projects", data)) as
              Project | { project: Project };
            const created = "project" in result ? result.project : result;
            setNewProject(false);
            chooseProject(created.id);
            setSourceOpen(true);
            notify("项目已创建，导入本集原文即可开始创作");
          }}
        />
      )}
      {sourceOpen && project && (
        <SourceDialog
          project={project}
          onClose={() => setSourceOpen(false)}
          onImport={async (data) => {
            await mutate(`${path}/chapters`, data);
            setSourceOpen(false);
            notify("章节已导入，创作团队可以开始了");
          }}
        />
      )}
      {inviteOpen && project && (
        <InviteAgentsDialog
          project={project}
          agents={state.agents}
          busy={busy}
          onAction={action}
          onClose={() => setInviteOpen(false)}
          onActivity={(agentId) => setActivity({ agentId })}
        />
      )}
      {asset && activeAsset && (
        <AssetDialog
          key={`${asset.projectId}-${activeAsset.id}-${activeAsset.version}`}
          item={activeAsset}
          readOnly={
            !assetProject ||
            assetProject.running ||
            Boolean(assetProject.backgroundTask) ||
            activeAsset.tags.includes("历史版本")
          }
          onClose={() => setAsset(null)}
          onSave={async (changes) => {
            await mutate(
              `/projects/${asset.projectId}/assets/${asset.asset.id}`,
              changes,
              "PATCH",
            );
            setAsset(null);
            notify("资产设定已保存");
          }}
        />
      )}
      {activeNode && (
        <NodeDialog
          node={activeNode}
          project={project}
          agents={state.agents}
          busy={busy}
          onAction={action}
          onClose={() => setNode(null)}
          onActivity={() => setActivity({ nodeId: activeNode.id })}
        />
      )}
      {episodesOpen && project && (
        <EpisodeArchiveDialog
          project={project}
          onClose={() => setEpisodesOpen(false)}
          onActivity={(episodeId) => setActivity({ episodeId })}
          onWorkflow={() => {
            setEpisodesOpen(false);
            setTab("workflow");
          }}
          onCreate={async (title) => {
            await mutate(`${path}/episodes`, { title });
            setEpisodesOpen(false);
            setActivity(null);
            setNode(null);
            setAsset(null);
            setTab("chat");
            setSourceOpen(true);
            notify("上一集已归档，请导入新一集的原文");
          }}
        />
      )}
      {activity && activityProject && (
        <AgentActivityDialog
          key={`${activityProject.id}-${activity.episodeId ?? "current"}-${activity.agentId ?? "all"}-${activity.nodeId ?? "all"}`}
          project={activityProject}
          agents={state.agents}
          initialAgentId={activity.agentId}
          initialNodeId={activity.nodeId}
          onClose={() => setActivity(null)}
        />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
