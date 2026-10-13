import { Clapperboard, KeyRound, UsersRound } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError, onSessionExpired, request, setApiSession } from "../../api";
import type { PublicUser } from "../../types";
import { Alert, Button, Field, Form, Input } from "../../ui";
import type { AuthSession } from "./types";
import "./auth.css";

export interface AuthenticatedWorkspaceProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
  onSessionChange: (session: AuthSession) => void;
}

function clearWorkspaceStorage() {
  try {
    localStorage.removeItem("yingxu-project");
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("yingxu-draft-")) sessionStorage.removeItem(key);
  } catch {
    /* The workspace also works with storage disabled. */
  }
}

export function AuthBoundary({
  children,
}: {
  children: (props: AuthenticatedWorkspaceProps) => ReactNode;
}) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  const mounted = useRef(false);
  const currentSession = useRef<AuthSession | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const loggingOut = useRef(false);
  const applySession = useCallback((next: AuthSession) => {
    if (currentSession.current?.user?.id !== next.user?.id) clearWorkspaceStorage();
    currentSession.current = next;
    setApiSession(next.csrfToken, next.user?.id);
    setSession(next);
    setError("");
  }, []);
  const loadSession = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const next = await request<AuthSession>("/auth/session", undefined, "GET", {
          signal,
        });
        if (mounted.current && !signal?.aborted) applySession(next);
      } catch (failure) {
        if (mounted.current && !signal?.aborted) setError((failure as Error).message);
      } finally {
        if (mounted.current && !signal?.aborted) setLoading(false);
      }
    },
    [applySession],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const unsubscribe = onSessionExpired(() => {
      clearWorkspaceStorage();
      currentSession.current = null;
      setSession({ setupRequired: false, user: null });
      setLoading(false);
      setError("登录已失效，请重新登录。未提交的内容已从当前工作台清除。");
    });
    void loadSession(controller.signal);
    const revalidate = async () => {
      if (loggingOut.current || document.visibilityState === "hidden") return;
      try {
        const next = await request<AuthSession>("/auth/session", undefined, "GET", {
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          (next.user?.id !== currentSession.current?.user?.id ||
            next.csrfToken !== currentSession.current?.csrfToken)
        )
          applySession(next);
      } catch {
        /* The next protected request also checks session validity. */
      }
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("yingxu-auth");
      channel.current.onmessage = () => {
        clearWorkspaceStorage();
        currentSession.current = null;
        setApiSession();
        setSession({ setupRequired: false, user: null });
        setError("其他窗口的登录状态已变化，请重新登录或刷新状态。");
      };
    }
    return () => {
      mounted.current = false;
      controller.abort();
      unsubscribe();
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      channel.current?.close();
      channel.current = null;
    };
  }, [applySession, loadSession]);
  const changeSession = (next: AuthSession) => {
    applySession(next);
    channel.current?.postMessage("changed");
  };
  const logout = async () => {
    // Hide all account-bound UI immediately, even if the server is unreachable.
    setSession({ setupRequired: false, user: null });
    clearWorkspaceStorage();
    currentSession.current = null;
    loggingOut.current = true;
    setLoading(true);
    setLogoutPending(true);
    try {
      await request("/auth/logout", {});
      setApiSession();
      channel.current?.postMessage("changed");
      loggingOut.current = false;
      setLogoutPending(false);
      setError("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        loggingOut.current = false;
        setLogoutPending(false);
      } else if (failure instanceof DOMException && failure.name === "AbortError") {
        loggingOut.current = false;
        setLogoutPending(false);
        setError("登录状态已变化，请重新登录或刷新状态。");
      } else {
        setError(`退出尚未完成：${(failure as Error).message}`);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  if (session?.user && !loading)
    return children({
      user: session.user,
      onLogout: logout,
      onSessionChange: changeSession,
    });
  return (
    <main className="auth-screen">
      <section className="auth-story" aria-label="映序创作工作台">
        <div className="auth-brand">
          <span className="brand-mark">
            <Clapperboard size={25} />
          </span>
          <span>
            映序 <small>STUDIO</small>
          </span>
        </div>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">一起，把故事拍出来</span>
          <h1>
            每个人，都有
            <br />
            自己的创作席位。
          </h1>
          <p>
            剪辑师、创作者、普通成员与 AI 助手，
            <br />
            在同一个项目群聊协作。
          </p>
        </div>
        <div className="auth-story-note">
          <UsersRound size={19} />
          <span>独立账户 · 项目成员权限 · 清晰的发言身份</span>
        </div>
      </section>
      <section className="auth-panel" aria-label="账户登录">
        {loading ? (
          <div role="status" className="auth-loading">
            {logoutPending ? "正在退出账户…" : "正在验证登录状态…"}
          </div>
        ) : logoutPending ? (
          <>
            <h2>完成退出</h2>
            <Alert tone="danger">{error}</Alert>
            <Button variant="primary" onClick={() => void logout()}>
              重试退出
            </Button>
          </>
        ) : session ? (
          <LoginForm
            setupRequired={session.setupRequired}
            notice={error}
            onAuthenticated={changeSession}
            onRefresh={() => void loadSession()}
          />
        ) : (
          <>
            <h2>暂时无法连接工作台</h2>
            <Alert tone="danger">{error}</Alert>
            <Button variant="primary" onClick={() => void loadSession()}>
              重新连接
            </Button>
          </>
        )}
      </section>
    </main>
  );
}

function LoginForm({
  setupRequired,
  notice,
  onAuthenticated,
  onRefresh,
}: {
  setupRequired: boolean;
  notice: string;
  onAuthenticated: (session: AuthSession) => void;
  onRefresh: () => void;
}) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return (
    <>
      <span className="auth-eyebrow">
        <KeyRound size={15} />
        {setupRequired ? "首次启用" : "欢迎回到工作台"}
      </span>
      <h2>{setupRequired ? "创建管理员账户" : "登录映序"}</h2>
      <p className="auth-description">
        {setupRequired
          ? "管理员负责创建团队账户。创建后，已有项目将归入此账户。"
          : "使用管理员为你创建的账户，进入有你参与的项目。"}
      </p>
      <Form
        className="auth-form"
        aria-label={setupRequired ? "创建管理员账户" : "登录账户"}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            const next = await request<AuthSession>(
              setupRequired ? "/auth/setup" : "/auth/login",
              {
                username: username.trim(),
                password,
                ...(setupRequired
                  ? {
                      displayName: displayName.trim(),
                      ...(setupToken ? { setupToken } : {}),
                    }
                  : {}),
              },
            );
            setPassword("");
            onAuthenticated(next);
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <Field
          label="用户名"
          htmlFor={`${id}-username`}
          hint={setupRequired ? "3–64 位字母、数字、下划线、短横线或点。" : undefined}
          validationMessage="用户名须为 3–64 位字母、数字、下划线、短横线或点，例如 editor_01。"
        >
          <Input
            name="username"
            autoComplete="username"
            required
            maxLength={64}
            pattern={"[A-Za-z0-9_.\\-]{3,64}"}
            value={username}
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        {setupRequired && (
          <Field
            label="显示名称"
            htmlFor={`${id}-name`}
            hint="在群聊中展示给其他成员。"
          >
            <Input
              name="displayName"
              autoComplete="nickname"
              required
              maxLength={80}
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
        )}
        <Field
          label="密码"
          htmlFor={`${id}-password`}
          hint={setupRequired ? "至少 12 个字符，建议使用独立的长密码。" : undefined}
        >
          <Input
            type="password"
            name="password"
            autoComplete={setupRequired ? "new-password" : "current-password"}
            required
            minLength={setupRequired ? 12 : undefined}
            maxLength={256}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {setupRequired && (
          <Field
            label="初始化密钥"
            htmlFor={`${id}-setup-token`}
            optional
            hint="远程部署时，由部署者提供。本机未配置时可留空。"
          >
            <Input
              type="password"
              autoComplete="off"
              disabled={busy}
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
            />
          </Field>
        )}
        {(error || notice) && <Alert tone="danger">{error || notice}</Alert>}
        <Button type="submit" variant="primary" loading={busy}>
          {setupRequired ? "创建账户并进入" : "登录工作台"}
        </Button>
      </Form>
      <p className="auth-footnote">
        {setupRequired ? "已有管理员？" : "首次启用或登录状态有变化？"}
        <button type="button" disabled={busy} onClick={onRefresh}>
          刷新状态
        </button>
      </p>
    </>
  );
}
