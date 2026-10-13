import { transactionalRoute } from "../state-transaction.mjs";
import { HttpError } from "../http/errors.mjs";
import { bodyObject } from "../http/validation.mjs";
import { uid } from "../seed.mjs";
import {
  agentInput,
  assertAgentCanDelete,
  assertAgentNameAvailable,
} from "../services/agent-config.mjs";

export function mountAgentsRoutes(app, { getState, save }) {
  app.post(
    "/api/agents",
    transactionalRoute(getState, (req, res) => {
      const state = getState();
      const agent = {
        id: uid("agent"),
        ...agentInput(bodyObject(req), state.providers, { creating: true }),
      };
      assertAgentNameAvailable(agent.name, state.agents);
      state.agents.push(agent);
      save();
      res.status(201).json(agent);
    }),
  );

  app.patch(
    "/api/agents/:id",
    transactionalRoute(getState, (req, res) => {
      const agent = getState().agents.find((item) => item.id === req.params.id);
      if (!agent) throw new HttpError(404, "Agent 不存在");
      const patch = agentInput(bodyObject(req), getState().providers, {
        existing: agent,
      });
      assertAgentNameAvailable(patch.name, getState().agents, agent);
      // In-flight generation keeps its original configuration across awaits.
      const updated = { ...agent, ...patch };
      getState().agents[getState().agents.indexOf(agent)] = updated;
      save();
      res.json(updated);
    }),
  );

  app.delete(
    "/api/agents/:id",
    transactionalRoute(getState, (req, res) => {
      const state = getState();
      const index = state.agents.findIndex((item) => item.id === req.params.id);
      if (index === -1) throw new HttpError(404, "Agent 不存在");
      const agent = state.agents[index];
      assertAgentCanDelete(agent, state.projects);
      state.agents.splice(index, 1);
      save();
      res.json({ id: agent.id, deleted: true });
    }),
  );
}
