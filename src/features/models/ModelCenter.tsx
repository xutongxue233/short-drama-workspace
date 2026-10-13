import { useState } from "react";
import { Link2, Plus } from "lucide-react";
import { Button } from "../../ui";
import { type SettingsProps } from "../../components/settings/types";
import { kindLabels, type ProviderKind } from "./modelConfig";
import { useModelManagement } from "./useModelManagement";
import { ProviderEditor } from "./ProviderEditor";
import { ProviderPresetGallery } from "./ProviderPresetGallery";
import { ProviderRow } from "./ProviderRow";
import { DeleteProviderDialog } from "./DeleteProviderDialog";
import { TestProviderDialog } from "./TestProviderDialog";
import { SettingsSearch } from "../../components/settings/SettingsSearch";

import "../../components/settings/settings.css";
import "./models.css";

export function ModelCenter({ state, mutate, notify }: SettingsProps) {
  const [filter, setFilter] = useState<"all" | ProviderKind>("all");
  const [query, setQuery] = useState("");
  const {
    providers,
    presets,
    editing,
    initialPreset,
    confirmDelete,
    confirmTest,
    busy,
    testingId,
    results,
    openEditor,
    remove,
    test,
    toggle,
    invalidateResult,
    setEditing,
    setConfirmDelete,
    setConfirmTest,
  } = useModelManagement({ state, mutate, notify }, filter, query);
  return (
    <div className="settings-page">
      <div className="settings-page-heading">
        <h1>模型服务</h1>
        <Button variant="primary" onClick={() => openEditor(null)}>
          <Plus size={17} />
          添加模型服务
        </Button>
      </div>
      <div className="settings-toolbar settings-model-toolbar">
        <SettingsSearch
          label="搜索模型服务"
          placeholder="搜索服务、模型或地址…"
          value={query}
          onChange={setQuery}
          clearLabel="清除模型搜索"
        />
        <span className="settings-result-count" role="status">
          {providers.length} 个模型服务
        </span>
      </div>
      <div className="settings-provider-panel">
        <div className="settings-provider-panel-heading">
          <div className="settings-tabs" role="group" aria-label="筛选模型能力">
            {(["all", "text", "image", "video"] as const).map((item) => (
              <button
                key={item}
                className={filter === item ? "is-active" : ""}
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
              >
                {item === "all" ? "全部服务" : kindLabels[item]}
                {item === "all" && <span>{state.providers.length}</span>}
              </button>
            ))}
          </div>
        </div>
        {providers.length ? (
          <div className="settings-provider-list">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                result={results[provider.id]}
                busy={busy !== null}
                pending={busy === provider.id}
                testing={testingId === provider.id}
                onTest={() => setConfirmTest(provider)}
                onEdit={() => openEditor(provider)}
                onDelete={() => setConfirmDelete(provider)}
                onToggle={() => {
                  void toggle(provider);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state settings-model-empty">
            <div className="settings-empty-symbol">
              <Link2 size={29} />
            </div>
            <h3>
              {query.trim()
                ? "没有匹配的模型服务"
                : filter === "all"
                  ? "暂无模型服务"
                  : "还没有配置" + kindLabels[filter] + "服务"}
            </h3>
            <p>
              {query.trim()
                ? "试试其他关键词，或清除搜索查看已配置服务。"
                : "可以先保存接口地址和模型名称，稍后再填写密钥。"}
            </p>
            {query.trim() ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                清除搜索
              </Button>
            ) : (
              <Button variant="primary" onClick={() => openEditor(null)}>
                <Plus size={16} />
                添加模型服务
              </Button>
            )}
          </div>
        )}
      </div>
      <details className="settings-presets-disclosure">
        <summary>从常用预设添加</summary>
        <ProviderPresetGallery
          presets={presets}
          onChoose={(preset) => openEditor(null, preset)}
        />
      </details>
      {editing !== undefined && (
        <ProviderEditor
          provider={editing}
          initialKind={filter === "all" ? "text" : filter}
          initialPreset={initialPreset}
          mutate={mutate}
          notify={notify}
          onSaved={() => {
            if (editing) invalidateResult(editing.id);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
      {confirmDelete && (
        <DeleteProviderDialog
          provider={confirmDelete}
          busy={busy !== null}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            void remove(confirmDelete);
          }}
        />
      )}
      {confirmTest && (
        <TestProviderDialog
          provider={confirmTest}
          onClose={() => setConfirmTest(null)}
          onConfirm={() => {
            void test(confirmTest);
          }}
        />
      )}
    </div>
  );
}
