const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const localOnly = (req, res, next) => {
  // Local-only service: reject DNS rebinding and requests initiated by remote websites.
  if (!LOCAL_HOSTS.has(req.hostname.toLowerCase()))
    return res
      .status(403)
      .json({ error: "此工作台仅允许通过 localhost 或 127.0.0.1 访问。" });
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        !LOCAL_HOSTS.has(origin.hostname.toLowerCase())
      )
        throw new Error();
    } catch {
      return res.status(403).json({ error: "不允许来自外部网站的访问。" });
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
};

export const requireJsonBody = (req, res, next) => {
  if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json"))
    return res.status(415).json({ error: "请使用 application/json 请求正文。" });
  next();
};

export const errorHandler = (error, _req, res, _next) => {
  const status =
    error.status ||
    (error.type === "entity.too.large"
      ? 413
      : error instanceof SyntaxError
        ? 400
        : 500);
  const message =
    status === 500
      ? "本地服务发生错误，请检查终端日志后重试。"
      : error.type === "entity.too.large"
        ? "请求正文超过大小限制。"
        : error instanceof SyntaxError
          ? "JSON 格式不正确。"
          : error.message;
  if (status === 500) console.error("[workbench]", error.name, error.message);
  res.status(status).json({ error: message });
};
