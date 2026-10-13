import { useId, useState, type FormEvent } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { type Agent, type Mutate, type Provider, type Skill } from "../../types";
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

export function AgentEditor({
  agent,
  providers,
  skills = [],
  onClose,
  mutate,
  notify,
}: {
  agent: Agent;
  providers: Provider[];
  skills?: Skill[];
  onClose: () => void;
  mutate: Mutate;
  notify: SettingsProps["notify"];
}) {
  const formId = useId();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [providerId, setProviderId] = useState(agent.providerId);
  const [model, setModel] = useState(agent.model);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [skillIds, setSkillIds] = useState(agent.skillIds ?? []);
  const [saving, setSaving] = useState(false);
  const skillBindingsChanged =
    JSON.stringify(skillIds) !== JSON.stringify(agent.skillIds ?? []);
  const provider = providers.find((item) => item.id === providerId);
  const preset = PROVIDER_PRESETS.find(
    (item) =>
      item.kind === provider?.kind &&
      item.protocol === provider.protocol &&
      item.baseUrl.replace(/\/+$/, "") === provider.baseUrl.replace(/\/+$/, ""),
  );
  const dirty =
    name !== agent.name ||
    description !== agent.description ||
    prompt !== agent.systemPrompt ||
    providerId !== agent.providerId ||
    model !== agent.model ||
    enabled !== agent.enabled ||
    skillBindingsChanged;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || skillIds.length > 8) return;
    setSaving(true);
    try {
      await mutate(
        `/agents/${agent.id}`,
        {
          name: name.trim(),
          description: description.trim(),
          systemPrompt: prompt.trim(),
          providerId,
          model: model.trim(),
          enabled,
          ...(skillBindingsChanged ? { skillIds } : {}),
        },
        "PATCH",
      );
      notify(`${name.trim()} 的配置已保存`);
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
      title={`配置 ${agent.name}`}
      description="定义创作职责、工作方式与使用的模型。"
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
                  maxLength={60}
                />
              </Field>
              <div className="settings-readonly-field">
                <span>工作职责</span>
                <div className="settings-readonly">{agent.role}</div>
              </div>
            </div>
            <Field label="职责说明" htmlFor={`${formId}-description`}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                rows={2}
                className="settings-description-input"
                placeholder="描述这个 Agent 在制作中的职责"
              />
            </Field>
            <Field label="模型服务" htmlFor={`${formId}-provider`}>
              <Select
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModel("");
                }}
              >
                <option value="">自动选择匹配的服务</option>
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {kindLabels[item.kind]}
                    {!item.enabled ? "（已停用）" : ""}
                  </option>
                ))}
              </Select>
            </Field>
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
            <Field label="系统提示词" htmlFor={`${formId}-prompt`}>
              <Textarea
                className="settings-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={9}
                placeholder="设定创作目标、输入输出要求、风格约束与需要向用户确认的事项…"
                required
              />
            </Field>
            <p className="settings-field-help">
              <ShieldCheck size={14} />
              项目记忆、角色约束与当前节点资料会随创作任务一同提供。
            </p>
            <fieldset className="agent-skill-bindings">
              <legend>
                绑定技能 <span>{skillIds.length} / 8</span>
              </legend>
              <p>
                绑定的已启用技能会用于此 Agent 的聊天与制作任务。在技能库维护具体指令。
              </p>
              {skills.length || skillIds.length ? (
                <div className="agent-skill-options">
                  {[
                    ...skills.map((skill) => ({
                      id: skill.id,
                      name: skill.name,
                      description: skill.description,
                      enabled: skill.enabled,
                    })),
                    ...skillIds
                      .filter((id) => !skills.some((skill) => skill.id === id))
                      .map((id) => ({
                        id,
                        name: id,
                        description: "技能已不可用，可取消绑定。",
                        enabled: false,
                      })),
                  ].map((skill) => {
                    const checked = skillIds.includes(skill.id);
                    return (
                      <label key={skill.id} className="agent-skill-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`绑定 ${skill.name}${skill.enabled ? "" : "（已停用）"}`}
                          disabled={!checked && skillIds.length >= 8}
                          onChange={() =>
                            setSkillIds(
                              checked
                                ? skillIds.filter((id) => id !== skill.id)
                                : [...skillIds, skill.id],
                            )
                          }
                        />
                        <span>
                          <strong>
                            ${skill.name}
                            {!skill.enabled && <em>已停用 · 暂不执行</em>}
                          </strong>
                          <span>{skill.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="agent-skill-empty">
                  暂无技能，先到技能库创建或导入 SKILL.md。
                </p>
              )}
              {skillIds.length >= 8 && (
                <p role="status">最多绑定 8 个技能，取消一个后可以选择其他技能。</p>
              )}
            </fieldset>
            <div className="settings-option-row">
              <div>
                <strong>允许加入制作组</strong>
                <p>主控 Agent 可以在项目中邀请启用的成员。</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                label="允许此 Agent 加入制作组"
              />
            </div>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>取消</DialogClose>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={saving || !name.trim() || !prompt.trim() || skillIds.length > 8}
          >
            <Check size={16} />
            保存配置
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
