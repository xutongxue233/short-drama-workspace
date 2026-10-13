import { useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { type Agent } from "../../types";
import { Button, Select } from "../../ui";
import { type SettingsProps } from "../../components/settings/types";
import { AgentEditor } from "./AgentEditor";
import { AgentCard } from "./AgentCard";
import { DeleteAgentDialog } from "./DeleteAgentDialog";
import { isBuiltInAgent } from "./agentConfig";
import { SettingsSearch } from "../../components/settings/SettingsSearch";

import "../../components/settings/settings.css";
import "./agents.css";

type EditorState = { agent?: Agent; copyFrom?: Agent };

export function AgentCenter({ state, mutate, notify }: SettingsProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const enabledCount = state.agents.filter((item) => item.enabled).length;
  const filtered = state.agents.filter(
    (item) =>
      (status === "all" || item.enabled === (status === "enabled")) &&
      (kind === "all" || isBuiltInAgent(item) === (kind === "builtin")) &&
      `${item.name} ${item.role} ${item.description} ${item.model}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const projectCount = (agent: Agent) =>
    (state.projectSummaries ?? state.projects).filter((project) =>
      project.members.includes(agent.id),
    ).length;
  function clearFilters() {
    setQuery("");
    setStatus("all");
    setKind("all");
  }
  async function toggle(agent: Agent) {
    if (busy) return;
    setBusy(agent.id);
    setError("");
    try {
      await mutate(`/agents/${agent.id}`, { enabled: !agent.enabled }, "PATCH");
      notify(`${agent.name} 已${agent.enabled ? "停用" : "启用"}`);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "更新启用状态失败，请稍后重试。",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="settings-page agent-center">
      <div className="settings-page-heading">
        <div>
          <h1>Agent 中心</h1>
          <p>维护创作成员的职责与模型，为制作组增添专长。</p>
        </div>
        <div className="agent-heading-actions">
          <span className="settings-count">
            <span />
            {enabledCount} 位已启用
          </span>
          <Button
            variant="primary"
            disabled={busy !== null}
            onClick={() => setEditing({})}
          >
            <Plus size={16} />
            新增 Agent
          </Button>
        </div>
      </div>
      <div className="settings-toolbar agent-toolbar">
        <SettingsSearch
          label="搜索 Agent"
          placeholder="搜索成员、职责、模型…"
          value={query}
          onChange={setQuery}
          clearLabel="清除搜索"
        />
        <Select
          aria-label="启用状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="agent-filter-select"
        >
          <option value="all">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </Select>
        <Select
          aria-label="成员类型"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="agent-filter-select"
        >
          <option value="all">全部类型</option>
          <option value="builtin">内置成员</option>
          <option value="custom">自定义成员</option>
        </Select>
        <span className="settings-result-count" role="status">
          {filtered.length} / {state.agents.length} 位成员
        </span>
      </div>
      {error && (
        <p className="agent-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-agent-grid">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            provider={state.providers.find((item) => item.id === agent.providerId)}
            projectCount={projectCount(agent)}
            busy={busy !== null}
            onToggle={() => void toggle(agent)}
            onEdit={() => {
              if (!busy) setEditing({ agent });
            }}
            onCopy={() => {
              if (!busy) setEditing({ copyFrom: agent });
            }}
            onDelete={() => {
              if (!busy && !isBuiltInAgent(agent)) setDeleting(agent);
            }}
          />
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state settings-empty">
          {state.agents.length ? <Search size={30} /> : <Users size={30} />}
          <h3>{state.agents.length ? "没有找到匹配的成员" : "创建你的第一位 Agent"}</h3>
          <p>
            {state.agents.length
              ? "试试其他关键词，或查看全部成员。"
              : "设置职责和工作方式，再邀请成员进入项目参与讨论。"}
          </p>
          {state.agents.length ? (
            <Button variant="secondary" onClick={clearFilters}>
              清除筛选
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setEditing({})}>
              创建 Agent
            </Button>
          )}
        </div>
      )}
      {editing && (
        <AgentEditor
          {...editing}
          agents={state.agents}
          providers={state.providers}
          skills={state.skills ?? []}
          mutate={mutate}
          notify={notify}
          onSaved={editing.agent ? undefined : clearFilters}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          projectCount={projectCount(deleting)}
          mutate={mutate}
          notify={notify}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
