import { Download, HardDriveDownload, RotateCcw } from "lucide-react";
import type { Material } from "../../types";
import { Button } from "../../ui";
import { materialFileUrl } from "./materialUtils";

export function MaterialActions({
  material,
  busy,
  saving,
  onSave,
}: {
  material: Material;
  busy: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  if (material.status === "local")
    return (
      <a
        className="ui-button ui-button-secondary ui-control-sm"
        href={materialFileUrl(material.id, true)}
        download
        aria-label={`下载 ${material.name}`}
      >
        <span className="ui-button-content">
          <Download size={14} />
          下载文件
        </span>
      </a>
    );
  return (
    <Button
      size="sm"
      disabled={busy || material.status === "downloading"}
      loading={saving || material.status === "downloading"}
      onClick={onSave}
      aria-label={`${material.status === "failed" ? "重试保存" : "保存到本地"} ${material.name}`}
    >
      {material.status === "failed" ? (
        <RotateCcw size={14} />
      ) : (
        <HardDriveDownload size={14} />
      )}
      {material.status === "downloading"
        ? "正在保存"
        : material.status === "failed"
          ? "重试保存"
          : "保存到本地"}
    </Button>
  );
}
