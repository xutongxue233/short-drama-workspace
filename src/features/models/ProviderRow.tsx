import { Clock3, KeyRound, Pencil, Trash2, Zap } from "lucide-react";
import { type Provider } from "../../types";
import { Alert, Badge, Button, IconButton, Switch } from "../../ui";
import { kindIcons, protocolLabels } from "./modelConfig";
import { type ConnectionTestResult } from "./useModelManagement";

interface ProviderRowProps {
  provider: Provider;
  result?: ConnectionTestResult;
  busy: boolean;
  pending: boolean;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

export function ProviderRow({
  provider,
  result,
  busy,
  pending,
  testing,
  onTest,
  onEdit,
  onDelete,
  onToggle,
}: ProviderRowProps) {
  const Icon = kindIcons[provider.kind];
  return (
    <article className="settings-provider-row" aria-busy={pending}>
      <div className={`settings-provider-icon settings-kind-${provider.kind}`}>
        <Icon size={21} />
      </div>
      <div className="settings-provider-details">
        <div className="settings-provider-title">
          <h2 title={provider.name}>{provider.name}</h2>
          <Badge tone="neutral">{protocolLabels[provider.protocol]}</Badge>
          {!provider.enabled && <Badge tone="neutral">已停用</Badge>}
        </div>
        <div className="settings-provider-meta">
          <span className="settings-model-name" title={provider.model || "未指定模型"}>
            {provider.model || "未指定模型"}
          </span>
          <span className="settings-meta-dot">·</span>
          <span
            className="settings-provider-url"
            title={provider.baseUrl || "请编辑服务，填写接口地址"}
          >
            {provider.baseUrl || "未配置接口地址"}
          </span>
        </div>
        <div className="settings-provider-status">
          <span
            className={provider.hasKey ? "settings-key-saved" : "settings-key-missing"}
          >
            <KeyRound size={12} />
            {provider.hasKey ? "密钥已保存" : "未设置密钥"}
          </span>
          {!result && (
            <span className="settings-not-tested">
              <Clock3 size={12} />
              尚未测试连接
            </span>
          )}
        </div>
        {result && (
          <Alert
            tone={result.ok ? "success" : "danger"}
            title={result.ok ? "最近测试通过" : "连接测试失败"}
          >
            {result.message}
            {result.ok && typeof result.latencyMs === "number"
              ? `（${result.latencyMs} ms）`
              : ""}
          </Alert>
        )}
      </div>
      <div className="settings-provider-actions">
        <Button
          variant="secondary"
          size="sm"
          loading={testing}
          className="settings-test-button"
          onClick={onTest}
          disabled={busy || !provider.baseUrl.trim()}
          title={provider.baseUrl.trim() ? undefined : "请先编辑服务，填写接口地址"}
        >
          <Zap size={14} />
          测试连接
        </Button>
        <IconButton
          label={`编辑 ${provider.name}`}
          size="sm"
          onClick={onEdit}
          disabled={busy}
        >
          <Pencil size={16} />
        </IconButton>
        <IconButton
          className="settings-delete-button"
          label={`删除 ${provider.name}`}
          size="sm"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 size={16} />
        </IconButton>
        <Switch
          checked={provider.enabled}
          onCheckedChange={() => {
            onToggle();
          }}
          disabled={busy}
          label={`${provider.enabled ? "停用" : "启用"}${provider.name}`}
        />
      </div>
    </article>
  );
}
