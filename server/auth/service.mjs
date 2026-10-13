import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors.mjs";
import { stateTransaction } from "../state-transaction.mjs";
import { uid, now } from "../seed.mjs";
import { publicUser } from "./authorization.mjs";
import { currentRequest, withRequestActor } from "./request-context.mjs";

const COOKIE = "frameflow_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function sameSecret(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(value),
    right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAuthService({ getState, save, config }) {
  // Lazy initialization supports legacy stores without writing on every startup.
  if (!getState().security)
    getState().security = { version: 1, users: [], sessions: [], audit: [] };
  const security = () => getState().security;
  const attempts = new Map();
  const secure = Boolean(config.publicOrigin?.startsWith("https:"));
  const cookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/" };
  function audit(action, actor, targetId, outcome = "success") {
    security().audit.push({
      id: uid("audit"),
      action,
      actorId: actor?.id || null,
      actorName: actor?.displayName || "未登录",
      targetId: targetId || null,
      createdAt: now(),
      outcome,
    });
    security().audit = security().audit.slice(-2000);
  }
  function mutate(action) {
    return stateTransaction(getState(), () => {
      const result = action();
      save();
      return result;
    });
  }
  function saveWithAudit() {
    const request = currentRequest();
    if (!request?.auditAction || request.auditSaved) return save();
    const before = [...security().audit];
    audit(request.auditAction, request.actor, request.targetId);
    try {
      save();
      request.auditSaved = true;
    } catch (error) {
      security().audit = before;
      throw error;
    }
  }
  function requestSession(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
    const tokenHash = hash(cookie);
    const session = security().sessions.find((item) => item.tokenHash === tokenHash);
    if (!session || session.expiresAt <= Date.now()) return null;
    const user = security().users.find((item) => item.id === session.userId);
    if (!user || user.disabled) return null;
    return { user, session };
  }
  function issue(user) {
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const session = {
      tokenHash: hash(token),
      userId: user.id,
      csrfToken,
      createdAt: now(),
      expiresAt: Date.now() + SESSION_MS,
    };
    security().sessions = security().sessions.filter(
      (item) => item.expiresAt > Date.now(),
    );
    const own = security().sessions.filter((item) => item.userId === user.id);
    if (own.length >= 10) {
      const remove = new Set(own.slice(0, own.length - 9));
      security().sessions = security().sessions.filter((item) => !remove.has(item));
    }
    security().sessions.push(session);
    return { token, csrfToken };
  }
  function setCookie(res, token) {
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
  }
  function revoke(userId) {
    security().sessions = security().sessions.filter((item) => item.userId !== userId);
  }
  function sessionView(auth) {
    return {
      setupRequired: security().users.length === 0,
      user: publicUser(auth?.user),
      ...(auth ? { csrfToken: auth.session.csrfToken } : {}),
    };
  }
  function throttle(req, username) {
    const timestamp = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= timestamp) attempts.delete(key);
    const keys = [`ip:${req.ip || req.socket.remoteAddress}`, `username:${username}`];
    if (keys.some((key) => (attempts.get(key)?.count || 0) >= 10))
      throw new HttpError(429, "尝试次数过多，请在 15 分钟后重试。");
    if (attempts.size > 5000) throw new HttpError(429, "登录请求过多，请稍后重试。");
    for (const key of keys) {
      const entry = attempts.get(key) || {
        count: 0,
        until: timestamp + 15 * 60 * 1000,
      };
      entry.count++;
      attempts.set(key, entry);
    }
    return () => keys.forEach((key) => attempts.delete(key));
  }
  function middleware(req, _res, next) {
    const auth = requestSession(req);
    if (!auth) throw new HttpError(401, "请先登录。");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !sameSecret(req.headers["x-csrf-token"], auth.session.csrfToken)
    )
      throw new HttpError(403, "安全令牌无效，请刷新页面后重试。");
    req.auth = auth;
    withRequestActor(req, auth.user, next);
  }
  return {
    security,
    audit,
    mutate,
    requestSession,
    issue,
    setCookie,
    revoke,
    sessionView,
    throttle,
    middleware,
    saveWithAudit,
    clearCookie(res) {
      res.clearCookie(COOKIE, cookieOptions);
    },
  };
}
