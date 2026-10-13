import { useState } from "react";
import { Search, Settings2 } from "lucide-react";
import { type Agent } from "../../types";
import { Button } from "../../ui";
import { type SettingsProps } from "../../components/settings/types";
import { AgentEditor } from "./AgentEditor";
import { AgentCard } from "./AgentCard";
import { SettingsSearch } from "../../components/settings/SettingsSearch";

import "../../components/settings/settings.css";
import "./agents.css";

export function AgentCenter({ state, mutate, notify }: SettingsProps) {
  const [query, setQuery] = useState("");
  const [showEnabled, setShowEnabled] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const enabledCount = state.agents.filter((item) => item.enabled).length;
  const filtered = state.agents.filter(
    (item) =>
      (!showEnabled || item.enabled) &&
      `${item.name} ${item.role} ${item.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  async function toggle(agent: Agent) {
    setBusy(agent.id);
    try {
      await mutate(`/agents/${agent.id}`, { enabled: !agent.enabled }, "PATCH");
      notify(`${agent.name} 已${agent.enabled ? "停用" : "启用"}`);
    } catch {
      /* The workspace displays API errors. */
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="settings-page">
      <div className="settings-page-heading">
        <h1>Agent 中心</h1>
        <span className="settings-count">
          <span />
          {enabledCount} 位已启用
        </span>
      </div>
      <div className="settings-toolbar">
        <SettingsSearch
          label="搜索 Agent"
          placeholder="搜索成员、职责…"
          value={query}
          onChange={setQuery}
          clearLabel="清除搜索"
        />
        <button
          className={`settings-filter-button ${showEnabled ? "is-active" : ""}`}
          onClick={() => setShowEnabled(!showEnabled)}
          aria-pressed={showEnabled}
        >
          <Settings2 size={15} />
          {showEnabled ? "仅看已启用" : "全部成员"}
        </button>
        <span className="settings-result-count" role="status">
          {filtered.length} 位成员
        </span>
      </div>
      <div className="settings-agent-grid">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            provider={state.providers.find((item) => item.id === agent.providerId)}
            projectCount={
              (state.projectSummaries ?? state.projects).filter((project) =>
                project.members.includes(agent.id),
              ).length
            }
            busy={busy !== null}
            onToggle={() => {
              void toggle(agent);
            }}
            onEdit={() => {
              if (!busy) setEditing(agent);
            }}
          />
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state settings-empty">
          <Search size={30} />
          <h3>没有找到匹配的成员</h3>
          <p>试试其他关键词，或查看全部成员。</p>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setShowEnabled(false);
            }}
          >
            清除筛选
          </Button>
        </div>
      )}
      {editing && (
        <AgentEditor
          agent={editing}
          providers={state.providers}
          skills={state.skills ?? []}
          mutate={mutate}
          notify={notify}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
