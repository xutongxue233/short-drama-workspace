import { Clapperboard, Plus } from "lucide-react";
import { useState } from "react";
import {
  AccountDialog,
  AuthBoundary,
  type AuthenticatedWorkspaceProps,
} from "../features/auth";
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
import { projectPermissions } from "../shared/project-members";
import type { Project, WorkflowNode } from "../types";
import { Button, Dialog, DialogBody } from "../ui";
import { HelpDialog } from "./components/HelpDialog";
import { LoadingScreen } from "./components/LoadingScreen";
import { Toast } from "./components/Toast";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import { useWorkspaceState } from "./useWorkspaceState";

/** Composes application navigation and feature entry points. Feature state stays local. */
export default function App() {
  return (
    <AuthBoundary>
      {(auth) => <WorkspaceApp key={auth.user.id} {...auth} />}
    </AuthBoundary>
  );
}

export function WorkspaceApp({
  user,
  onLogout,
  onSessionChange,
}: AuthenticatedWorkspaceProps) {
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<View>("workspace");
  const [tab, setTab] = useState<Tab>("chat");
  const [newProject, setNewProject] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [asset, setAsset] = useState<AssetSelection | null>(null);
  const [node, setNode] = useState<WorkflowNode | null>(null);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [activity, setActivity] = useState<{
    agentId?: string;
    nodeId?: string;
    episodeId?: string;
  } | null>(null);
  const { state, error, busy, toast, refresh, mutate, action, notify, dismissToast } =
    useWorkspaceState({ projectId, fullHistory: episodesOpen || activity !== null });
  const navigationProjects = state?.projectSummaries ?? state?.projects ?? [];
  const currentUser = state?.currentUser ?? user;
  const project = projectId
    ? state?.projects.find((item) => item.id === projectId)
    : state?.projects[0];
  const navigationProject = navigationProjects.find(
    (item) => item.id === (projectId || project?.id),
  );
  const path = project ? `/projects/${project.id}` : "";
  const projectBusy = busy || Boolean(project?.backgroundTask);
  const canEdit = project ? projectPermissions(project).canEdit : false;
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
    ? navigationProjects.find((item) => item.id === asset.projectId)
    : undefined;
  const activeAsset = asset
    ? state?.projects
        .find((item) => item.id === asset.projectId)
        ?.assets.find((item) => item.id === asset.asset.id) || asset.asset
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
        projects={navigationProjects}
        project={navigationProject}
        view={view}
        isAdmin={currentUser.role === "admin"}
        onNavigate={setView}
        onHelp={() => setHelpOpen(true)}
        onNewProject={() => setNewProject(true)}
        onChooseProject={chooseProject}
      />
      <main className="main-shell">
        <Topbar
          projects={navigationProjects}
          project={navigationProject}
          view={view}
          user={currentUser}
          onAccount={() => setAccountOpen(true)}
          onNewProject={() => setNewProject(true)}
          onChooseProject={chooseProject}
        />
        {error && (
          <div className="connection-error" role="alert">
            连接暂时中断：{error}
            <button onClick={() => void refresh()}>重试</button>
          </div>
        )}
        {view === "agents" && currentUser.role === "admin" ? (
          <div key="agents" className="management-scroll">
            <AgentCenter state={state} mutate={mutate} notify={notify} />
          </div>
        ) : view === "models" && currentUser.role === "admin" ? (
          <div key="models" className="management-scroll">
            <ModelCenter state={state} mutate={mutate} notify={notify} />
          </div>
        ) : view === "assets" ? (
          <AssetLibrary
            key="assets"
            projects={navigationProjects}
            initialProjectId={navigationProject?.id}
            remote={Boolean(state.projectSummaries)}
            onOpen={setAsset}
          />
        ) : view === "materials" ? (
          <MaterialLibrary
            key="materials"
            projects={navigationProjects}
            initialProjectId={navigationProject?.id}
            remote={Boolean(state.projectSummaries)}
            busy={busy}
            onAction={action}
          />
        ) : project ? (
          <ProjectWorkspace
            project={project}
            currentUser={currentUser}
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
        ) : navigationProject ? (
          <div className="empty-state" role="status">
            <p>正在加载项目…</p>
            {error && <Button onClick={() => void refresh()}>重试</Button>}
          </div>
        ) : projectId && navigationProjects.length ? (
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
      {sourceOpen && project && canEdit && (
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
          currentUser={currentUser}
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
            !projectPermissions(assetProject).canEdit ||
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
      {episodesOpen && project && project.snapshot?.history !== "recent" && (
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
      {activity && activityProject && project?.snapshot?.history !== "recent" && (
        <AgentActivityDialog
          key={`${activityProject.id}-${activity.episodeId ?? "current"}-${activity.agentId ?? "all"}-${activity.nodeId ?? "all"}`}
          project={activityProject}
          agents={state.agents}
          initialAgentId={activity.agentId}
          initialNodeId={activity.nodeId}
          onClose={() => setActivity(null)}
        />
      )}
      {(episodesOpen || activity) && project?.snapshot?.history === "recent" && (
        <Dialog
          title="读取项目记录"
          onClose={() => {
            setEpisodesOpen(false);
            setActivity(null);
          }}
        >
          <DialogBody>
            {error ? (
              <>
                <p role="alert">{error}</p>
                <Button onClick={() => void refresh()}>重试</Button>
              </>
            ) : (
              <p role="status">正在加载记录…</p>
            )}
          </DialogBody>
        </Dialog>
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {accountOpen && (
        <AccountDialog
          user={currentUser}
          onClose={() => setAccountOpen(false)}
          onLogout={onLogout}
          onSessionChange={onSessionChange}
        />
      )}
    </div>
  );
}
