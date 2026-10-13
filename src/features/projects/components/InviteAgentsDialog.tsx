import { ArrowUpRight, Plus, UsersRound } from "lucide-react";
import { MemberIdentity } from "../../../components/MemberIdentity";
import type { Action } from "../../../shared/contracts";
import { memberById, projectMembers } from "../../../shared/project-members";
import type { Agent, Project } from "../../../types";
import { Button, Dialog, DialogBody } from "../../../ui";
import "../styles/project-members.css";

export function InviteAgentsDialog({
  project,
  agents,
  busy,
  onAction,
  onClose,
  onActivity,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onClose: () => void;
  onActivity?: (agentId?: string) => void;
}) {
  const path = `/projects/${project.id}`;
  const members = projectMembers(project, agents);
  const available = agents.filter(
    (agent, index) =>
      agent.id !== "user" &&
      !project.members.includes(agent.id) &&
      agents.findIndex((entry) => entry.id === agent.id) === index,
  );
  const agentCount = members.filter((member) => member.kind === "agent").length;
  return (
    <Dialog
      title="群成员"
      description={`${project.name} · ${members.length} 人`}
      onClose={onClose}
      busy={busy}
      className="project-members-dialog"
    >
      <DialogBody>
        <section aria-labelledby="joined-members-heading">
          <div className="project-roster-heading">
            <h3 id="joined-members-heading">已加入</h3>
            <span>
              共 {members.length} 位成员 · {agentCount} 位 Agent
            </span>
          </div>
          <ul className="project-roster-list">
            {members.map((member) => {
              const identity = (
                <>
                  <MemberIdentity member={member} />
                  {member.agent && !member.agent.enabled && (
                    <span className="project-roster-note">已停用</span>
                  )}
                  {onActivity && <ArrowUpRight size={16} />}
                </>
              );
              return (
                <li className="project-roster-row joined" key={member.id}>
                  {onActivity ? (
                    <button
                      className="project-roster-person"
                      aria-label={`查看 ${member.name} 的工作记录`}
                      onClick={() => onActivity(member.id)}
                      disabled={busy}
                    >
                      {identity}
                    </button>
                  ) : (
                    <div className="project-roster-person">{identity}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section
          className="project-roster-available"
          aria-labelledby="available-members-heading"
        >
          <div className="project-roster-heading">
            <h3 id="available-members-heading">添加成员</h3>
            <span>来自 Agent 中心</span>
          </div>
          <p className="project-roster-explanation">
            根据分工邀请成员，加入后即可在群聊中 @ 对方。
          </p>
          {available.length ? (
            <ul className="project-roster-list">
              {available.map((agent) => {
                const member = memberById(agent.id, agents)!;
                return (
                  <li className="project-roster-row available" key={agent.id}>
                    <div className="project-roster-candidate">
                      <MemberIdentity member={member} />
                      {agent.description && (
                        <p title={agent.description}>{agent.description}</p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!agent.enabled || busy}
                      aria-label={
                        agent.enabled
                          ? `邀请 ${agent.name} 加入群聊`
                          : `${agent.name} 未启用`
                      }
                      onClick={() =>
                        void onAction(
                          `${path}/invite`,
                          { agentId: agent.id },
                          `${agent.name} 已加入群聊`,
                        )
                      }
                    >
                      {agent.enabled && <Plus size={13} />}
                      {agent.enabled ? "邀请" : "未启用"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="project-roster-empty">
              <UsersRound size={18} />
              <p>现有 Agent 均已加入群聊。</p>
            </div>
          )}
        </section>
      </DialogBody>
    </Dialog>
  );
}
