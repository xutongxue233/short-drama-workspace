import { useId, useState, type FormEvent } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { type Agent, type Mutate, type Provider } from "../../types";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "../../ui";
import { type SettingsProps } from "../../components/settings/types";
import { kindLabels, ModelPicker, PROVIDER_PRESETS } from "../models";
import { agentColors, agentCopyName, emptyAgent } from "./agentConfig";

export function AgentEditor({
  agent,
  copyFrom,
  agents = [],
  providers,
  onClose,
  onSaved,
  mutate,
  notify,
}: {
  agent?: Agent;
  copyFrom?: Agent;
  agents?: Agent[];
  providers: Provider[];
  onClose: () => void;
  onSaved?: () => void;
  mutate: Mutate;
  notify: SettingsProps["notify"];
}) {
  const formId = useId();
  const source = agent ?? copyFrom ?? emptyAgent;
  const [initialName] = useState(() =>
    copyFrom ? agentCopyName(copyFrom, agents) : source.name,
  );
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState(source.role);
  const [color, setColor] = useState(source.color);
  const [description, setDescription] = useState(source.description);
  const [prompt, setPrompt] = useState(source.systemPrompt);
  const [providerId, setProviderId] = useState(source.providerId);
  const [model, setModel] = useState(source.model);
  const [enabled, setEnabled] = useState(source.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const provider = providers.find((item) => item.id === providerId);
  const preset = PROVIDER_PRESETS.find(
    (item) =>
      item.kind === provider?.kind &&
      item.protocol === provider.protocol &&
      item.baseUrl.replace(/\/+$/, "") === provider.baseUrl.replace(/\/+$/, ""),
  );
  const dirty =
    name !== initialName ||
    role !== source.role ||
    color !== source.color ||
    description !== source.description ||
    prompt !== source.systemPrompt ||
    providerId !== source.providerId ||
    model !== source.model ||
    enabled !== source.enabled;
  const valid =
    Boolean(name.trim() && role.trim() && prompt.trim()) &&
    name.trim().length <= 80 &&
    role.trim().length <= 80 &&
    description.trim().length <= 1000 &&
    prompt.trim().length <= 12000 &&
    model.trim().length <= 200;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError("");
    try {
      await mutate(
        agent ? `/agents/${agent.id}` : "/agents",
        {
          name: name.trim(),
          role: role.trim(),
          color,
          description: description.trim(),
          systemPrompt: prompt.trim(),
          providerId,
          model: model.trim(),
          enabled,
        },
        agent ? "PATCH" : "POST",
      );
      notify(
        agent
          ? `${name.trim()} 的配置已保存`
          : enabled
            ? `${name.trim()} 已创建，可在项目中邀请加入制作组`
            : `${name.trim()} 已创建，启用后可加入制作组`,
      );
      onSaved?.();
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "保存失败，请稍后重试。已保留本次编辑内容。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      className="settings-dialog"
      title={
        agent ? `配置 ${agent.name}` : copyFrom ? `复制 ${copyFrom.name}` : "新增 Agent"
      }
      description={
        agent
          ? "定义创作职责、工作方式与使用的模型。"
          : "创建自定义成员，启用后可在项目中邀请加入制作组、参与讨论。"
      }
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
            <div className="settings-form-grid">
              <Field label="Agent 名称" htmlFor={`${formId}-name`}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                  placeholder="例如：对白顾问"
                />
              </Field>
              <Field label="工作职责" htmlFor={`${formId}-role`}>
                <Input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  maxLength={80}
                  placeholder="例如：对白润色"
                />
              </Field>
            </div>
            <Field label="标识颜色" htmlFor={`${formId}-color`}>
              <div className="agent-color-picker">
                {agentColors.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="agent-color-swatch"
                    style={{ background: item.value }}
                    aria-label={item.label}
                    aria-pressed={color.toLowerCase() === item.value}
                    onClick={() => setColor(item.value)}
                  >
                    {color.toLowerCase() === item.value && <Check size={16} />}
                  </button>
                ))}
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="agent-custom-color"
                  title="选择自定义颜色"
                />
              </div>
            </Field>
            <Field
              label="职责说明"
              htmlFor={`${formId}-description`}
              optional
              hint="最多 1000 字，帮助制作组了解这位成员。"
            >
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={2}
                className="settings-description-input"
                placeholder="描述这个 Agent 在制作中的职责"
              />
            </Field>
            <Field
              label="模型服务"
              htmlFor={`${formId}-provider`}
              hint="参与项目讨论需要绑定已启用的文本生成服务；可以先创建，稍后配置。"
            >
              <Select
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModel("");
                }}
              >
                <option value="">暂不绑定模型服务</option>
                {providerId && !provider && (
                  <option value={providerId}>原模型服务已移除，请重新选择</option>
                )}
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {kindLabels[item.kind]}
                    {!item.enabled ? "（已停用）" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {provider && !provider.enabled && (
              <p className="settings-field-help">
                当前模型服务已停用，使用此 Agent 前请先启用服务或选择其他服务。
              </p>
            )}
            <ModelPicker
              id={`${formId}-model`}
              value={model}
              onChange={setModel}
              config={
                provider
                  ? {
                      providerId: provider.id,
                      kind: provider.kind,
                      protocol: provider.protocol,
                      baseUrl: provider.baseUrl,
                    }
                  : undefined
              }
              presets={preset?.models}
              disabled={saving}
              emptyLabel={
                provider?.model ? `服务默认：${provider.model}` : "使用服务的默认模型"
              }
              placeholder="留空使用服务的默认模型"
            />
            <Field
              label="系统提示词"
              htmlFor={`${formId}-prompt`}
              hint={`${prompt.length} / 12000 字`}
            >
              <Textarea
                className="settings-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={9}
                placeholder="设定创作目标、输入输出要求、风格约束与需要向用户确认的事项…"
                required
                maxLength={12000}
              />
            </Field>
            <p className="settings-field-help">
              <ShieldCheck size={14} />
              系统提示词用于定义工作方式。自定义成员可参与项目讨论，固定制作流程仍由内置成员执行。
            </p>
            <div className="settings-option-row">
              <div>
                <strong>允许加入制作组</strong>
                <p>启用后可在项目中邀请；停用后保留配置与已有记录，暂停参与任务。</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                label="允许此 Agent 加入制作组"
              />
            </div>
          </fieldset>
        </DialogBody>
        <DialogFooter className="agent-editor-footer">
          {error && (
            <p className="agent-form-error" role="alert">
              {error}
            </p>
          )}
          <DialogClose disabled={saving}>取消</DialogClose>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={saving || !valid}
          >
            <Check size={16} />
            {agent ? "保存配置" : "创建 Agent"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
