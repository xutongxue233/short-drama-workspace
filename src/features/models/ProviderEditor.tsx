import { useId, useState, type FormEvent } from "react";
import {
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { type Mutate, type Provider } from "../../types";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
} from "../../ui";
import { type SettingsProps } from "../../components/settings/types";
import {
  kindLabels,
  protocolLabels,
  protocolDescriptions,
  supportsProtocol,
  type ProviderKind,
} from "./modelConfig";
import { PROVIDER_PRESETS, type ProviderPreset } from "./providerPresets";
import { ModelPicker } from "./ModelPicker";

export function ProviderEditor({
  provider,
  initialKind,
  initialPreset,
  onSaved,
  onClose,
  mutate,
  notify,
}: {
  provider: Provider | null;
  initialKind: ProviderKind;
  initialPreset: ProviderPreset | null;
  onSaved: () => void;
  onClose: () => void;
  mutate: Mutate;
  notify: SettingsProps["notify"];
}) {
  const [presetId, setPresetId] = useState(initialPreset?.id || "");
  const [name, setName] = useState(provider?.name || initialPreset?.name || "");
  const [kind, setKind] = useState<ProviderKind>(
    provider?.kind || initialPreset?.kind || initialKind,
  );
  const [protocol, setProtocol] = useState<Provider["protocol"]>(
    provider?.protocol ||
      initialPreset?.protocol ||
      (initialKind === "video" ? "webhook" : "openai"),
  );
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl || initialPreset?.baseUrl || "",
  );
  const [model, setModel] = useState(provider?.model || initialPreset?.model || "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [enabled, setEnabled] = useState(provider?.enabled ?? !initialPreset);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const dirty =
    name !== (provider?.name || initialPreset?.name || "") ||
    kind !== (provider?.kind || initialPreset?.kind || initialKind) ||
    protocol !==
      (provider?.protocol ||
        initialPreset?.protocol ||
        (initialKind === "video" ? "webhook" : "openai")) ||
    baseUrl !== (provider?.baseUrl || initialPreset?.baseUrl || "") ||
    model !== (provider?.model || initialPreset?.model || "") ||
    enabled !== (provider?.enabled ?? !initialPreset) ||
    apiKey !== "" ||
    clearApiKey;
  const selectedPreset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  const matchedPreset =
    selectedPreset ||
    PROVIDER_PRESETS.find(
      (item) =>
        item.kind === kind &&
        item.protocol === protocol &&
        item.baseUrl.replace(/\/+$/, "") === baseUrl.trim().replace(/\/+$/, ""),
    );
  function changePreset(id: string) {
    const next = PROVIDER_PRESETS.find((item) => item.id === id);
    setPresetId(id);
    setApiKey("");
    setClearApiKey(false);
    setReveal(false);
    setName(next?.name || "");
    setKind(next?.kind || initialKind);
    setProtocol(next?.protocol || (initialKind === "video" ? "webhook" : "openai"));
    setBaseUrl(next?.baseUrl || "");
    setModel(next?.model || "");
    setEnabled(!next);
  }
  function changeKind(value: ProviderKind) {
    setPresetId("");
    setKind(value);
    if (!supportsProtocol(protocol, value)) {
      setProtocol(value === "video" ? "webhook" : "openai");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await mutate(
        provider ? `/providers/${provider.id}` : "/providers",
        {
          name: name.trim(),
          kind,
          protocol,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey,
          clearApiKey,
          enabled,
        },
        provider ? "PATCH" : "POST",
      );
      notify(provider ? "模型服务配置已保存" : "模型服务已添加");
      onSaved();
      onClose();
    } catch {
      /* The workspace displays API errors. */
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      className="settings-dialog"
      title={provider ? "编辑模型服务" : "添加模型服务"}
      description="先保存接口配置，准备好密钥后即可开始真实创作。"
      busy={saving}
      dirty={dirty}
      onClose={() => {
        if (!saving) onClose();
      }}
      wide
    >
      <form onSubmit={save} aria-busy={saving}>
        <DialogBody className="settings-form-body">
          <fieldset className="settings-form-fields" disabled={saving}>
            {!provider && (
              <div className="settings-preset-picker">
                <Field label="从常用预设开始" htmlFor={`${formId}-preset`}>
                  <Select
                    value={presetId}
                    onChange={(event) => changePreset(event.target.value)}
                  >
                    <option value="">自定义模型服务</option>
                    {(["text", "image", "video"] as ProviderKind[]).map(
                      (presetKind) => (
                        <optgroup key={presetKind} label={kindLabels[presetKind]}>
                          {PROVIDER_PRESETS.filter(
                            (item) => item.kind === presetKind,
                          ).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </optgroup>
                      ),
                    )}
                  </Select>
                </Field>
                <p>预设会填好接口与模型。可先保存，填入密钥后再启用。</p>
              </div>
            )}
            <Field label="服务名称" htmlFor={`${formId}-name`}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：主力编剧模型、角色设计服务"
                required
                maxLength={80}
              />
            </Field>
            <div className="settings-form-grid">
              <Field label="创作能力" htmlFor={`${formId}-kind`}>
                <Select
                  value={kind}
                  onChange={(e) => changeKind(e.target.value as ProviderKind)}
                >
                  <option value="text">文本生成</option>
                  <option value="image">图像生成</option>
                  <option value="video">视频生成</option>
                </Select>
              </Field>
              <Field label="接口协议" htmlFor={`${formId}-protocol`}>
                <Select
                  value={protocol}
                  onChange={(e) => {
                    setProtocol(e.target.value as Provider["protocol"]);
                    setPresetId("");
                  }}
                >
                  {(Object.keys(protocolLabels) as Provider["protocol"][]).map(
                    (item) => (
                      <option
                        key={item}
                        value={item}
                        disabled={!supportsProtocol(item, kind)}
                      >
                        {protocolLabels[item]}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
            </div>
            <Field label="接口地址" htmlFor={`${formId}-url`}>
              <Input
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setPresetId("");
                }}
                placeholder={
                  protocol === "webhook"
                    ? "https://your-service.example.com/generate"
                    : protocol === "anthropic"
                      ? "https://api.anthropic.com/v1"
                      : protocol === "minimax"
                        ? "https://api.minimax.cn"
                        : protocol === "ark"
                          ? "https://ark.cn-beijing.volces.com/api/v3"
                          : "https://api.example.com/v1"
                }
                required
                autoComplete="url"
              />
            </Field>
            <ModelPicker
              id={`${formId}-model`}
              value={model}
              onChange={setModel}
              config={{
                providerId: provider?.id,
                kind,
                protocol,
                baseUrl,
                apiKey,
                clearApiKey,
              }}
              presets={matchedPreset?.models}
              disabled={saving}
              placeholder="可稍后填写；真实生成时需要模型 ID"
            />
            {matchedPreset && (
              <div className="settings-preset-note">
                <p>{matchedPreset.note}</p>
                <a href={matchedPreset.docsUrl} target="_blank" rel="noreferrer">
                  查看 {matchedPreset.name} 官方文档 <ExternalLink size={12} />
                </a>
              </div>
            )}
            <Field
              htmlFor={`${formId}-key`}
              hint={
                provider?.hasKey
                  ? "仅在接口地址和协议不变时可留空保留密钥；更换地址或协议后，请重新填写密钥或勾选清除。"
                  : undefined
              }
              label={
                <span className="settings-field-label">
                  API 密钥
                  {provider?.hasKey && !clearApiKey && (
                    <span className="settings-inline-hint">
                      <KeyRound size={12} />
                      已保存密钥
                    </span>
                  )}
                </span>
              }
            >
              <div className="settings-key-field">
                <Input
                  type={reveal ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (e.target.value) setClearApiKey(false);
                  }}
                  placeholder={
                    provider?.hasKey && !clearApiKey
                      ? "地址和协议不变时，留空保留密钥"
                      : "可稍后填写；无认证服务可留空"
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <IconButton
                  label={reveal ? "隐藏密钥" : "显示密钥"}
                  size="sm"
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
                </IconButton>
              </div>
            </Field>
            {provider?.hasKey && (
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(e) => {
                    setClearApiKey(e.target.checked);
                    if (e.target.checked) setApiKey("");
                  }}
                />
                清除已保存的密钥
              </label>
            )}
            <div className="settings-adapter-note">
              <CircleHelp size={16} />
              <div>
                <strong>{protocolLabels[protocol]}</strong>
                <p>{protocolDescriptions[protocol]}</p>
                <p>连接测试只检查接口可达性与认证，不会发起生成任务。</p>
              </div>
            </div>
            <div className="settings-option-row">
              <div>
                <strong>启用模型服务</strong>
                <p>允许制作组在真实生成模式下调用。</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                label="启用模型服务"
              />
            </div>
            <p className="settings-field-help">
              <ShieldCheck size={14} />
              密钥仅保存在本机服务端，不会在列表中回传。请勿分享工作台的数据文件。
            </p>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>取消</DialogClose>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={saving || !name.trim() || !baseUrl.trim()}
          >
            <Check size={16} />
            保存服务
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
