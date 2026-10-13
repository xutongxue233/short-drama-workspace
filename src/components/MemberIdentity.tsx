import { UserRound } from "lucide-react";
import type { RosterMember } from "../shared/project-members";
import { Avatar } from "./AgentAvatar";
import "./member-identity.css";

export function MemberAvatar({
  member,
  size = "normal",
}: {
  member: RosterMember;
  size?: "normal" | "small";
}) {
  return member.kind === "human" ? (
    <span className={`avatar ${size} studio-member-human-avatar`} aria-hidden="true">
      <UserRound size={size === "small" ? 14 : 19} />
    </span>
  ) : (
    <Avatar agent={member.agent} size={size} />
  );
}

export function MemberKindBadge({ kind }: { kind: RosterMember["kind"] }) {
  if (kind === "human") return null;
  return <span className={`studio-member-kind ${kind}`}>Agent</span>;
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
          <MemberKindBadge kind={member.kind} />
        </span>
        {showRole && <small title={member.role}>{member.role}</small>}
      </span>
    </span>
  );
}
