import type { Action, AssetSelection, Tab } from "../../shared/contracts";
import type { Agent, Project, WorkflowNode } from "../../types";
import { Badge } from "../../ui";
import { AssetGallery } from "../assets";
import { MemoryPanel } from "../memory";
import { MaterialLibrary } from "../materials";
import { ProjectHeader } from "../projects";
import { ProjectInspector, WorkflowPanel } from "../workflow";
import { ChatPanel } from "./components/ChatPanel";

export function ProjectWorkspace({
  project,
  agents,
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
}: {
  project: Project;
  agents: Agent[];
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
}) {
  const path = `/projects/${project.id}`;
  return (
    <>
      <ProjectHeader
        project={project}
        agents={agents}
        tab={tab}
        onTabChange={onTabChange}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
        onInvite={onInvite}
        onEpisodes={onEpisodes}
      />
      {project.backgroundTask === "image-test" && (
        <div className="form-info" role="status">
          图片测试进行中，完成后可继续创作与编辑。
        </div>
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
              key={`${project.id}-${project.currentEpisode?.id ?? "current"}`}
              project={project}
              agents={agents}
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
              busy={busy}
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
              busy={busy}
              onAction={onAction}
            />
          ) : (
            <MemoryPanel
              key={project.id}
              project={project}
              busy={busy}
              onAction={onAction}
            />
          )}
        </div>
        {inspectorOpen && (
          <ProjectInspector
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
