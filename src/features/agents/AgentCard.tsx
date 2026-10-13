import { ChevronRight, MessageSquareText, Pencil, Sparkles } from "lucide-react";
import { type Agent, type Provider } from "../../types";
import { Button, Switch } from "../../ui";
import { agentIcon } from "./agentIcons";

interface AgentCardProps {
  agent: Agent;
  provider?: Provider;
  projectCount: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

export function AgentCard({
  agent,
  provider,
  projectCount,
  busy,
  onToggle,
  onEdit,
}: AgentCardProps) {
  const Icon = agentIcon(agent.id);
  return (
    <article
      className={`settings-agent-card ${!agent.enabled ? "settings-disabled" : ""}`}
    >
      <div className="settings-agent-card-top">
        <div
          className="settings-agent-avatar"
          style={{
            color: `color-mix(in srgb, ${agent.color || "#6e56cf"} 65%, #383344)`,
            background: `color-mix(in srgb, ${agent.color || "#6e56cf"} 16%, white)`,
          }}
        >
          <Icon size={25} />
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
        <span title={agent.model || provider?.model || "跟随默认模型"}>
          {agent.model || provider?.model || "跟随默认模型"}
        </span>
        {provider && (
          <span className="settings-provider-label" title={provider.name}>
            {provider.name}
          </span>
        )}
      </div>
      <div className="settings-agent-footer">
        <span>
          <MessageSquareText size={14} />
          {projectCount ? `参与 ${projectCount} 个项目` : "等待加入制作组"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`配置 ${agent.name}`}
          onClick={onEdit}
        >
          <Pencil size={14} />
          配置
          <ChevronRight size={14} />
        </Button>
      </div>
    </article>
  );
}
