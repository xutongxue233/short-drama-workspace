import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { request } from "../../api";
import type { Provider } from "../../types";
import { Button, Field, Input, Select } from "../../ui";
import "./styles/model-picker.css";

export interface ModelDiscoveryConfig {
  providerId?: string;
  kind: Provider["kind"];
  protocol: Provider["protocol"];
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
}
interface ModelCatalog {
  models: { id: string; name: string; kinds?: Provider["kind"][] }[];
  source: "remote" | "preset" | "unsupported";
  message: string;
  truncated: boolean;
}

/** Shared by service settings and member settings; discovery never saves configuration. */
export function ModelPicker({
  id,
  value,
  onChange,
  config,
  presets = [],
  disabled = false,
  emptyLabel = "暂不指定模型",
  placeholder = "填写模型 ID",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  config?: ModelDiscoveryConfig;
  presets?: string[];
  disabled?: boolean;
  emptyLabel?: string;
  placeholder?: string;
}) {
  const [manual, setManual] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    catalog?: ModelCatalog;
    error?: string;
  }>();
  const [pending, setPending] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const configKey = JSON.stringify(config || null);
  useEffect(() => () => controller.current?.abort(), [configKey]);
  const current = result?.key === configKey ? result : undefined;
  const loading = pending === configKey;
  const models = current?.catalog?.models || [];
  const modelIds = new Set(models.map((model) => model.id));
  const fallback = [...new Set(presets)].filter((model) => !modelIds.has(model));
  const customValue = value && !modelIds.has(value) && !fallback.includes(value);
  async function loadModels() {
    if (!config || !config.baseUrl.trim() || loading) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setPending(configKey);
    setResult(undefined);
    try {
      const catalog = await request<ModelCatalog>("/providers/models", config, "POST", {
        signal: active.signal,
      });
      if (!active.signal.aborted) setResult({ key: configKey, catalog });
    } catch (error) {
      if (!active.signal.aborted)
        setResult({
          key: configKey,
          error:
            error instanceof Error ? error.message : "获取模型列表失败，请稍后重试。",
        });
    } finally {
      if (controller.current === active) setPending(undefined);
    }
  }
  return (
    <Field label="模型名称" htmlFor={id}>
      <div className="model-picker-controls">
        {manual ? (
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
            maxLength={200}
          />
        ) : (
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            searchable
            searchPlaceholder="搜索模型名称或 ID"
          >
            <option value="">{emptyLabel}</option>
            {customValue && <option value={value}>{value}（当前配置）</option>}
            {models.length > 0 && (
              <optgroup
                label={
                  current?.catalog?.source === "remote"
                    ? "接口返回的模型"
                    : "官方预设（未验证权限）"
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name && model.name !== model.id
                      ? `${model.name} · ${model.id}`
                      : model.id}
                  </option>
                ))}
              </optgroup>
            )}
            {fallback.length > 0 && (
              <optgroup label="推荐预设（未验证权限）">
                {fallback.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
        <Button
          size="sm"
          variant="secondary"
          loading={loading}
          disabled={disabled || !config?.baseUrl.trim() || loading}
          onClick={() => void loadModels()}
        >
          <RefreshCw size={13} />
          获取模型
        </Button>
      </div>
      <div className="model-picker-help">
        <span>{manual ? "使用账号中的完整模型 ID" : "可搜索选择，也可手动填写"}</span>
        <button type="button" onClick={() => setManual(!manual)} disabled={disabled}>
          {manual ? "从列表选择" : "手动输入"}
        </button>
      </div>
      {current?.error && (
        <p className="model-picker-error" role="alert">
          {current.error} 仍可选择预设或手动输入。
        </p>
      )}
      {current?.catalog && (
        <p className="model-picker-status" role="status">
          <strong>
            {current.catalog.source === "remote"
              ? `已从接口获取 ${models.length} 个模型`
              : current.catalog.source === "preset"
                ? "当前显示官方预设"
                : "此接口不支持获取模型列表"}
          </strong>
          {current.catalog.message && <span>{current.catalog.message}</span>}
          {current.catalog.truncated && (
            <span>列表较长，已显示部分模型；其余型号可手动输入。</span>
          )}
        </p>
      )}
    </Field>
  );
}
