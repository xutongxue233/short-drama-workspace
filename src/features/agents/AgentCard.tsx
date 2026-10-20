import {
  Copy,
  MessageSquareText,
  Monitor,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type Agent, type Computer, type Provider } from "../../types";
import { Button, IconButton, Switch } from "../../ui";
import { agentIcon } from "./agentIcons";
import { isBuiltInAgent } from "./agentConfig";

interface AgentCardProps {
  agent: Agent;
  provider?: Provider;
  projectCount: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  computer?: Computer;
  onViewComputer?: () => void;
}

export function AgentCard({
  agent,
  provider,
  projectCount,
  busy,
  onToggle,
  onEdit,
  onCopy,
  onDelete,
  computer,
  onViewComputer,
}: AgentCardProps) {
  const Icon = agentIcon(agent.id);
  return (
    <article
      aria-label={agent.name}
      className={`settings-agent-card ${!agent.enabled ? "settings-disabled" : ""}`}
    >
      <div className="settings-agent-card-top">
        <div className="agent-card-identity">
          <div
            className="settings-agent-avatar"
            style={{
              color: `color-mix(in srgb, ${agent.color || "#6e56cf"} 65%, #383344)`,
              background: `color-mix(in srgb, ${agent.color || "#6e56cf"} 16%, white)`,
            }}
          >
            <Icon size={25} />
          </div>
          <span className="agent-kind-label">
            {isBuiltInAgent(agent) ? "内置" : "自定义"}
          </span>
        </div>
        <Switch
          checked={agent.enabled}
          onCheckedChange={() => {
            onToggle();
          }}
          disabled={busy}
          label={`${agent.enabled ? "停用" : "启用"}${agent.name}`}
        />
      </div>
      <div className="settings-agent-name">
        <h2 title={agent.name}>{agent.name}</h2>
        <span className="settings-role-label" title={agent.role}>
          {agent.role}
        </span>
      </div>
      <p className="settings-agent-description" title={agent.description}>
        {agent.description || "配置这个 Agent 的工作职责与创作方式。"}
      </p>
      <div className="settings-agent-binding">
        <Sparkles size={14} />
        <span title={agent.model || provider?.model || "尚未配置模型"}>
          {agent.model || provider?.model || "尚未配置模型"}
        </span>
        {provider && (
          <span className="settings-provider-label" title={provider.name}>
            {provider.name}
          </span>
        )}
      </div>
      {(!provider || !provider.enabled) && (
        <p className="agent-binding-note">
          {provider ? "模型服务已停用" : "请配置模型服务后使用"}
        </p>
      )}
      {agent.computerId && (
        <div className="agent-computer-binding">
          <Monitor size={15} />
          <span>
            <strong>{computer?.name ?? "已绑定电脑"}</strong>
            {computer?.control.mode === "human" && (
              <small>人工接管中 · Agent 已暂停</small>
            )}
          </span>
          {onViewComputer && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onViewComputer}
              aria-label={`查看 ${agent.name} 的电脑`}
            >
              查看电脑
            </Button>
          )}
        </div>
      )}
      <div className="settings-agent-footer">
        <span>
          <MessageSquareText size={14} />
          {projectCount ? `参与 ${projectCount} 个项目` : "等待加入制作组"}
        </span>
        <div className="agent-card-actions">
          <IconButton label={`复制 ${agent.name}`} disabled={busy} onClick={onCopy}>
            <Copy size={14} />
          </IconButton>
          {!isBuiltInAgent(agent) && (
            <IconButton label={`删除 ${agent.name}`} disabled={busy} onClick={onDelete}>
              <Trash2 size={14} />
            </IconButton>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`配置 ${agent.name}`}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil size={14} />
            配置
          </Button>
        </div>
      </div>
    </article>
  );
}
