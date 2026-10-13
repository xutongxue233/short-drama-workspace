import { useState } from "react";
import {
  BookOpen,
  Download,
  FileUp,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { request } from "../../api";
import type { Skill } from "../../types";
import type { SettingsProps } from "../../components/settings/types";
import { SettingsSearch } from "../../components/settings/SettingsSearch";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  IconButton,
  Switch,
} from "../../ui";
import { SkillEditor, STORY_REVIEW_TEMPLATE, type SkillDraft } from "./SkillEditor";
import { SkillImport } from "./SkillImport";
import "../../components/settings/settings.css";
import "./skills.css";

export function SkillCenter({ state, mutate, notify }: SettingsProps) {
  const skills = state.skills ?? [];
  const [query, setQuery] = useState("");
  const [showEnabled, setShowEnabled] = useState(false);
  const [editor, setEditor] = useState<{
    skill: Skill | null;
    initialDraft?: SkillDraft;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [error, setError] = useState("");
  const filtered = skills.filter(
    (skill) =>
      (!showEnabled || skill.enabled) &&
      `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  async function toggle(skill: Skill) {
    if (busy) return;
    setBusy(skill.id);
    setError("");
    try {
      await mutate(
        `/skills/${encodeURIComponent(skill.id)}`,
        { enabled: !skill.enabled, version: skill.version },
        "PATCH",
      );
      notify(`${skill.name} 已${skill.enabled ? "停用" : "启用"}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新技能状态失败，请重试。");
    } finally {
      setBusy(null);
    }
  }
  async function download(skill: Skill) {
    if (busy) return;
    setBusy(skill.id);
    setError("");
    try {
      const result = await request<{ filename: string; content: string }>(
        `/skills/${encodeURIComponent(skill.id)}/export`,
        undefined,
        "GET",
      );
      const url = URL.createObjectURL(
        new Blob([result.content], { type: "text/markdown;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("SKILL.md 已导出");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(deleting.id);
    setDeleteError("");
    try {
      await mutate(
        `/skills/${encodeURIComponent(deleting.id)}`,
        { version: deleting.version },
        "DELETE",
      );
      notify(`${deleting.name} 已删除`);
      setDeleting(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "删除失败，请重试。");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="settings-page skill-center">
      <div className="settings-page-heading">
        <div>
          <h1>技能库</h1>
          <p>维护创作方法，让每次协作都有章可循。</p>
        </div>
        <div className="skill-heading-actions">
          <Button disabled={!!busy} onClick={() => setImporting(true)}>
            <FileUp size={16} />
            导入 SKILL.md
          </Button>
          <Button
            variant="primary"
            disabled={!!busy}
            onClick={() => setEditor({ skill: null })}
          >
            <Plus size={16} />
            创建技能
          </Button>
        </div>
      </div>
      <div className="skill-usage-note">
        <BookOpen size={20} aria-hidden="true" />
        <p>
          在项目群聊切换为「仅讨论」，输入 <code>$技能名称</code>
          并写下任务即可调用；也可用「调用技能」菜单自动切换。管理员可以在 Agent
          配置中绑定技能，供它在聊天与制作时使用。
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {skills.length > 0 && (
        <div className="settings-toolbar">
          <SettingsSearch
            label="搜索技能"
            placeholder="搜索名称、用途…"
            value={query}
            onChange={setQuery}
            clearLabel="清除技能搜索"
          />
          <button
            className={`settings-filter-button ${showEnabled ? "is-active" : ""}`}
            onClick={() => setShowEnabled(!showEnabled)}
            aria-pressed={showEnabled}
          >
            <Settings2 size={15} />
            {showEnabled ? "仅看已启用" : "全部技能"}
          </button>
          <span className="settings-result-count" role="status">
            {filtered.length} 个技能 · {skills.filter((skill) => skill.enabled).length}{" "}
            个已启用
          </span>
        </div>
      )}
      <div className="skill-grid">
        {filtered.map((skill) => {
          const agents = state.agents.filter((agent) =>
            agent.skillIds?.includes(skill.id),
          );
          return (
            <article
              key={skill.id}
              className={`skill-card ${skill.enabled ? "" : "skill-card-disabled"}`}
              aria-label={`技能 ${skill.name}`}
            >
              <div className="skill-card-top">
                <span className="skill-symbol">
                  <BookOpen size={20} />
                </span>
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={() => void toggle(skill)}
                  label={`${skill.enabled ? "停用" : "启用"}技能 ${skill.name}`}
                  disabled={!!busy}
                />
              </div>
              <h2>{skill.name}</h2>
              <p className="skill-card-description">{skill.description}</p>
              <div className="skill-card-metadata">
                <Badge tone={skill.enabled ? "success" : "neutral"}>
                  {skill.enabled ? "已启用" : "已停用"}
                </Badge>
                <span>版本 {skill.version}</span>
              </div>
              <p
                className="skill-card-bindings"
                title={agents.map((agent) => agent.name).join("、")}
              >
                {agents.length
                  ? `已绑定：${agents.map((agent) => agent.name).join("、")}`
                  : "尚未绑定 Agent · 可在聊天中直接调用"}
              </p>
              <div className="skill-card-footer">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setEditor({ skill })}
                  aria-label={`编辑技能 ${skill.name}`}
                >
                  编辑技能
                </Button>
                <div>
                  <IconButton
                    label={`导出 ${skill.name} 的 SKILL.md`}
                    disabled={!!busy}
                    onClick={() => void download(skill)}
                  >
                    <Download size={16} />
                  </IconButton>
                  <IconButton
                    label={`删除技能 ${skill.name}`}
                    disabled={!!busy}
                    onClick={() => {
                      setDeleteError("");
                      setDeleting(skill);
                    }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!skills.length ? (
        <div className="skill-empty">
          <span className="skill-empty-symbol">
            <BookOpen size={32} />
          </span>
          <h2>把好方法变成可复用的技能</h2>
          <p>保存剧本审阅、人物塑造或分镜设计的方法，按需调用，也能分配给创作成员。</p>
          <Button
            onClick={() =>
              setEditor({ skill: null, initialDraft: STORY_REVIEW_TEMPLATE })
            }
          >
            <Plus size={16} />
            从「短剧剧本审阅」模板开始
          </Button>
          <span>打开后可编辑，保存时才会加入技能库。</span>
        </div>
      ) : (
        !filtered.length && (
          <div className="skill-empty">
            <Search size={30} />
            <h2>没有找到匹配的技能</h2>
            <p>试试其他关键词，或查看全部技能。</p>
            <Button
              onClick={() => {
                setQuery("");
                setShowEnabled(false);
              }}
            >
              清除筛选
            </Button>
          </div>
        )
      )}
      {editor && (
        <SkillEditor
          skill={editor.skill}
          initialDraft={editor.initialDraft}
          mutate={mutate}
          notify={notify}
          onClose={() => setEditor(null)}
        />
      )}
      {importing && (
        <SkillImport
          onClose={() => setImporting(false)}
          onParsed={(initialDraft) => {
            setImporting(false);
            setEditor({ skill: null, initialDraft });
          }}
        />
      )}
      {deleting && (
        <Dialog
          title={`删除 ${deleting.name}？`}
          description="删除后将解除 Agent 绑定，聊天也无法再调用这个技能。"
          busy={!!busy}
          onClose={() => setDeleting(null)}
        >
          <DialogBody>
            <p className="skill-delete-note">
              {state.agents.filter((agent) => agent.skillIds?.includes(deleting.id))
                .length
                ? `当前绑定：${state.agents
                    .filter((agent) => agent.skillIds?.includes(deleting.id))
                    .map((agent) => agent.name)
                    .join("、")}。`
                : "这个技能尚未绑定 Agent。"}{" "}
              如需保留内容，可先取消并导出 SKILL.md。
            </p>
            {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          </DialogBody>
          <DialogFooter>
            <DialogClose>取消</DialogClose>
            <Button variant="danger" loading={!!busy} onClick={() => void remove()}>
              确认删除
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
