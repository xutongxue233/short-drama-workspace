import { useCallback, useEffect, useId, useRef, useState } from "react";
import { request } from "../../api";
import type { PublicUser } from "../../types";
import { Button, Dialog, DialogBody, Field, Input, Select } from "../../ui";
import type { AuditEvent, AuthSession } from "./types";
import "./auth.css";

export function AccountDialog({
  user,
  onClose,
  onLogout,
  onSessionChange,
}: {
  user: PublicUser;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onSessionChange: (session: AuthSession) => void;
}) {
  const [tab, setTab] = useState<"account" | "users" | "audit">("account");
  return (
    <Dialog
      title="账户与安全"
      description="管理自己的账户，以及团队的访问权限。"
      onClose={onClose}
      wide={tab !== "account"}
    >
      <DialogBody className="account-body">
        {user.role === "admin" && (
          <nav className="account-tabs" aria-label="账户设置导航">
            {(
              [
                ["account", "我的账户"],
                ["users", "团队账户"],
                ["audit", "安全记录"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-current={tab === value ? "page" : undefined}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {tab === "account" ? (
          <MyAccount
            user={user}
            onLogout={onLogout}
            onSessionChange={onSessionChange}
          />
        ) : tab === "users" && user.role === "admin" ? (
          <TeamAccounts currentUser={user} />
        ) : user.role === "admin" ? (
          <AuditLog />
        ) : null}
      </DialogBody>
    </Dialog>
  );
}

function MyAccount({
  user,
  onLogout,
  onSessionChange,
}: {
  user: PublicUser;
  onLogout: () => Promise<void>;
  onSessionChange: (session: AuthSession) => void;
}) {
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <>
      <div className="account-identity">
        <span className="account-avatar">{user.displayName.slice(0, 1)}</span>
        <div>
          <h3>{user.displayName}</h3>
          <p>
            @{user.username} · {user.kind === "bot" ? "Bot 账户" : "真人账户"} ·{" "}
            {user.role === "admin" ? "系统管理员" : "普通用户"}
          </p>
        </div>
      </div>
      <p className="account-explanation">
        账户身份用于登录和发言。项目内的权限与创作分工由项目成员设置决定。
      </p>
      <form
        className="auth-form"
        aria-label="修改密码"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const next = await request<AuthSession>(
              "/auth/password",
              { currentPassword, newPassword },
              "PATCH",
            );
            setCurrentPassword("");
            setNewPassword("");
            onSessionChange(next);
            setNotice("密码已更新，其他设备上的登录已退出。");
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <h3>修改密码</h3>
        <Field label="当前密码" htmlFor={`${id}-current`}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field
          label="新密码"
          htmlFor={`${id}-new`}
          hint="至少 12 个字符。修改后，其他登录会立即失效。"
        >
          <Input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            disabled={busy}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="account-notice" role="status">
            {notice}
          </p>
        )}
        <Button type="submit" loading={busy}>
          更新密码
        </Button>
      </form>
      <div className="account-signout">
        <span>退出后，当前工作台的内容会清除。</span>
        <Button variant="danger" disabled={busy} onClick={() => void onLogout()}>
          退出登录
        </Button>
      </div>
    </>
  );
}

function TeamAccounts({ currentUser }: { currentUser: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PublicUser | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await request<{ users: PublicUser[] }>(
        "/users",
        undefined,
        "GET",
        { signal },
      );
      if (!signal?.aborted) {
        setUsers(result.users);
        setError("");
      }
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return (
    <>
      <div className="account-section-heading">
        <div>
          <h3>团队账户</h3>
          <p>创建账户后，在项目成员中邀请。普通用户不需要绑定创作角色。</p>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => setEditing("new")}>
          创建账户
        </Button>
      </div>
      {error && (
        <p role="alert" className="auth-error">
          {error}
          <Button size="sm" onClick={() => void reload()}>
            重试
          </Button>
        </p>
      )}
      {loading && <p role="status">正在读取账户…</p>}
      <div className="account-users">
        {users.map((user) => (
          <article className="account-user" key={user.id}>
            <div className="account-user-name">
              <strong>
                {user.displayName}
                {user.id === currentUser.id ? "（你）" : ""}
              </strong>
              <small>@{user.username}</small>
            </div>
            <div className="account-user-meta">
              <span>{user.kind === "human" ? "真人" : "Bot"}</span>
              <span>{user.role === "admin" ? "管理员" : "普通用户"}</span>
              <span className={user.disabled ? "account-disabled" : ""}>
                {user.disabled ? "已停用" : "使用中"}
              </span>
            </div>
            <div className="account-user-actions">
              <Button size="sm" disabled={busy} onClick={() => setEditing(user)}>
                {user.id === currentUser.id ? "编辑名称" : "编辑 / 重置密码"}
              </Button>
              {user.id !== currentUser.id && (
                <Button
                  size="sm"
                  variant={user.disabled ? "secondary" : "danger"}
                  disabled={busy}
                  onClick={async () => {
                    if (pending.current) return;
                    pending.current = true;
                    setBusy(true);
                    setError("");
                    try {
                      await request(
                        `/users/${encodeURIComponent(user.id)}`,
                        { disabled: !user.disabled },
                        "PATCH",
                      );
                      await reload();
                    } catch (failure) {
                      setError((failure as Error).message);
                    } finally {
                      pending.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  {user.disabled ? "启用" : "停用"}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <UserEditor
          key={editing === "new" ? "new" : editing.id}
          user={editing === "new" ? undefined : editing}
          self={editing !== "new" && editing.id === currentUser.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

function UserEditor({
  user,
  self,
  onClose,
  onSaved,
}: {
  user?: PublicUser;
  self: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState<PublicUser["kind"]>("human");
  const [role, setRole] = useState<PublicUser["role"]>(user?.role ?? "user");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return (
    <Dialog
      title={user ? `编辑账户 · ${user.username}` : "创建团队账户"}
      onClose={onClose}
      busy={busy}
    >
      <DialogBody>
        <form
          className="auth-form"
          aria-label={user ? "编辑账户" : "创建团队账户"}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            try {
              await request(
                user ? `/users/${encodeURIComponent(user.id)}` : "/users",
                user
                  ? {
                      displayName: displayName.trim(),
                      ...(!self ? { role } : {}),
                      ...(password ? { password } : {}),
                    }
                  : {
                      username: username.trim(),
                      displayName: displayName.trim(),
                      password,
                      kind,
                      role,
                    },
                user ? "PATCH" : "POST",
              );
              setPassword("");
              await onSaved();
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          {!user && (
            <Field
              label="用户名"
              htmlFor={`${id}-username`}
              hint="3–64 位字母、数字、下划线、短横线或点。"
            >
              <Input
                autoComplete="off"
                required
                maxLength={64}
                pattern={"[A-Za-z0-9_.\\-]{3,64}"}
                disabled={busy}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
          )}
          <Field label="显示名称" htmlFor={`${id}-name`}>
            <Input
              required
              maxLength={80}
              disabled={busy}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          {!user && (
            <Field label="账户类型" htmlFor={`${id}-kind`}>
              <Select
                disabled={busy}
                value={kind}
                onChange={(event) => setKind(event.target.value as PublicUser["kind"])}
              >
                <option value="human">真人用户</option>
                <option value="bot">Bot 账户</option>
              </Select>
            </Field>
          )}
          {!self && (
            <Field
              label="系统权限"
              htmlFor={`${id}-role`}
              hint="项目访问权限在每个项目的成员设置中管理。"
            >
              <Select
                disabled={busy}
                value={role}
                onChange={(event) => setRole(event.target.value as PublicUser["role"])}
              >
                <option value="user">普通用户</option>
                <option value="admin">系统管理员</option>
              </Select>
            </Field>
          )}
          {!self && (
            <Field
              label={user ? "重置密码" : "初始密码"}
              htmlFor={`${id}-password`}
              hint={
                user
                  ? "留空保留原密码；设置新密码会退出该账户的所有登录。"
                  : "至少 12 个字符。通过安全渠道把初始密码交给账户使用者。"
              }
              optional={Boolean(user)}
            >
              <Input
                type="password"
                autoComplete="new-password"
                required={!user}
                minLength={12}
                maxLength={256}
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {user ? "保存账户" : "创建账户"}
          </Button>
        </form>
      </DialogBody>
    </Dialog>
  );
}

const auditLabels: Record<string, string> = {
  "auth.setup": "创建管理员",
  "auth.login": "登录",
  "auth.logout": "退出登录",
  "auth.password.changed": "修改密码",
  "user.created": "创建账户",
  "user.updated": "更新账户",
  "user.password.reset": "重置账户密码",
  "project.created": "创建项目",
  "project.exported": "导出项目",
  "project.participant.added": "邀请项目成员",
  "project.participant.updated": "更新项目成员",
  "project.participant.removed": "移除项目成员",
};
function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await request<{ events: AuditEvent[] }>(
        "/audit",
        undefined,
        "GET",
        { signal },
      );
      if (!signal?.aborted) setEvents(result.events);
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <>
      <div className="account-section-heading">
        <div>
          <h3>最近的安全记录</h3>
          <p>账户与权限相关的操作记录。</p>
        </div>
        <Button size="sm" disabled={loading} onClick={() => void load()}>
          刷新
        </Button>
      </div>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在读取记录…</p>
      ) : !events.length ? (
        <p>暂无记录。</p>
      ) : (
        <ol className="account-audit">
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{auditLabels[event.action] ?? event.action}</strong>
                <span>
                  {event.actorName || "未登录用户"}
                  {event.outcome
                    ? ` · ${event.outcome === "success" ? "成功" : ["failure", "denied"].includes(event.outcome) ? "失败" : event.outcome}`
                    : ""}
                </span>
              </div>
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString("zh-CN")}
              </time>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
