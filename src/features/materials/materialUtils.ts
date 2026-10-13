import type { Material, Project } from "../../types";

export interface MaterialEntry {
  material: Material;
  projectId: string;
  projectName: string;
  nodeName?: string;
}
export const materialTypeNames = { image: "图片", video: "视频", audio: "音频" };
export const materialStatusNames = {
  local: "本地已保存",
  remote: "待保存",
  failed: "下载失败",
  downloading: "下载中",
};
export function materialFileUrl(id: string, download = false) {
  return `/api/media/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`;
}
export function materialPreviewUrl(material: Material) {
  if (material.status === "local") return materialFileUrl(material.id);
  const source = material.url || material.sourceUrl;
  try {
    const url = new URL(source);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? source
      : "";
  } catch {
    return "";
  }
}
export function materialSourceHost(material: Material) {
  try {
    const url = new URL(material.sourceUrl);
    return ["https:", "http:"].includes(url.protocol) ? url.host : "模型直接返回";
  } catch {
    return "模型直接返回";
  }
}
export function formatMaterialBytes(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0)
    return "大小待保存后确认";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
export function formatMaterialTime(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function collectMaterials(
  projects: (Pick<Project, "id" | "name"> &
    Partial<Pick<Project, "materials" | "nodes">>)[],
): MaterialEntry[] {
  return projects
    .flatMap((project) =>
      (project.materials || []).map((material) => ({
        material,
        projectId: project.id,
        projectName: project.name,
        nodeName: project.nodes?.find((node) => node.id === material.nodeId)?.name,
      })),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.material.createdAt) || 0) -
        (Date.parse(a.material.createdAt) || 0),
    );
}
