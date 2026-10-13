import { type Provider } from "../../types";
import { kindLabels, kindIcons, type ProviderKind } from "./modelConfig";

export function ModelCapabilityFilter({
  providers,
  filter,
  onChange,
}: {
  providers: Provider[];
  filter: "all" | ProviderKind;
  onChange: (filter: "all" | ProviderKind) => void;
}) {
  return (
    <div className="settings-capability-grid">
      {(["text", "image", "video"] as ProviderKind[]).map((kind) => {
        const Icon = kindIcons[kind];
        const count = providers.filter(
          (item) => item.kind === kind && item.enabled,
        ).length;
        return (
          <button
            key={kind}
            className={`settings-capability ${filter === kind ? "is-selected" : ""}`}
            onClick={() => onChange(filter === kind ? "all" : kind)}
            aria-pressed={filter === kind}
          >
            <div className={`settings-capability-icon settings-kind-${kind}`}>
              <Icon size={22} />
            </div>
            <div>
              <strong>{kindLabels[kind]}</strong>
              <p>
                {kind === "text"
                  ? "改编 · 剧本 · 分镜规划"
                  : kind === "image"
                    ? "角色 · 场景 · 分镜画面"
                    : "镜头视频 · 动态叙事"}
              </p>
            </div>
            <span className="settings-capability-count">
              {count}
              <small> 已启用</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
