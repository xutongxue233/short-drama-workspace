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
  const label = {
    character: "CHARACTER BIBLE",
    storyboard: "SHOT DESIGN",
    video: "VIDEO PRODUCTION",
    audio: "AUDIO PRODUCTION",
    scene: "SCENE DESIGN",
    script: "CREATIVE DOCUMENT",
  }[item.type];
  return (
    <>
      <span className="asset-visual-grid" />
      <Icon size={47} strokeWidth={1} aria-hidden="true" />
      <span className="asset-preview-label">
        {failedUrl && failedUrl === item.url ? "预览暂不可用 · 点击查看档案" : label}
      </span>
    </>
  );
}
