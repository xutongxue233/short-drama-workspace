import { useState } from "react";
import type { Asset } from "../../../types";

export function AssetMedia({
  item,
  onLoadStateChange,
}: {
  item: Asset;
  onLoadStateChange?: (state: "loaded" | "failed") => void;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  if (!item.url) return null;
  if (failedUrl === item.url)
    return (
      <p className="error-box" role="status">
        素材暂时无法加载，请检查素材地址或网络连接。
      </p>
    );
  const fail = () => {
    setFailedUrl(item.url || "");
    onLoadStateChange?.("failed");
  };
  if (item.type === "video")
    return (
      <video
        className="asset-media"
        controls
        preload="metadata"
        src={item.url}
        onError={fail}
        aria-label={item.name}
      />
    );
  if (item.type === "audio")
    return (
      <audio
        className="asset-audio"
        controls
        preload="metadata"
        src={item.url}
        onError={fail}
        aria-label={item.name}
      />
    );
  return (
    <img
      className="asset-media"
      src={item.url}
      alt={item.name}
      onLoad={() => onLoadStateChange?.("loaded")}
      onError={fail}
    />
  );
}
