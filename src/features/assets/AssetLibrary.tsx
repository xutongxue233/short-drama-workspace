import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useProjectItems } from "../../components/hooks/useProjectItems";
import type { AssetSelection } from "../../shared/contracts";
import type { Asset, Project } from "../../types";
import { Alert, Badge, Button, EmptyState, Select } from "../../ui";
import { AssetGallery } from "./components/AssetGallery";

type LibraryProject = Pick<Project, "id" | "name"> & Partial<Pick<Project, "assets">>;

export function AssetLibrary({
  projects,
  initialProjectId,
  remote = false,
  onOpen,
}: {
  projects: LibraryProject[];
  initialProjectId?: string;
  remote?: boolean;
  onOpen: (asset: AssetSelection) => void;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const project =
    projects.find((item) => item.id === selectedProjectId) ??
    projects.find((item) => item.id === initialProjectId) ??
    projects[0];
  return project ? (
    <ProjectAssets
      key={project.id}
      project={project}
      projects={projects}
      onSelect={setSelectedProjectId}
      onOpen={onOpen}
      remote={remote}
    />
  ) : (
    <div className="management-scroll asset-library">
      <div className="page-heading">
        <h1>资产库</h1>
      </div>
      <EmptyState
        icon={<FolderOpen size={30} />}
        title="暂无项目"
        description="创建项目后，在这里查看项目资产。"
      />
    </div>
  );
}

function ProjectAssets({
  project,
  projects,
  onSelect,
  onOpen,
  remote,
}: {
  project: LibraryProject;
  projects: LibraryProject[];
  onSelect: (value: string) => void;
  onOpen: (asset: AssetSelection) => void;
  remote: boolean;
}) {
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const page = useProjectItems<Asset>({
    path: `/projects/${encodeURIComponent(project.id)}/assets?${new URLSearchParams({ type, q: search.trim() })}`,
    enabled: remote,
  });
  const entries = (remote ? page.items : (project.assets ?? [])).map((asset) => ({
    asset,
    projectId: project.id,
  }));
  return (
    <div className="management-scroll asset-library">
      <div className="page-heading">
        <h1>资产库</h1>
        <div className="asset-library-scope">
          <Select
            aria-label="资产所属项目"
            value={project.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <Badge>
            {remote ? (page.metadata?.total ?? "—") : entries.length} 份资产
          </Badge>
        </div>
      </div>
      <AssetGallery
        entries={entries}
        onOpen={onOpen}
        query={
          remote
            ? { type, search, onTypeChange: setType, onSearchChange: setSearch }
            : undefined
        }
        hideEmpty={remote && (page.loading || !!page.error)}
      />
      {remote && page.loading && !entries.length && <p role="status">正在加载资产…</p>}
      {remote && (page.error || page.hasMore) && (
        <div className="library-pagination">
          {page.error && (
            <Alert
              tone="danger"
              action={
                <Button size="sm" onClick={page.retry} disabled={page.loading}>
                  重试加载资产
                </Button>
              }
            >
              {page.error}
            </Alert>
          )}
          {page.hasMore && !page.error && (
            <Button
              size="sm"
              onClick={page.loadMore}
              loading={page.loading}
              disabled={page.loading}
            >
              加载更多资产
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
