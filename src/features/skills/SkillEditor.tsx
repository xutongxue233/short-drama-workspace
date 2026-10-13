import { useId, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import type { Skill } from "../../types";
import type { SettingsProps } from "../../components/settings/types";
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Form,
  Input,
  Switch,
  Textarea,
} from "../../ui";

export type SkillDraft = Pick<
  Skill,
  "name" | "description" | "instructions" | "enabled"
>;

export const STORY_REVIEW_TEMPLATE: SkillDraft = {
  name: "review-drama",
  description: "检查短剧剧本的冲突、人物动机与结尾悬念，给出可执行的修改建议。",
  instructions:
    "# 短剧剧本审阅\n\n阅读当前任务提供的剧本与已确认的创作要求。\n\n1. 检查开场冲突是否清楚，人物目标与行为是否一致。\n2. 检查每场戏是否推动情节，信息是否重复，转折是否有依据。\n3. 检查结尾是否留下与本集核心冲突相关的悬念。\n4. 按优先级列出问题，引用对应台词或场景，给出具体修改建议。\n\n保留原著事实与已确认的人物设定；资料不足时明确说明，不编造依据。将修改作为待确认建议，等待用户决定。",
  enabled: true,
};

const emptyDraft: SkillDraft = {
  name: "",
  description: "",
  instructions: "",
  enabled: true,
};

export function SkillEditor({
  skill,
  initialDraft,
  mutate,
  notify,
  onClose,
}: {
  skill: Skill | null;
  initialDraft?: SkillDraft;
  mutate: SettingsProps["mutate"];
  notify: SettingsProps["notify"];
  onClose: () => void;
}) {
  const initial = skill ?? initialDraft ?? emptyDraft;
  const [draft, setDraft] = useState<SkillDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  const dirty =
    Boolean(initialDraft) ||
    Object.keys(emptyDraft).some(
      (key) => draft[key as keyof SkillDraft] !== initial[key as keyof SkillDraft],
    );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await mutate(
        skill ? `/skills/${encodeURIComponent(skill.id)}` : "/skills",
        {
          name: draft.name.trim(),
          description: draft.description.trim(),
          instructions: draft.instructions.trim(),
          enabled: draft.enabled,
          ...(skill ? { version: skill.version } : {}),
        },
        skill ? "PATCH" : "POST",
      );
      notify(skill ? "技能已保存" : "技能已添加，可在聊天中调用或绑定给 Agent");
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "保存失败，草稿已保留，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      className="settings-dialog skill-editor"
      title={
        skill ? `编辑 ${skill.name}` : initialDraft ? "检查并保存技能" : "创建技能"
      }
      description="将可复用的创作方法保存为技能，让用户与 Agent 在任务中调用。"
      wide
      busy={saving}
      dirty={dirty}
      onClose={onClose}
    >
      <Form onSubmit={save} aria-busy={saving}>
        <DialogBody className="settings-form-body">
          <fieldset className="settings-form-fields" disabled={saving}>
            <Field
              label="技能名称"
              htmlFor={`${formId}-name`}
              hint="使用小写英文字母、数字与单个连字符，最多 64 字符。"
              validationMessage="请使用小写英文字母、数字与单个连字符，例如 review-drama；不能以连字符开头或结尾。"
            >
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
                maxLength={64}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="review-drama"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="用途说明"
              htmlFor={`${formId}-description`}
              hint="说明何时调用这个技能，以及它能完成什么。"
            >
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                required
                maxLength={1000}
                rows={3}
                className="settings-description-input"
                placeholder="检查剧本节奏、人物动机与结尾悬念…"
              />
            </Field>
            <Field
              label="技能指令"
              htmlFor={`${formId}-instructions`}
              hint={`${draft.instructions.length.toLocaleString()} / 12,000 字符 · 支持 Markdown`}
            >
              <Textarea
                className="skill-instructions"
                value={draft.instructions}
                onChange={(event) =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
                required
                maxLength={12000}
                rows={11}
                placeholder="写下具体步骤、输入输出要求和创作约束…"
              />
            </Field>
            <div className="settings-option-row">
              <div>
                <strong>启用技能</strong>
                <p>
                  启用后可用 ${draft.name.trim() || "技能名称"} 调用，也可在 Agent
                  配置中绑定。
                </p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                label="启用此技能"
              />
            </div>
            {skill && (
              <p className="settings-field-help">
                修改名称后，聊天中需要使用新的 $名称 调用。
              </p>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>取消</DialogClose>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            <Check size={16} />
            保存技能
          </Button>
        </DialogFooter>
      </Form>
    </Dialog>
  );
}
