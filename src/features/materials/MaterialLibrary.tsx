import { Archive, HardDriveDownload, Images, Search, X } from "lucide-react";
import { useState } from "react";
import type { Action } from "../../shared/contracts";
import type { Material, Project } from "../../types";
import { Badge, Button, EmptyState, IconButton, Select } from "../../ui";
import { MaterialCard } from "./MaterialCard";
import { MaterialDialog } from "./MaterialDialog";
import {
  collectMaterials,
  materialStatusNames,
  type MaterialEntry,
} from "./materialUtils";

export function MaterialLibrary({
  projects,
  projectId,
  busy,
  onAction,
}: {
  projects: Project[];
  projectId?: string;
  busy: boolean;
  onAction: Action;
}) {
  const [projectFilter, setProjectFilter] = useState(projectId || "all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [importing, setImporting] = useState(false);
  const effectiveProjectId = projectId || projectFilter;
  const entries = collectMaterials(projects);
  const scoped = entries.filter(
    (entry) => effectiveProjectId === "all" || entry.projectId === effectiveProjectId,
  );
  const filtered = scoped.filter(
    ({ material, projectName }) =>
      (type === "all" || material.type === type) &&
      (status === "all" || material.status === status) &&
      `${material.name} ${material.model || ""} ${projectName} ${material.prompt || ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const active = entries.find(({ material }) => material.id === activeId);
  const localCount = scoped.filter(
    ({ material }) => material.status === "local",
  ).length;
  const selectedProject = projects.find((project) => project.id === effectiveProjectId);
  const save = async (entry: MaterialEntry) => {
    if (savingId || busy) return;
    setSavingId(entry.material.id);
    try {
      await onAction(
        `/projects/${entry.projectId}/materials/${entry.material.id}/download`,
        {},
        "素材保存状态已更新",
      );
    } finally {
      setSavingId("");
    }
  };
  const importExisting = async () => {
    if (!selectedProject || selectedProject.running || busy || importing) return;
    setImporting(true);
    try {
      await onAction(
        `/projects/${selectedProject.id}/materials/import`,
        {},
        "历史素材归档完成，请查看各素材的保存状态",
      );
    } finally {
      setImporting(false);
    }
  };
  const clearFilters = () => {
    setType("all");
    setStatus("all");
    setSearch("");
  };
  const working = busy || importing || !!savingId;
  return (
    <div
      className={`${projectId ? "tab-content" : "management-scroll"} material-library`}
    >
      <div className={projectId ? "section-heading" : "page-heading"}>
        <div>
          {!projectId && <div className="eyebrow">THE PRODUCTION ARCHIVE</div>}
          {projectId ? (
            <h2>每一次生成，都留一份</h2>
          ) : (
            <h1>
              素材库<span className="heading-dot">.</span>
            </h1>
          )}
          <p>保留生成过程中的图片、视频与音频，试稿和中间版本也不会覆盖。</p>
        </div>
        <Badge>{scoped.length} 份素材</Badge>
      </div>
      <div className="material-archive-note">
        <Archive size={19} />
        <div>
          <strong>素材留档，资产定稿</strong>
          <p>新素材自动下载到工作台本地。角色标准与已确认成果仍在资产库管理。</p>
        </div>
        <span>
          {localCount} / {scoped.length} 已保存
        </span>
      </div>
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
              onClick={() => setType(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <label className="material-search">
          <Search size={15} />
          <input
            aria-label="搜索素材"
            placeholder="搜索名称、模型或提示词"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <IconButton label="清除素材搜索" onClick={() => setSearch("")}>
              <X size={14} />
            </IconButton>
          )}
        </label>
      </div>
      <div className="material-filter-row">
        {!projectId && (
          <Select
            aria-label="素材所属项目"
            value={effectiveProjectId}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="素材保存状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">全部保存状态</option>
          {(Object.keys(materialStatusNames) as Material["status"][]).map((key) => (
            <option key={key} value={key}>
              {materialStatusNames[key]}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={working || !selectedProject || selectedProject.running}
          loading={importing}
          onClick={() => void importExisting()}
          title={
            selectedProject
              ? selectedProject.running
                ? "项目正在制作，请先暂停制作再补存历史素材"
                : "查找当前项目已有的图片、视频与音频，补存到本地"
              : "先选择具体项目，再补存历史素材"
          }
        >
          <HardDriveDownload size={14} />
          补存历史素材
        </Button>
      </div>
      <div className="material-result-bar">
        <span role="status">
          显示 {filtered.length} 份素材
          {!projectId && !selectedProject ? " · 选择项目可补存历史素材" : ""}
        </span>
        <span>按生成时间 · 最新在前</span>
      </div>
      {filtered.length ? (
        <div className="material-grid">
          {filtered.map((entry) => (
            <MaterialCard
              key={`${entry.projectId}-${entry.material.id}`}
              entry={entry}
              busy={working}
              saving={savingId === entry.material.id}
              onOpen={() => setActiveId(entry.material.id)}
              onSave={() => void save(entry)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Images size={32} />}
          title={scoped.length ? "没有匹配的素材" : "生成的每一版，都将留在这里"}
          description={
            scoped.length
              ? "试试其他类型、保存状态或关键词。"
              : projectId
                ? "图片和视频生成后会自动归档。点击“补存历史素材”，可归档这个项目已有的作品。"
                : "图片和视频生成后会自动归档。已有作品可选择项目，再点击“补存历史素材”保存到本地。"
          }
          action={
            scoped.length ? <Button onClick={clearFilters}>清除筛选</Button> : undefined
          }
        />
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
    </div>
  );
}
