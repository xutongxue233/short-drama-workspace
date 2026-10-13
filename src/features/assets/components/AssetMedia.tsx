import { useState } from "react";
import type { Asset } from "../../../types";
import { Button } from "../../../ui";

export function AssetMedia({
  item,
  onLoadStateChange,
}: {
  item: Asset;
  onLoadStateChange?: (state: "loading" | "loaded" | "failed") => void;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  if (!item.url) return null;
  if (failedUrl === item.url)
    return (
      <div className="error-box" role="status">
        <p>素材暂时无法加载，请检查素材地址或网络连接。</p>
        <Button
          size="sm"
          onClick={() => {
            setFailedUrl("");
            onLoadStateChange?.("loading");
          }}
        >
          重试加载 {item.name}
        </Button>
      </div>
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
