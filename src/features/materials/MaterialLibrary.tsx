import { FolderOpen, HardDriveDownload, Images, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjectItems } from "../../components/hooks/useProjectItems";
import type { Action } from "../../shared/contracts";
import { projectPermissions } from "../../shared/project-members";
import type { Material, Project } from "../../types";
import { Alert, Button, EmptyState, IconButton, Select } from "../../ui";
import { MaterialCard } from "./MaterialCard";
import { MaterialDialog } from "./MaterialDialog";
import {
  collectMaterials,
  materialStatusNames,
  type MaterialEntry,
} from "./materialUtils";

type LibraryProject = Pick<Project, "id" | "name" | "running"> &
  Partial<Pick<Project, "materials" | "nodes" | "currentUserAccess">>;

export function MaterialLibrary({
  projects,
  projectId,
  initialProjectId,
  remote = false,
  busy,
  onAction,
}: {
  projects: LibraryProject[];
  projectId?: string;
  initialProjectId?: string;
  remote?: boolean;
  busy: boolean;
  onAction: Action;
}) {
  const [selectedId, setSelectedId] = useState(initialProjectId || "");
  const selectedProject = projectId
    ? projects.find((project) => project.id === projectId)
    : projects.find((project) => project.id === selectedId) ||
      projects.find((project) => project.id === initialProjectId) ||
      projects[0];

  return (
    <div
      className={`${projectId ? "tab-content" : "management-scroll"} material-library`}
    >
      {!projectId && (
        <div className="material-library-heading">
          <h1>素材库</h1>
          {projects.length > 0 && (
            <div className="material-project-select">
              <FolderOpen size={17} aria-hidden="true" />
              <Select
                aria-label="素材所属项目"
                value={selectedProject?.id || ""}
                onChange={(event) => setSelectedId(event.target.value)}
                searchable
                searchPlaceholder="搜索项目"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
      {selectedProject ? (
        <ProjectMaterials
          key={selectedProject.id}
          project={selectedProject}
          remote={remote}
          busy={busy || !projectPermissions(selectedProject).canEdit}
          onAction={onAction}
        />
      ) : (
        <EmptyState
          icon={<FolderOpen size={32} />}
          title={projectId ? "项目不存在" : "暂无项目"}
          description={
            projectId ? "请重新选择项目。" : "创建项目后，即可在这里查看项目素材。"
          }
        />
      )}
    </div>
  );
}

function ProjectMaterials({
  project,
  remote,
  busy,
  onAction,
}: {
  project: LibraryProject;
  remote: boolean;
  busy: boolean;
  onAction: Action;
}) {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [importing, setImporting] = useState(false);
  const page = useProjectItems<Material & { nodeName?: string }>({
    path: `/projects/${encodeURIComponent(project.id)}/materials?${new URLSearchParams({ type, status, q: search.trim() })}`,
    enabled: remote,
    activeId,
  });
  const entries: MaterialEntry[] = remote
    ? page.items.map((material) => ({
        material,
        projectId: project.id,
        projectName: project.name,
        nodeName: material.nodeName,
      }))
    : collectMaterials([project]);
  const filtered = remote
    ? entries
    : entries.filter(
        ({ material }) =>
          (type === "all" || material.type === type) &&
          (status === "all" || material.status === status) &&
          `${material.name} ${material.model || ""} ${material.prompt || ""}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      );
  const active = entries.find(({ material }) => material.id === activeId);
  useEffect(() => {
    if (remote && activeId && !active && !page.loading && !page.error) setActiveId("");
  }, [remote, activeId, active, page.loading, page.error]);
  const projectTotal = remote ? (page.metadata?.projectTotal ?? 0) : entries.length;
  const total = remote ? (page.metadata?.total ?? 0) : filtered.length;
  const localCount = remote
    ? (page.metadata?.savedCount ?? 0)
    : entries.filter(({ material }) => material.status === "local").length;
  const save = async (entry: MaterialEntry) => {
    if (savingId || busy) return;
    setSavingId(entry.material.id);
    try {
      await onAction(
        `/projects/${entry.projectId}/materials/${entry.material.id}/download`,
        {},
        "素材保存状态已更新",
      );
      if (remote) await page.refresh(entry.material.id);
    } finally {
      setSavingId("");
    }
  };
  const importExisting = async () => {
    if (project.running || busy || importing) return;
    setImporting(true);
    try {
      await onAction(
        `/projects/${project.id}/materials/import`,
        {},
        "历史素材保存状态已更新",
      );
      if (remote) await page.refresh();
    } finally {
      setImporting(false);
    }
  };
  const clearFilters = () => {
    setType("all");
    setStatus("all");
    setSearch("");
    setActiveId("");
  };
  const working = busy || importing || !!savingId;
  return (
    <>
      <div className="material-toolbar">
        <div className="filter-tabs" role="group" aria-label="素材类型">
          {[
            { id: "all", name: "全部" },
            { id: "image", name: "图片" },
            { id: "video", name: "视频" },
            { id: "audio", name: "音频" },
          ].map((item) => (
            <button
              key={item.id}
              aria-pressed={type === item.id}
              className={type === item.id ? "active" : ""}
              onClick={() => {
                setType(item.id);
                setActiveId("");
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="material-toolbar-controls">
          <label className="material-search">
            <Search size={15} />
            <input
              aria-label="搜索素材"
              placeholder="搜索素材"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveId("");
              }}
            />
            {search && (
              <IconButton
                label="清除素材搜索"
                onClick={() => {
                  setSearch("");
                  setActiveId("");
                }}
              >
                <X size={14} />
              </IconButton>
            )}
          </label>
          <Select
            aria-label="素材保存状态"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setActiveId("");
            }}
          >
            <option value="all">全部状态</option>
            {(Object.keys(materialStatusNames) as Material["status"][]).map((key) => (
              <option key={key} value={key}>
                {materialStatusNames[key]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={working || project.running}
            loading={importing}
            onClick={() => void importExisting()}
            title={project.running ? "请先暂停制作，再补存历史素材" : undefined}
          >
            <HardDriveDownload size={14} />
            补存历史素材
          </Button>
        </div>
      </div>
      <div className="material-result-bar" role="status">
        <span>{remote && !page.metadata ? "—" : total} 份素材</span>
        <span>{remote && !page.metadata ? "—" : localCount} 份已保存</span>
      </div>
      {filtered.length ? (
        <div className="material-grid">
          {filtered.map((entry) => (
            <MaterialCard
              key={entry.material.id}
              entry={entry}
              busy={working}
              saving={savingId === entry.material.id}
              onOpen={() => setActiveId(entry.material.id)}
              onSave={() => void save(entry)}
            />
          ))}
        </div>
      ) : remote && (page.loading || page.error) ? (
        page.loading ? (
          <p role="status">正在加载素材…</p>
        ) : null
      ) : (
        <EmptyState
          icon={<Images size={32} />}
          title={projectTotal ? "没有匹配的素材" : "暂无素材"}
          description={
            projectTotal
              ? "试试其他筛选条件。"
              : "生成的图片、视频和音频会保存在当前项目。"
          }
          action={
            projectTotal ? <Button onClick={clearFilters}>清除筛选</Button> : undefined
          }
        />
      )}
      {remote && (page.error || page.hasMore) && (
        <div className="library-pagination">
          {page.error && (
            <Alert
              tone="danger"
              action={
                <Button size="sm" onClick={page.retry} disabled={page.loading}>
                  重试加载素材
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
              加载更多素材
            </Button>
          )}
        </div>
      )}
      {active && (
        <MaterialDialog
          entry={active}
          busy={working}
          saving={savingId === active.material.id}
          onClose={() => setActiveId("")}
          onSave={() => void save(active)}
        />
      )}
    </>
  );
}
