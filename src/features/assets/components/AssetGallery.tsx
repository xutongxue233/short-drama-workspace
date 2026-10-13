import {
  ArrowRight,
  Clock3,
  FolderOpen,
  Layers3,
  LockKeyhole,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { assetNames } from "../../../shared/labels";
import type { Asset } from "../../../types";
import { Button, EmptyState, IconButton } from "../../../ui";
import { AssetVisual } from "./AssetVisual";

export function AssetGallery({
  entries,
  onOpen,
  query,
  hideEmpty = false,
}: {
  entries: { asset: Asset; projectId: string; projectName?: string }[];
  onOpen: (entry: { asset: Asset; projectId: string }) => void;
  query?: {
    type: string;
    search: string;
    onTypeChange: (value: string) => void;
    onSearchChange: (value: string) => void;
  };
  hideEmpty?: boolean;
}) {
  const [localFilter, setLocalFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");
  const filter = query?.type ?? localFilter;
  const search = query?.search ?? localSearch;
  const setFilter = query?.onTypeChange ?? setLocalFilter;
  const setSearch = query?.onSearchChange ?? setLocalSearch;
  const filtered = query
    ? entries
    : entries.filter(
        (e) =>
          (filter === "all" || e.asset.type === filter) &&
          `${e.asset.name} ${e.asset.description}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      );
  const hasFilters =
    entries.length > 0 || (query && (filter !== "all" || search.trim()));
  return (
    <>
      <div className="asset-controls">
        <div className="filter-tabs" role="group" aria-label="资产类型">
          {["all", "character", "scene", "script", "storyboard", "video", "audio"].map(
            (type) => (
              <button
                className={filter === type ? "active" : ""}
                aria-pressed={filter === type}
                key={type}
                onClick={() => setFilter(type)}
              >
                {type === "all" ? "全部" : assetNames[type]}
              </button>
            ),
          )}
        </div>
        <label className="asset-search">
          <Search size={15} />
          <input
            aria-label="搜索资产"
            placeholder="搜索资产"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <IconButton label="清除资产搜索" onClick={() => setSearch("")}>
              <X size={14} />
            </IconButton>
          )}
        </label>
      </div>
      {filtered.length ? (
        <div className="asset-grid">
          {filtered.map((entry, i) => (
            <button
              className="asset-card"
              key={`${entry.projectId}-${entry.asset.id}`}
              onClick={() => onOpen(entry)}
            >
              <div
                className={`asset-visual asset-visual-${entry.asset.type} visual-${i % 4}`}
              >
                <AssetVisual item={entry.asset} />
                {(entry.asset.locked ||
                  entry.asset.tags.includes("历史版本") ||
                  entry.asset.tags.includes("待更新")) && (
                  <span className="asset-lock">
                    {entry.asset.tags.includes("历史版本") ? (
                      <Clock3 size={11} />
                    ) : (
                      <LockKeyhole size={11} />
                    )}
                    {entry.asset.tags.includes("历史版本")
                      ? "历史版本"
                      : entry.asset.tags.includes("待更新")
                        ? "待重新制作"
                        : "已锁定"}
                  </span>
                )}
                <span className="asset-version">v{entry.asset.version}</span>
              </div>
              <div className="asset-card-info">
                <div>
                  <h3 title={entry.asset.name}>{entry.asset.name}</h3>
                  <span>{assetNames[entry.asset.type]}</span>
                </div>
                {entry.asset.description && <p>{entry.asset.description}</p>}
                <footer>
                  {entry.projectName ? (
                    <span title={entry.projectName}>
                      <FolderOpen size={11} />
                      {entry.projectName}
                    </span>
                  ) : (
                    <span>
                      {entry.asset.tags
                        ?.filter((tag) => !/^(node|generation|replaces):/.test(tag))
                        .slice(0, 2)
                        .join(" · ")}
                    </span>
                  )}
                  <ArrowRight size={14} />
                </footer>
              </div>
            </button>
          ))}
        </div>
      ) : hideEmpty ? null : (
        <EmptyState
          icon={<Layers3 size={30} />}
          title={hasFilters ? "没有找到匹配资产" : "暂无资产"}
          description={
            hasFilters
              ? "试试其他类型或关键词。"
              : "项目生成的角色、剧本和分镜会归档在这里。"
          }
          action={
            hasFilters ? (
              <Button
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                清除筛选
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
