import { useState } from "react";
import { type Provider } from "../../types";
import { type SettingsProps } from "../../components/settings/types";
import { type ProviderKind } from "./modelConfig";
import { PROVIDER_PRESETS, type ProviderPreset } from "./providerPresets";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/** Owns model management mutations and transient dialog/test state. */
export function useModelManagement(
  { state, mutate, notify }: SettingsProps,
  filter: "all" | ProviderKind,
  query: string,
) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Provider | null | undefined>(undefined);
  const [initialPreset, setInitialPreset] = useState<ProviderPreset | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Provider | null>(null);
  const [confirmTest, setConfirmTest] = useState<Provider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const providers = state.providers.filter(
    (item) =>
      (filter === "all" || item.kind === filter) &&
      `${item.name} ${item.model} ${item.baseUrl}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const presets = PROVIDER_PRESETS.filter(
    (item) => filter === "all" || item.kind === filter,
  );
  function openEditor(provider: Provider | null, preset: ProviderPreset | null = null) {
    setInitialPreset(preset);
    setEditing(provider);
  }
  async function remove(provider: Provider) {
    if (busy) return;
    setBusy(provider.id);
    setDeleteError("");
    try {
      await mutate(`/providers/${provider.id}`, undefined, "DELETE");
      notify("模型服务已删除");
      setConfirmDelete(null);
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "删除模型服务失败，请重试。",
      );
    } finally {
      setBusy(null);
    }
  }
  async function test(provider: Provider) {
    setBusy(provider.id);
    setTestingId(provider.id);
    setConfirmTest(null);
    try {
      const result = (await mutate(`/providers/${provider.id}/test`, {})) as {
        ok?: boolean;
        message?: string;
        latencyMs?: number;
      };
      const entry = {
        ok: result?.ok === true,
        message: result?.message || "测试已完成，请检查服务配置。",
        latencyMs: result?.latencyMs,
      };
      setResults((previous) => ({ ...previous, [provider.id]: entry }));
      if (entry.ok) notify("连接测试通过");
    } catch (cause) {
      setResults((previous) => ({
        ...previous,
        [provider.id]: {
          ok: false,
          message:
            cause instanceof Error
              ? cause.message
              : "连接测试失败，请检查接口地址、密钥和服务状态。",
        },
      }));
    } finally {
      setBusy(null);
      setTestingId(null);
    }
  }
  async function toggle(provider: Provider) {
    if (busy) return;
    setBusy(provider.id);
    setError("");
    try {
      await mutate(
        `/providers/${provider.id}`,
        { enabled: !provider.enabled },
        "PATCH",
      );
      notify(`${provider.name} 已${provider.enabled ? "停用" : "启用"}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "更新模型服务状态失败，请重试。",
      );
    } finally {
      setBusy(null);
    }
  }

  function invalidateResult(providerId: string) {
    setResults((previous) => {
      const next = { ...previous };
      delete next[providerId];
      return next;
    });
  }
  return {
    providers,
    presets,
    editing,
    initialPreset,
    confirmDelete,
    confirmTest,
    busy,
    testingId,
    results,
    error,
    deleteError,
    setDeleteError,
    openEditor,
    remove,
    test,
    toggle,
    invalidateResult,
    setEditing,
    setConfirmDelete,
    setConfirmTest,
  };
}
