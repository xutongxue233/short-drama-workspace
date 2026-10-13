export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | undefined;
let sessionUserId: string | undefined;
let sessionRevision = 0;
const expirationListeners = new Set<() => void>();

/** Session secrets only live in memory; cookies are managed by the server. */
export function setApiSession(token?: string, userId?: string) {
  csrfToken = token;
  sessionUserId = userId;
  sessionRevision += 1;
}

export function onSessionExpired(listener: () => void) {
  expirationListeners.add(listener);
  return () => {
    expirationListeners.delete(listener);
  };
}

/** The only frontend HTTP boundary. Reject responses from an older account. */
export async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const revision = sessionRevision;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
    headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal: options.signal,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ensureCurrent = () => {
    if (revision !== sessionRevision)
      throw new DOMException("登录状态已变化，请重新操作", "AbortError");
  };
  ensureCurrent();
  if (response.status === 401 && !["/auth/login", "/auth/setup"].includes(path)) {
    setApiSession();
    for (const listener of expirationListeners) listener();
    throw new ApiError("登录已失效，请重新登录", 401);
  }
  if (response.status === 204) return undefined as T;
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    )
      throw error;
    throw new ApiError(
      response.ok
        ? "服务返回了无效响应，请确认本地 API 已正常启动。"
        : `请求失败 (${response.status})，请检查本地 API 服务。`,
      response.status,
    );
  }
  ensureCurrent();
  if (
    response.ok &&
    path.split("?")[0] === "/state" &&
    sessionUserId &&
    result &&
    typeof result === "object" &&
    "currentUser" in result &&
    result.currentUser &&
    typeof result.currentUser === "object" &&
    "id" in result.currentUser &&
    result.currentUser.id !== sessionUserId
  ) {
    setApiSession();
    for (const listener of expirationListeners) listener();
    throw new ApiError("当前浏览器的账户已变化，请重新登录", 401);
  }
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `请求失败 (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return result as T;
}
