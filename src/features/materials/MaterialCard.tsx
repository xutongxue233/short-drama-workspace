import {
  FolderOpen,
  HardDrive,
  Cloud,
  CircleAlert,
  LoaderCircle,
  ScanEye,
} from "lucide-react";
import { Badge, Button } from "../../ui";
import type { Material } from "../../types";
import { MaterialActions } from "./MaterialActions";
import { MaterialMedia } from "./MaterialMedia";
import {
  formatMaterialBytes,
  formatMaterialTime,
  materialStatusNames,
  materialTypeNames,
  type MaterialEntry,
} from "./materialUtils";

export function MaterialStatus({ status }: { status: Material["status"] }) {
  const Icon =
    status === "local"
      ? HardDrive
      : status === "failed"
        ? CircleAlert
        : status === "downloading"
          ? LoaderCircle
          : Cloud;
  return (
    <Badge
      tone={
        status === "local"
          ? "success"
          : status === "failed"
            ? "danger"
            : status === "downloading"
              ? "accent"
              : "neutral"
      }
    >
      <Icon size={11} />
      <span>{materialStatusNames[status]}</span>
    </Badge>
  );
}
export function MaterialCard({
  entry,
  busy,
  saving,
  onOpen,
  onSave,
}: {
  entry: MaterialEntry;
  busy: boolean;
  saving: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const { material } = entry;
  return (
    <article className="material-card">
      <button
        className="material-thumbnail"
        onClick={onOpen}
        aria-label={`预览 ${material.name}`}
      >
        <MaterialMedia
          key={`${material.id}-${material.status}`}
          material={material}
          thumbnail
        />
        <span className="material-kind">{materialTypeNames[material.type]}</span>
      </button>
      <div className="material-card-body">
        <div className="material-card-heading">
          <h3 title={material.name}>{material.name}</h3>
          <MaterialStatus status={material.status} />
        </div>
        <p className="material-project" title={entry.projectName}>
          <FolderOpen size={12} />
          <span>{entry.projectName}</span>
        </p>
        <p className="material-model" title={material.model}>
          {material.model || "历史素材 · 模型未记录"}
        </p>
        <div className="material-facts">
          <time dateTime={material.createdAt}>
            {formatMaterialTime(material.createdAt)}
          </time>
          <span>{formatMaterialBytes(material.bytes)}</span>
        </div>
        {material.status === "failed" && (
          <p className="material-card-error" title={material.error}>
            {material.error || "保存失败，可重试下载。"}
          </p>
        )}
        <div className="material-card-actions">
          <Button size="sm" variant="ghost" onClick={onOpen}>
            <ScanEye size={14} />
            预览
          </Button>
          <MaterialActions
            material={material}
            busy={busy}
            saving={saving}
            onSave={onSave}
          />
        </div>
      </div>
    </article>
  );
}
