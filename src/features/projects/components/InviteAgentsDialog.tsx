import { ArrowUpRight, Plus, UsersRound } from "lucide-react";
import { useId, useState } from "react";
import { MemberAccessBadge, MemberIdentity } from "../../../components/MemberIdentity";
import type { Action } from "../../../shared/contracts";
import {
  accessLabels,
  memberById,
  projectMembers,
  projectPermissions,
} from "../../../shared/project-members";
import type { Agent, Project, ProjectParticipant, PublicUser } from "../../../types";
import { Button, Dialog, DialogBody, Field, Input, Select } from "../../../ui";
import "../styles/project-members.css";

type EditableAccess = Exclude<ProjectParticipant["access"], "owner">;

export function InviteAgentsDialog({
  project,
  agents,
  busy,
  onAction,
  onClose,
  onActivity,
  currentUser,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onClose: () => void;
  onActivity?: (agentId?: string) => void;
  currentUser?: PublicUser;
}) {
  const fieldId = useId();
  const [username, setUsername] = useState("");
  const [access, setAccess] = useState<EditableAccess>("member");
  const [jobTitle, setJobTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const path = `/projects/${project.id}`;
  const { canEdit, canManageMembers } = projectPermissions(project);
  const members = projectMembers(project, agents, currentUser?.id);
  const available = agents.filter(
    (agent, index) =>
      agent.id !== "user" &&
      !project.members.includes(agent.id) &&
      agents.findIndex((entry) => entry.id === agent.id) === index,
  );
  const count = (kind: "human" | "agent" | "bot") =>
    members.filter((member) => member.kind === kind).length;
  const clearForm = () => {
    setEditingId(null);
    setUsername("");
    setAccess("member");
    setJobTitle("");
  };
  const saveParticipant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || !canManageMembers || (!editingId && !username.trim())) return;
    setSaving(true);
    try {
      const ok = await onAction(
        editingId
          ? `${path}/participants/${encodeURIComponent(editingId)}`
          : `${path}/participants`,
        {
          ...(!editingId ? { username: username.trim() } : {}),
          access,
          jobTitle: jobTitle.trim(),
        },
        editingId ? "成员设置已保存" : "成员已加入群聊",
        editingId ? "PATCH" : "POST",
      );
      if (ok) clearForm();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="群成员"
      description={`${project.name} · ${members.length} 位成员`}
      onClose={onClose}
      busy={locked}
      className="project-members-dialog"
    >
      <DialogBody>
        <section aria-labelledby="joined-members-heading">
          <div className="project-roster-heading">
            <h3 id="joined-members-heading">已加入</h3>
            <span>
              {count("human")} 位用户 · {count("agent")} 位 Agent
              {count("bot") ? ` · ${count("bot")} 位 Bot` : ""}
            </span>
          </div>
          <p className="project-roster-explanation">
            身份、分工与项目权限分别显示。普通用户无需设置职业分工。
          </p>
          <ul className="project-roster-list">
            {members.map((member) => (
              <li
                className="project-roster-row joined"
                key={`${member.kind}:${member.id}`}
              >
                <div className="project-roster-person">
                  <MemberIdentity member={member} />
                  <MemberAccessBadge member={member} />
                  {member.agent && !member.agent.enabled && (
                    <span className="project-roster-note">已停用</span>
                  )}
                  {onActivity && (
                    <button
                      className="project-roster-record"
                      aria-label={`查看 ${member.name} 的工作记录`}
                      onClick={() => onActivity(member.id)}
                      disabled={locked}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
                {canManageMembers && member.access && member.access !== "owner" && (
                  <div className="project-participant-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => {
                        setEditingId(member.id);
                        setUsername(member.name);
                        setAccess(member.access as EditableAccess);
                        setJobTitle(member.role);
                        setRemovingId(null);
                      }}
                      aria-label={`修改 ${member.name} 的权限`}
                    >
                      设置
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked}
                      aria-label={`${removingId === member.id ? "确认移除" : "移除"} ${member.name}`}
                      onClick={async () => {
                        if (removingId !== member.id) {
                          setRemovingId(member.id);
                          return;
                        }
                        setSaving(true);
                        try {
                          if (
                            await onAction(
                              `${path}/participants/${encodeURIComponent(member.id)}`,
                              undefined,
                              "成员已移出项目",
                              "DELETE",
                            )
                          ) {
                            setRemovingId(null);
                            if (editingId === member.id) clearForm();
                          }
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {removingId === member.id ? "确认移除" : "移除"}
                    </Button>
                    {removingId === member.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemovingId(null)}
                      >
                        取消
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
        {canManageMembers && (
          <section
            className="project-roster-available"
            aria-labelledby={`${fieldId}-people-heading`}
          >
            <div className="project-roster-heading">
              <h3 id={`${fieldId}-people-heading`}>
                {editingId ? `设置成员：${username}` : "添加用户或 Bot"}
              </h3>
            </div>
            <p className="project-roster-explanation">
              通过已有账号的用户名添加。分工只是介绍，不会改变项目权限。
            </p>
            <form
              className="project-participant-form"
              onSubmit={(event) => void saveParticipant(event)}
            >
              {!editingId && (
                <Field label="用户名" htmlFor={`${fieldId}-username`}>
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    maxLength={64}
                    required
                    autoComplete="off"
                    placeholder="例如 editor.lin"
                    disabled={locked}
                  />
                </Field>
              )}
              <Field
                label="项目权限"
                htmlFor={`${fieldId}-access`}
                hint={
                  access === "editor"
                    ? "可制作、编辑资产、使用 Agent 并参与群聊。"
                    : access === "member"
                      ? "可参与群聊和查看成果，不能修改项目或调用 Agent。"
                      : "只能查看项目内容。"
                }
              >
                <Select
                  value={access}
                  onChange={(event) => setAccess(event.target.value as EditableAccess)}
                  disabled={locked}
                >
                  {(["member", "editor", "viewer"] as const).map((value) => (
                    <option key={value} value={value}>
                      {accessLabels[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="项目分工"
                htmlFor={`${fieldId}-job`}
                optional
                hint="例如剪辑师；留空即为普通成员。"
              >
                <Input
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  maxLength={60}
                  placeholder="无需绑定职业角色"
                  disabled={locked}
                />
              </Field>
              <div className="project-participant-form-actions">
                {editingId && (
                  <Button variant="ghost" disabled={locked} onClick={clearForm}>
                    取消编辑
                  </Button>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={locked || (!editingId && !username.trim())}
                >
                  {editingId ? "保存成员设置" : "添加到群聊"}
                </Button>
              </div>
            </form>
          </section>
        )}
        {canEdit && (
          <section
            className="project-roster-available"
            aria-labelledby="available-members-heading"
          >
            <div className="project-roster-heading">
              <h3 id="available-members-heading">添加 Agent</h3>
              <span>来自 Agent 中心</span>
            </div>
            <p className="project-roster-explanation">
              Agent 负责 AI 创作，加入后可以通过 @ 请求回复。
            </p>
            {available.length ? (
              <ul className="project-roster-list">
                {available.map((agent) => (
                  <li className="project-roster-row available" key={agent.id}>
                    <div className="project-roster-candidate">
                      <MemberIdentity member={memberById(agent.id, agents)!} />
                      {agent.description && (
                        <p title={agent.description}>{agent.description}</p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!agent.enabled || locked}
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
                ))}
              </ul>
            ) : (
              <div className="project-roster-empty">
                <UsersRound size={18} />
                <p>现有 Agent 均已加入群聊。</p>
              </div>
            )}
          </section>
        )}
      </DialogBody>
    </Dialog>
  );
}
