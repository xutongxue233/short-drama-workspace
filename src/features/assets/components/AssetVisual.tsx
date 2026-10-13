import { AudioLines, Clapperboard, FileText, Image, Users, Video } from "lucide-react";
import { useState } from "react";
import type { Asset } from "../../../types";

export function AssetVisual({ item }: { item: Asset }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (
    item.url &&
    item.type !== "video" &&
    item.type !== "audio" &&
    failedUrl !== item.url
  ) {
    return (
      <img
        loading="lazy"
        src={item.url}
        alt={item.name}
        onError={() => setFailedUrl(item.url || "")}
      />
    );
  }
  const Icon = {
    character: Users,
    video: Video,
    audio: AudioLines,
    scene: Image,
    storyboard: Clapperboard,
    script: FileText,
  }[item.type];
  return (
    <>
      <span className="asset-visual-grid" />
      <Icon size={47} strokeWidth={1} aria-hidden="true" />
      {failedUrl && failedUrl === item.url && (
        <span className="asset-preview-label">预览暂不可用</span>
      )}
    </>
  );
}
