import { ChevronRight, Plus } from "lucide-react";
import { kindLabels } from "./modelConfig";
import { type ProviderPreset } from "./providerPresets";

export function ProviderPresetGallery({
  presets,
  onChoose,
}: {
  presets: ProviderPreset[];
  onChoose: (preset: ProviderPreset) => void;
}) {
  return (
    <section className="settings-presets" aria-labelledby="model-presets-heading">
      <div className="settings-presets-heading">
        <div>
          <h2 id="model-presets-heading">常用模型预设</h2>
          <p>选择服务商，快速填入接口和推荐模型。密钥可以稍后补充。</p>
        </div>
        <span>{presets.length} 个预设</span>
      </div>
      <div
        className={`settings-presets-grid ${presets.length <= 2 ? "settings-presets-compact" : ""}`}
        tabIndex={0}
        role="group"
        aria-label="常用模型预设"
      >
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="settings-preset-tile"
            onClick={() => onChoose(preset)}
            aria-label={`使用 ${preset.name} ${kindLabels[preset.kind]}预设`}
          >
            <span
              className="settings-preset-monogram"
              style={{ color: preset.color }}
              aria-hidden="true"
            >
              {preset.monogram}
            </span>
            <span className="settings-preset-copy">
              <span className="settings-preset-name">{preset.name}</span>
              <span className="settings-preset-subtitle">{preset.subtitle}</span>
            </span>
            <Plus size={15} className="settings-preset-add" aria-hidden="true" />
          </button>
        ))}
      </div>
      {presets.length > 2 && (
        <p className="settings-presets-scroll-hint">
          横向浏览全部预设 <ChevronRight size={12} aria-hidden="true" />
        </p>
      )}
    </section>
  );
}
