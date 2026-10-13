import type { Action, AssetSelection, Tab } from "../../shared/contracts";
import type { Agent, Project, PublicUser, Skill, WorkflowNode } from "../../types";
import { projectPermissions } from "../../shared/project-members";
import { Alert, Badge } from "../../ui";
import { AssetGallery } from "../assets";
import { MemoryPanel } from "../memory";
import { MaterialLibrary } from "../materials";
import { ProjectHeader } from "../projects";
import { ProjectInspector, WorkflowPanel } from "../workflow";
import { ChatPanel } from "./components/ChatPanel";

export function ProjectWorkspace({
  project,
  agents,
  skills = [],
  tab,
  onTabChange,
  inspectorOpen,
  onToggleInspector,
  busy,
  onAction,
  onSource,
  onInvite,
  onAsset,
  onNode,
  onActivity,
  onEpisodes,
  currentUser,
}: {
  project: Project;
  agents: Agent[];
  skills?: Skill[];
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  busy: boolean;
  onAction: Action;
  onSource: () => void;
  onInvite: () => void;
  onAsset: (asset: AssetSelection) => void;
  onNode: (node: WorkflowNode) => void;
  onActivity: (agentId?: string, nodeId?: string) => void;
  onEpisodes: () => void;
  currentUser?: PublicUser;
}) {
  const path = `/projects/${project.id}`;
  const { canEdit, canChat } = projectPermissions(project);
  return (
    <>
      <ProjectHeader
        currentUserId={currentUser?.id}
        project={project}
        agents={agents}
        tab={tab}
        onTabChange={onTabChange}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
        onInvite={onInvite}
        onEpisodes={onEpisodes}
      />
      {!canEdit && (
        <Alert tone="info">
          {canChat
            ? "你可以参与群聊和查看成果；制作由项目所有者或编辑者负责。"
            : "你拥有只读权限，可以查看群聊和项目成果。"}
        </Alert>
      )}
      {project.backgroundTask === "image-test" && (
        <Alert tone="info">图片测试进行中，完成后可继续创作与编辑。</Alert>
      )}
      <div className="project-body">
        <div
          key={`${project.id}-${tab}`}
          className="project-content"
          role="tabpanel"
          id={`project-panel-${tab}`}
          aria-labelledby={`project-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "chat" ? (
            <ChatPanel
              currentUserId={currentUser?.id}
              key={`${project.id}-${project.currentEpisode?.id ?? "current"}`}
              project={project}
              agents={agents}
              skills={skills}
              busy={busy}
              onAction={onAction}
              onSource={onSource}
              onAssets={() => onTabChange("assets")}
              onNode={onNode}
            />
          ) : tab === "workflow" ? (
            <WorkflowPanel
              project={project}
              agents={agents}
              onNode={onNode}
              onRun={() => void onAction(`${path}/run`)}
              onChat={() => onTabChange("chat")}
              onSource={onSource}
              busy={busy || !canEdit}
              onActivity={onActivity}
              onEpisodes={onEpisodes}
            />
          ) : tab === "assets" ? (
            <div className="tab-content">
              <div className="section-heading">
                <div>
                  <h2>项目资产</h2>
                </div>
                <Badge>{project.assets.length} 份资产</Badge>
              </div>
              <AssetGallery
                key={project.id}
                entries={project.assets.map((asset) => ({
                  asset,
                  projectId: project.id,
                }))}
                onOpen={onAsset}
              />
            </div>
          ) : tab === "materials" ? (
            <MaterialLibrary
              key={project.id}
              projects={[project]}
              projectId={project.id}
              remote={Boolean(project.snapshot)}
              busy={busy || !canEdit}
              onAction={onAction}
            />
          ) : (
            <MemoryPanel
              key={project.id}
              project={project}
              busy={busy || !canEdit}
              onAction={onAction}
            />
          )}
        </div>
        {inspectorOpen && (
          <ProjectInspector
            currentUserId={currentUser?.id}
            project={project}
            agents={agents}
            onTabChange={onTabChange}
            onNode={onNode}
            onInvite={onInvite}
            onActivity={onActivity}
            onEpisodes={onEpisodes}
          />
        )}
      </div>
    </>
  );
}
