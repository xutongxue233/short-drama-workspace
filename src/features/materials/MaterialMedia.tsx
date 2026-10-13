import { ImageOff, Image, Film, Music2, CloudDownload } from "lucide-react";
import { useState } from "react";
import type { Material } from "../../types";
import { materialPreviewUrl, materialTypeNames } from "./materialUtils";

export function MaterialMedia({
  material,
  thumbnail = false,
  onVideoMetadata,
}: {
  material: Material;
  thumbnail?: boolean;
  onVideoMetadata?: (metadata: {
    duration: number;
    width: number;
    height: number;
  }) => void;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const url = materialPreviewUrl(material);
  const Icon =
    material.type === "video" ? Film : material.type === "audio" ? Music2 : Image;
  if (thumbnail && (material.status !== "local" || material.type !== "image"))
    return (
      <div className="material-placeholder">
        <Icon size={34} strokeWidth={1.3} />
        <span>
          {material.status === "local"
            ? `点击播放${materialTypeNames[material.type]}`
            : "保存后显示本地预览"}
        </span>
        {material.status !== "local" && <CloudDownload size={15} />}
      </div>
    );
  if (!url || failedUrl === url)
    return (
      <div className="material-placeholder material-media-error" role="status">
        <ImageOff size={28} />
        <span>
          {thumbnail
            ? "预览不可用"
            : "素材暂时无法加载。远程链接可能已失效，或本地文件已被移动。"}
        </span>
      </div>
    );
  const onError = () => setFailedUrl(url);
  if (material.type === "video")
    return (
      <video
        className="material-player"
        src={url}
        controls
        playsInline
        preload="metadata"
        aria-label={material.name}
        onError={onError}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.videoWidth && video.videoHeight)
            onVideoMetadata?.({
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
            });
        }}
      />
    );
  if (material.type === "audio")
    return (
      <div className="material-audio">
        <Music2 size={40} strokeWidth={1.2} />
        <audio
          src={url}
          controls
          preload="metadata"
          aria-label={material.name}
          onError={onError}
        />
      </div>
    );
  return (
    <img
      className="material-image"
      src={url}
      alt={material.name}
      loading={thumbnail ? "lazy" : undefined}
      decoding="async"
      onError={onError}
    />
  );
}
