import { randomUUID } from "node:crypto";
import { HttpError } from "../http/errors.mjs";
import { textInput } from "../http/validation.mjs";

const KEYS = new Set([
  "enter",
  "tab",
  "escape",
  "backspace",
  "delete",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "alt+tab",
  ...["ctrl", "meta"].flatMap((modifier) =>
    ["a", "c", "v", "x", "z"].map((key) => `${modifier}+${key}`),
  ),
]);

export function publicComputer(computer) {
  return {
    id: computer.id,
    name: computer.name,
    endpoint: computer.endpoint,
    hasToken: Boolean(computer.token),
    control: {
      mode: computer.control?.mode === "human" ? "human" : "agent",
      ...(computer.control?.mode === "human"
        ? {
            ownerId: computer.control.ownerId,
            ownerName: computer.control.ownerName,
            since: computer.control.since,
          }
        : {}),
    },
  };
}

export function computerInput(input, { creating = false } = {}) {
  const patch = {};
  if (creating || Object.hasOwn(input, "name"))
    patch.name = textInput(input.name, "电脑名称", { required: true, max: 80 });
  if (creating || Object.hasOwn(input, "endpoint")) {
    const raw = textInput(input.endpoint, "连接地址", { required: true, max: 2000 });
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new HttpError(400, "电脑连接地址无效。");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    )
      throw new HttpError(
        400,
        "电脑连接地址必须是无凭据、路径、查询参数的 HTTP(S) 地址。",
      );
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol === "http:" && !loopback)
      throw new HttpError(400, "远程电脑必须使用 HTTPS，本机回环地址可使用 HTTP。");
    patch.endpoint = url.origin;
  }
  if (creating || Object.hasOwn(input, "token")) {
    patch.token = textInput(input.token, "连接令牌", { required: true, max: 4000 });
    if (patch.token.length < 32 || /\s/.test(patch.token))
      throw new HttpError(400, "连接令牌至少 32 个字符，不能包含空白字符。");
  }
  return patch;
}

export function assertComputerIdentityAvailable(candidate, computers, existingId) {
  if (
    computers.some(
      (computer) =>
        computer.id !== existingId &&
        (computer.endpoint === candidate.endpoint ||
          computer.token === candidate.token),
    )
  )
    throw new HttpError(
      409,
      "这台电脑的地址或令牌已注册，请将多个 Agent 绑定到同一电脑；每台电脑使用独立令牌。",
    );
}

export function computerAction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "电脑操作必须是对象。");
  if (input.type === "click") {
    if (
      ![input.x, input.y].every(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      )
    )
      throw new HttpError(400, "点击坐标必须在 0 至 1 之间。");
    const button = input.button ?? "left";
    if (!["left", "right", "double"].includes(button))
      throw new HttpError(400, "不支持的鼠标按键。");
    return { type: "click", x: input.x, y: input.y, button };
  }
  if (input.type === "key" && KEYS.has(input.key))
    return { type: "key", key: input.key };
  if (input.type === "text") {
    if (
      typeof input.text !== "string" ||
      !input.text.length ||
      input.text.length > 4000 ||
      input.text.includes("\0")
    )
      throw new HttpError(400, "输入文字必须为 1 至 4000 字，不能包含空字符。");
    return { type: "text", text: input.text };
  }
  if (
    input.type === "scroll" &&
    Number.isInteger(input.delta) &&
    input.delta !== 0 &&
    Math.abs(input.delta) <= 10
  )
    return { type: "scroll", delta: input.delta };
  throw new HttpError(400, "不支持的电脑操作。");
}

/** One serialized command stream per computer. The durable human lock is set
 * synchronously, before waiting for that stream or any remote acknowledgement.
 * Control tokens remain in memory; a new process cannot replay an old lease. */
export function createComputerService({
  getState,
  save,
  fetchImpl = globalThis.fetch,
}) {
  const queues = new Map();
  const revisions = new Map();
  const pendingControllers = new Set();
  let runners;
  let closed = false;
  function find(id) {
    const computer = (getState().computers || []).find((item) => item.id === id);
    if (!computer) throw new HttpError(404, "电脑不存在。");
    return computer;
  }
  function boundIds(id) {
    return new Set(
      getState()
        .agents.filter((agent) => agent.computerId === id)
        .map((agent) => agent.id),
    );
  }
  function assertAgentAvailable(agentId) {
    const agent = getState().agents.find((item) => item.id === agentId);
    if (agent?.computerId) {
      const computer = find(agent.computerId);
      if (computer.control?.mode === "human") {
        const error = new HttpError(
          409,
          `「${computer.name}」正由人工接管，已暂停绑定的 Agent；请先释放接管。`,
        );
        error.computerTakeover = true;
        throw error;
      }
    }
  }
  function isBusy(id) {
    const ids = boundIds(id);
    return Boolean(
      runners?.chat.isUsingAgents(ids) || runners?.workflow.isUsingAgents(ids),
    );
  }
  function assertConfigurable(id) {
    const computer = find(id);
    if (computer.control?.mode === "human" || queues.has(id) || isBusy(id))
      throw new HttpError(
        409,
        "请先释放电脑接管并暂停绑定 Agent 的任务，再修改连接或绑定。",
      );
    return computer;
  }
  function assertBindingChange(agent, nextId) {
    if (agent?.computerId === nextId) return;
    if (
      agent &&
      (runners?.chat.isUsingAgents(new Set([agent.id])) ||
        runners?.workflow.isUsingAgents(new Set([agent.id])))
    )
      throw new HttpError(409, "此 Agent 正在执行任务，请先暂停任务再更改电脑绑定。");
    for (const id of new Set([agent?.computerId, nextId].filter(Boolean)))
      assertConfigurable(id);
  }
  async function bridge(computer, path, { body, image = false } = {}) {
    if (closed) throw new HttpError(503, "电脑连接服务正在关闭。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    pendingControllers.add(controller);
    try {
      const response = await fetchImpl(`${computer.endpoint}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${computer.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error("bridge response");
      const limit = image ? 20 * 1024 * 1024 : 65536;
      if (Number(response.headers.get("content-length")) > limit)
        throw new Error("oversized response");
      if (
        image &&
        !/^image\/png(?:;|$)/i.test(response.headers.get("content-type") || "")
      )
        throw new Error("invalid image");
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new Error("oversized response");
        }
        chunks.push(value);
      }
      const data = Buffer.concat(chunks);
      if (image) {
        if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          throw new Error("invalid png");
        return data;
      }
      const result = JSON.parse(data.toString("utf8"));
      if (result.ok !== true) throw new Error("unacknowledged command");
      return result;
    } catch {
      // Never forward bridge response bodies, request headers or token-bearing errors.
      throw new HttpError(
        502,
        "电脑连接失败，请检查连接地址、令牌和桥接程序；人工接管锁会保留，Agent 不会自动恢复。",
      );
    } finally {
      clearTimeout(timeout);
      pendingControllers.delete(controller);
    }
  }
  function serial(id, work) {
    const pending = (queues.get(id) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(id, pending);
    return pending.finally(() => {
      if (queues.get(id) === pending) queues.delete(id);
    });
  }
  function nextRevision(id) {
    const computer = find(id);
    const version = Math.max(
      getState().computerControlVersion || 0,
      computer.controlVersion || 0,
    );
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      version >= Number.MAX_SAFE_INTEGER
    )
      throw new HttpError(503, "电脑控制版本无效，请修复本地记录。");
    computer.controlVersion = version + 1;
    getState().computerControlVersion = computer.controlVersion;
    const revision = randomUUID();
    revisions.set(id, revision);
    return revision;
  }
  function requireRevision(id, revision) {
    if (closed || revisions.get(id) !== revision)
      throw new HttpError(409, "电脑控制状态已经变化，请刷新后重试。");
  }
  function requireOwner(computer, user, force = false) {
    if (!user || user.disabled || user.role !== "admin")
      throw new HttpError(403, "此操作需要有效管理员权限。");
    if (computer.control?.mode !== "human")
      throw new HttpError(409, "请先接管电脑再执行人工操作。");
    if (computer.control.ownerId !== user.id && !(force && user.role === "admin"))
      throw new HttpError(409, "电脑由其他管理员接管；如需恢复，请明确选择强制释放。");
  }
  return {
    find,
    publicComputer,
    assertAgentAvailable,
    assertConfigurable,
    assertBindingChange,
    attachRunners(value) {
      runners = value;
    },
    screen: (id) => bridge(find(id), "/screenshot", { image: true }),
    async takeover(id, user) {
      const computer = find(id);
      if (computer.control?.mode === "human" && computer.control.ownerId !== user.id)
        throw new HttpError(409, "电脑正由其他管理员接管。");
      computer.control = {
        mode: "human",
        ownerId: user.id,
        ownerName: user.displayName,
        since: computer.control?.since || new Date().toISOString(),
      };
      const revision = nextRevision(id);
      let failure;
      // Fail closed even when persistence is unavailable: keep the in-memory lock
      // and abort all bound jobs, then report the save failure to the caller.
      try {
        save();
      } catch (error) {
        failure = error;
      }
      const ids = boundIds(id);
      for (const runner of [runners?.chat, runners?.workflow]) {
        try {
          runner?.pauseAgents(ids);
        } catch (error) {
          failure ||= error;
        }
      }
      return serial(id, async () => {
        requireRevision(id, revision);
        await bridge(computer, "/control", {
          body: {
            mode: "human",
            controlToken: revision,
            controlVersion: computer.controlVersion,
          },
        });
        requireRevision(id, revision);
        if (failure) throw failure;
        return publicComputer(computer);
      });
    },
    async release(id, user, { force = false } = {}) {
      const computer = find(id);
      requireOwner(computer, user, force);
      const revision = nextRevision(id);
      // Persist the fence before dispatch. A timed-out older /control may arrive
      // late, but the bridge must reject its lower version after this transition.
      save();
      return serial(id, async () => {
        requireRevision(id, revision);
        await bridge(computer, "/control", {
          body: {
            mode: "agent",
            controlToken: revision,
            controlVersion: computer.controlVersion,
          },
        });
        requireRevision(id, revision);
        const previous = computer.control;
        computer.control = { mode: "agent" };
        try {
          save();
        } catch (error) {
          computer.control = previous;
          nextRevision(id);
          throw error;
        }
        // Deliberately do not restart interrupted chat or workflow jobs.
        return publicComputer(computer);
      });
    },
    async action(id, input, { user, agentId } = {}) {
      const computer = find(id);
      const action = computerAction(input);
      const actor = agentId ? "agent" : "human";
      const check = () => {
        if (user && (user.disabled || user.role !== "admin"))
          throw new HttpError(403, "此操作需要有效管理员权限。");
        if (actor === "human") requireOwner(computer, user);
        else {
          const agent = getState().agents.find((item) => item.id === agentId);
          if (!agent?.enabled || agent.computerId !== id)
            throw new HttpError(409, "Agent 未启用或电脑绑定已经变化。");
          assertAgentAvailable(agentId);
        }
      };
      check();
      let revision = revisions.get(id);
      if (!revision) revision = nextRevision(id);
      // A previous transition may have retained only an in-memory lock after a
      // disk failure. Physical input requires a durable lock and fence.
      save();
      return serial(id, async () => {
        requireRevision(id, revision);
        check();
        // Re-establish the lease on every action, including after a bridge restart.
        await bridge(computer, "/control", {
          body: {
            mode: actor,
            controlToken: revision,
            controlVersion: computer.controlVersion,
          },
        });
        requireRevision(id, revision);
        check();
        await bridge(computer, "/actions", {
          body: {
            actor,
            controlToken: revision,
            controlVersion: computer.controlVersion,
            action,
          },
        });
        return { ok: true };
      });
    },
    close() {
      closed = true;
      for (const controller of pendingControllers) controller.abort();
    },
  };
}
