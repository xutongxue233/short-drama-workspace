import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setApiSession } from "../../api";
import type { PublicUser } from "../../types";
import { AuthBoundary } from "./AuthBoundary";
import { AccountDialog } from "./AccountDialog";

const admin: PublicUser = {
  id: "u-admin",
  username: "admin",
  displayName: "林导演",
  kind: "human",
  role: "admin",
  disabled: false,
  createdAt: "2026-10-13T00:00:00Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setApiSession();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setApiSession();
});

function Harness() {
  return (
    <AuthBoundary>
      {({ user, onLogout }) => (
        <div>
          <p>私有项目：{user.displayName}</p>
          <button onClick={() => void onLogout()}>退出登录</button>
        </div>
      )}
    </AuthBoundary>
  );
}

describe("authenticated workspace boundary", () => {
  it("does not mount private data before login and forwards the session CSRF on logout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ setupRequired: false, user: null }))
      .mockResolvedValueOnce(
        json({ setupRequired: false, user: admin, csrfToken: "csrf-admin" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    expect(screen.queryByText(/私有项目/)).toBeNull();
    await screen.findByRole("heading", { name: "登录映序" });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secure-admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
    await screen.findByText("私有项目：林导演");
    sessionStorage.setItem("yingxu-draft-u-admin-project", "private draft");
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.queryByText(/私有项目/)).toBeNull();
    expect(sessionStorage.getItem("yingxu-draft-u-admin-project")).toBeNull();
    await screen.findByRole("heading", { name: "登录映序" });
    expect(fetchMock.mock.calls[2][1].headers["X-CSRF-Token"]).toBe("csrf-admin");
  });

  it("unmounts the entire workspace after protected API expiry and accepts another account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ setupRequired: false, user: admin, csrfToken: "first" }),
      )
      .mockResolvedValueOnce(json({ error: "会话失效" }, 401))
      .mockResolvedValueOnce(
        json({
          setupRequired: false,
          user: { ...admin, id: "u-editor", displayName: "剪辑师小王", role: "user" },
          csrfToken: "second",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    await screen.findByText("私有项目：林导演");
    await act(async () => {
      await expect(request("/state", undefined, "GET")).rejects.toMatchObject({
        status: 401,
      });
    });
    expect(screen.queryByText(/私有项目/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("登录已失效");
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "editor" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "another-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
    await screen.findByText("私有项目：剪辑师小王");
    expect(screen.queryByText("私有项目：林导演")).toBeNull();
  });

  it("supports bootstrap and includes a remote deployment setup token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ setupRequired: true, user: null }))
      .mockResolvedValueOnce(
        json({ setupRequired: false, user: admin, csrfToken: "token" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    await screen.findByRole("heading", { name: "创建管理员账户" });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("显示名称"), {
      target: { value: "林导演" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secure-admin-password" },
    });
    fireEvent.change(screen.getByLabelText(/初始化密钥/), {
      target: { value: "deployment-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账户并进入" }));
    await screen.findByText("私有项目：林导演");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      username: "admin",
      displayName: "林导演",
      password: "secure-admin-password",
      setupToken: "deployment-secret",
    });
  });

  it("keeps private data hidden and allows retry when server logout fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ setupRequired: false, user: admin, csrfToken: "token" }),
      )
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    await screen.findByText("私有项目：林导演");
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await screen.findByRole("button", { name: "重试退出" });
    expect(screen.queryByText(/私有项目/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试退出" }));
    await screen.findByRole("heading", { name: "登录映序" });
  });

  it("does not trap logout in a retry loop if another tab changes the session", async () => {
    let finishLogout!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ setupRequired: false, user: admin, csrfToken: "token" }),
        )
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            finishLogout = resolve;
          }),
        ),
    );
    render(<Harness />);
    await screen.findByText("私有项目：林导演");
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await act(async () => {
      setApiSession();
      finishLogout(new Response(null, { status: 204 }));
    });
    expect(screen.queryByText(/私有项目/)).toBeNull();
    expect(screen.queryByRole("button", { name: "重试退出" })).toBeNull();
    expect(screen.getByRole("heading", { name: "登录映序" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("登录状态已变化");
  });
});

describe("account management", () => {
  it("changes the password, clears secret inputs and installs the rotated session", async () => {
    const next = { setupRequired: false, user: admin, csrfToken: "rotated-token" };
    const onSessionChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(json(next));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AccountDialog
        user={admin}
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onSessionChange={onSessionChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: "old-password-123" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
    await screen.findByText("密码已更新，其他设备上的登录已退出。");
    expect(onSessionChange).toHaveBeenCalledWith(next);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      currentPassword: "old-password-123",
      newPassword: "new-password-456",
    });
    expect((screen.getByLabelText("当前密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("新密码") as HTMLInputElement).value).toBe("");
  });

  it("creates a regular human account without inventing a production role", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ users: [admin] }))
      .mockResolvedValueOnce(
        json(
          {
            user: {
              ...admin,
              id: "u-editor",
              username: "editor",
              displayName: "王同学",
              role: "user",
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        json({
          users: [
            admin,
            {
              ...admin,
              id: "u-editor",
              username: "editor",
              displayName: "王同学",
              role: "user",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AccountDialog
        user={admin}
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onSessionChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "团队账户" }));
    await screen.findByText("林导演（你）");
    expect(screen.queryByRole("button", { name: "停用" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "editor" } });
    fireEvent.change(screen.getByLabelText("显示名称"), {
      target: { value: "王同学" },
    });
    fireEvent.change(screen.getByLabelText("初始密码"), {
      target: { value: "editor-password-123" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "创建团队账户" }));
    await screen.findByText("王同学");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      username: "editor",
      displayName: "王同学",
      password: "editor-password-123",
      kind: "human",
      role: "user",
    });
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "创建团队账户" })).toBeNull(),
    );
  });

  it("does not expose administrator controls to regular users", () => {
    render(
      <AccountDialog
        user={{ ...admin, role: "user" }}
        onClose={vi.fn()}
        onLogout={vi.fn()}
        onSessionChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "团队账户" })).toBeNull();
    expect(screen.queryByRole("button", { name: "安全记录" })).toBeNull();
    expect(screen.getByRole("button", { name: "更新密码" })).toBeTruthy();
  });
});
