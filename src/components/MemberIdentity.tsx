import { Bot, UserRound } from "lucide-react";
import { accessLabels, type RosterMember } from "../shared/project-members";
import { Avatar } from "./AgentAvatar";
import "./member-identity.css";

export function MemberAvatar({
  member,
  size = "normal",
}: {
  member: RosterMember;
  size?: "normal" | "small";
}) {
  return member.kind !== "agent" ? (
    <span
      className={`avatar ${size} studio-member-${member.kind}-avatar`}
      aria-hidden="true"
    >
      {member.kind === "bot" ? (
        <Bot size={size === "small" ? 14 : 19} />
      ) : (
        <UserRound size={size === "small" ? 14 : 19} />
      )}
    </span>
  ) : (
    <Avatar agent={member.agent} size={size} />
  );
}

export function MemberKindBadge({ kind }: { kind: RosterMember["kind"] }) {
  return (
    <span className={`studio-member-kind ${kind}`}>
      {kind === "agent" ? "Agent" : kind === "bot" ? "Bot" : "用户"}
    </span>
  );
}

export function MemberAccessBadge({ member }: { member: RosterMember }) {
  return member.access ? (
    <span className="studio-member-access" title="项目权限">
      {accessLabels[member.access]}
    </span>
  ) : null;
}

export function MemberIdentity({
  member,
  size = "normal",
  showRole = true,
}: {
  member: RosterMember;
  size?: "normal" | "small";
  showRole?: boolean;
}) {
  return (
    <span className={`studio-member-identity ${size}`}>
      <MemberAvatar member={member} size={size} />
      <span className="studio-member-body">
        <span className="studio-member-name">
          <strong title={member.name}>{member.name}</strong>
          {member.isSelf && <span className="studio-member-self">我</span>}
          <MemberKindBadge kind={member.kind} />
        </span>
        {showRole && (member.role || member.username) && (
          <small title={member.role || `@${member.username}`}>
            {member.role || `@${member.username}`}
          </small>
        )}
      </span>
    </span>
  );
}
