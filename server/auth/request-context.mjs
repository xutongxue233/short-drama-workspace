import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage();
export const currentRequest = () => requests.getStore();

/** Snapshot attribution once; concurrent requests and asynchronous jobs stay isolated. */
export function withRequestActor(req, user, next) {
  const path = req.path.toLowerCase().replace(/\/+$/, "");
  const configuration = /^\/(providers|agents|skills)(?:\/[^/]+)?$/.exec(path);
  const operation = { POST: "created", PATCH: "updated", DELETE: "deleted" }[
    req.method
  ];
  return requests.run(
    {
      actor: { id: user.id, displayName: user.displayName, kind: user.kind },
      ...(configuration && operation
        ? {
            auditAction: `${configuration[1]}.${operation}`,
            targetId: path.split("/")[2] || null,
          }
        : {}),
    },
    next,
  );
}
