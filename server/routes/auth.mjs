import { HttpError } from "../http/errors.mjs";
import { bodyObject, textInput, booleanInput } from "../http/validation.mjs";
import { uid, now } from "../seed.mjs";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/passwords.mjs";
import { publicUser, requireAdmin } from "../auth/authorization.mjs";
import { sameSecret } from "../auth/service.mjs";

function usernameInput(value) {
  const name = textInput(value, "用户名", { max: 64, required: true }).toLowerCase();
  if (!/^[a-z0-9_.-]{3,64}$/.test(name))
    throw new HttpError(400, "用户名须为 3–64 位字母、数字、点、下划线或连字符。");
  return name;
}
function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `${label}无效。`);
  return value;
}
function newUser(input, passwordHash, forcedRole) {
  const username = usernameInput(input.username);
  return {
    id: uid("user"),
    username,
    displayName: textInput(input.displayName ?? username, "显示名称", {
      max: 80,
      required: true,
    }),
    kind: choice(input.kind ?? "human", ["human", "bot"], "账号类型"),
    role: forcedRole || choice(input.role ?? "user", ["admin", "user"], "账号权限"),
    disabled: false,
    passwordHash,
    createdAt: now(),
  };
}
function uniqueUsername(auth, username) {
  if (auth.security().users.some((item) => item.username === username))
    throw new HttpError(409, "用户名已被使用。");
}

/** Public auth routes are mounted before the mandatory session middleware. */
export function mountPublicAuthRoutes(app, { auth, getState, config }) {
  app.get("/api/auth/session", (req, res) =>
    res.json(auth.sessionView(auth.requestSession(req))),
  );
  app.post("/api/auth/setup", async (req, res) => {
    const input = bodyObject(req);
    if (auth.security().users.length)
      throw new HttpError(409, "管理员已初始化，请登录。");
    if (config.setupToken && !sameSecret(input.setupToken, config.setupToken))
      throw new HttpError(403, "初始化令牌无效。");
    if (config.publicOrigin && !config.setupToken)
      throw new HttpError(
        403,
        "外部部署初始化需要配置 WORKBENCH_SETUP_TOKEN，或先在本机完成初始化。",
      );
    if (
      !config.setupToken &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
    )
      throw new HttpError(403, "首次初始化须从本机完成，或配置初始化令牌。");
    const username = usernameInput(input.username);
    const resetThrottle = auth.throttle(req, `setup:${username}`);
    const user = newUser(
      { ...input, username, kind: "human" },
      await hashPassword(input.password),
      "admin",
    );
    const session = auth.mutate(() => {
      // The password hash is asynchronous: recheck inside the synchronous transaction.
      if (auth.security().users.length)
        throw new HttpError(409, "管理员已初始化，请登录。");
      auth.security().users.push(user);
      for (const project of getState().projects)
        if (!Array.isArray(project.participants))
          project.participants = [{ userId: user.id, access: "owner" }];
      auth.audit("auth.setup", user, user.id);
      return auth.issue(user);
    });
    resetThrottle();
    auth.setCookie(res, session.token);
    res.status(201).json({
      setupRequired: false,
      user: publicUser(user),
      csrfToken: session.csrfToken,
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    const input = bodyObject(req);
    const username = usernameInput(input.username);
    const resetThrottle = auth.throttle(req, username);
    const user = auth.security().users.find((item) => item.username === username);
    const passwordHash = user?.passwordHash || DUMMY_HASH;
    const valid = await verifyPassword(input.password, passwordHash);
    if (!valid || !user || user.disabled || user.passwordHash !== passwordHash) {
      auth.mutate(() => auth.audit("auth.login", null, null, "denied"));
      throw new HttpError(401, "用户名或密码不正确。");
    }
    const session = auth.mutate(() => {
      auth.audit("auth.login", user, user.id);
      return auth.issue(user);
    });
    resetThrottle();
    auth.setCookie(res, session.token);
    res.json({
      setupRequired: false,
      user: publicUser(user),
      csrfToken: session.csrfToken,
    });
  });
}

export function mountPrivateAuthRoutes(app, { auth }) {
  app.post("/api/auth/logout", (req, res) => {
    auth.mutate(() => {
      auth.security().sessions = auth
        .security()
        .sessions.filter((item) => item !== req.auth.session);
      auth.audit("auth.logout", req.auth.user, req.auth.user.id);
    });
    auth.clearCookie(res);
    res.json({ ok: true });
  });
  app.patch("/api/auth/password", async (req, res) => {
    const input = bodyObject(req),
      user = req.auth.user;
    auth.throttle(req, `password:${user.id}`);
    const before = user.passwordHash;
    if (!(await verifyPassword(input.currentPassword, before)))
      throw new HttpError(400, "当前密码不正确。");
    const passwordHash = await hashPassword(input.newPassword);
    const session = auth.mutate(() => {
      if (user.disabled || user.passwordHash !== before || !auth.requestSession(req))
        throw new HttpError(401, "会话已失效，请重新登录。");
      user.passwordHash = passwordHash;
      auth.revoke(user.id);
      auth.audit("auth.password.changed", user, user.id);
      return auth.issue(user);
    });
    auth.setCookie(res, session.token);
    res.json({
      setupRequired: false,
      user: publicUser(user),
      csrfToken: session.csrfToken,
    });
  });
  app.get("/api/users", requireAdmin, (_req, res) =>
    res.json({ users: auth.security().users.map(publicUser) }),
  );
  app.post("/api/users", requireAdmin, async (req, res) => {
    const input = bodyObject(req);
    const username = usernameInput(input.username);
    uniqueUsername(auth, username);
    const user = newUser({ ...input, username }, await hashPassword(input.password));
    auth.mutate(() => {
      if (!auth.requestSession(req) || req.auth.user.role !== "admin")
        throw new HttpError(401, "会话或管理员权限已失效。");
      uniqueUsername(auth, username);
      if (auth.security().users.length >= 1000)
        throw new HttpError(400, "账号数量已达上限。");
      auth.security().users.push(user);
      auth.audit("user.created", req.auth.user, user.id);
    });
    res.status(201).json(publicUser(user));
  });
  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    const input = bodyObject(req),
      patch = {};
    const user = auth.security().users.find((item) => item.id === req.params.id);
    if (!user) throw new HttpError(404, "用户不存在。");
    if (input.displayName !== undefined)
      patch.displayName = textInput(input.displayName, "显示名称", {
        max: 80,
        required: true,
      });
    if (input.disabled !== undefined)
      patch.disabled = booleanInput(input.disabled, "禁用状态");
    if (input.role !== undefined)
      patch.role = choice(input.role, ["admin", "user"], "账号权限");
    if (input.password !== undefined)
      patch.passwordHash = await hashPassword(input.password);
    auth.mutate(() => {
      if (!auth.requestSession(req) || req.auth.user.role !== "admin")
        throw new HttpError(401, "会话或管理员权限已失效。");
      const remainingAdmin = auth
        .security()
        .users.some(
          (item) => item.id !== user.id && item.role === "admin" && !item.disabled,
        );
      if (
        user.role === "admin" &&
        !user.disabled &&
        (patch.disabled === true || patch.role === "user") &&
        !remainingAdmin
      )
        throw new HttpError(409, "至少需要保留一位启用的管理员。");
      Object.assign(user, patch);
      if (
        patch.disabled !== undefined ||
        patch.passwordHash ||
        patch.role !== undefined
      )
        auth.revoke(user.id);
      auth.audit(
        patch.passwordHash ? "user.password.reset" : "user.updated",
        req.auth.user,
        user.id,
      );
    });
    res.json(publicUser(user));
  });
  app.get("/api/audit", requireAdmin, (_req, res) =>
    res.json({ events: auth.security().audit.toReversed() }),
  );
}
