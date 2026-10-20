import { transactionalRoute } from "../state-transaction.mjs";
import { HttpError } from "../http/errors.mjs";
import { bodyObject } from "../http/validation.mjs";
import {
  assertComputerIdentityAvailable,
  computerInput,
  publicComputer,
} from "../services/computers.mjs";
import { uid } from "../seed.mjs";

export function mountComputerRoutes(app, { getState, save, computers }) {
  app.get("/api/computers", (_req, res) =>
    res.json({ computers: (getState().computers || []).map(publicComputer) }),
  );
  app.post(
    "/api/computers",
    transactionalRoute(getState, (req, res) => {
      const computer = {
        id: uid("computer"),
        ...computerInput(bodyObject(req), { creating: true }),
        control: { mode: "agent" },
      };
      assertComputerIdentityAvailable(computer, getState().computers || []);
      (getState().computers ||= []).push(computer);
      save();
      res.status(201).json({ computer: publicComputer(computer) });
    }),
  );
  app.patch(
    "/api/computers/:id",
    transactionalRoute(getState, (req, res) => {
      const computer = computers.assertConfigurable(req.params.id);
      const patch = computerInput(bodyObject(req));
      assertComputerIdentityAvailable(
        { ...computer, ...patch },
        getState().computers,
        computer.id,
      );
      Object.assign(computer, patch);
      save();
      res.json({ computer: publicComputer(computer) });
    }),
  );
  app.delete(
    "/api/computers/:id",
    transactionalRoute(getState, (req, res) => {
      const computer = computers.assertConfigurable(req.params.id);
      if (getState().agents.some((agent) => agent.computerId === computer.id))
        throw new HttpError(409, "电脑仍有 Agent 绑定，请先解除绑定。");
      getState().computers.splice(getState().computers.indexOf(computer), 1);
      save();
      res.json({ id: computer.id, deleted: true });
    }),
  );
  app.get("/api/computers/:id/screen", async (req, res) => {
    const screen = await computers.screen(req.params.id);
    res
      .set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
      .type("image/png")
      .send(screen);
  });
  app.post("/api/computers/:id/takeover", async (req, res) => {
    bodyObject(req);
    res.json({ computer: await computers.takeover(req.params.id, req.auth.user) });
  });
  app.post("/api/computers/:id/release", async (req, res) => {
    const input = bodyObject(req);
    if (input.force !== undefined && typeof input.force !== "boolean")
      throw new HttpError(400, "强制释放必须是布尔值。");
    res.json({
      computer: await computers.release(req.params.id, req.auth.user, input),
    });
  });
  app.post("/api/computers/:id/actions", async (req, res) =>
    res.json(
      await computers.action(req.params.id, bodyObject(req), { user: req.auth.user }),
    ),
  );
  // Protected execution endpoint for bots/integrations; model chat does not
  // automatically invoke desktop actions or infer permission from text.
  app.post("/api/agents/:id/computer/actions", async (req, res) => {
    const agent = getState().agents.find((item) => item.id === req.params.id);
    if (!agent?.computerId) throw new HttpError(409, "Agent 尚未绑定电脑。");
    res.json(
      await computers.action(agent.computerId, bodyObject(req), {
        agentId: agent.id,
        user: req.auth.user,
      }),
    );
  });
}
