import { HttpError } from "../http/errors.mjs";
import { bodyObject, textInput, booleanInput } from "../http/validation.mjs";

export function mountAgentsRoutes(app, { getState, save }) {
  app.patch("/api/agents/:id", (req, res) => {
    const agent = getState().agents.find((item) => item.id === req.params.id);
    if (!agent) throw new HttpError(404, "Agent 不存在");
    const input = bodyObject(req),
      patch = {};
    for (const [field, max] of [
      ["name", 80],
      ["description", 1000],
      ["systemPrompt", 12000],
      ["model", 200],
      ["providerId", 100],
    ]) {
      if (input[field] !== undefined)
        patch[field] = textInput(input[field], field, {
          max,
          required: field === "name",
        });
    }
    if (input.enabled !== undefined)
      patch.enabled = booleanInput(input.enabled, "启用状态");
    if (
      patch.providerId &&
      !getState().providers.some((provider) => provider.id === patch.providerId)
    )
      throw new HttpError(400, "选择的模型接口不存在");
    Object.assign(agent, patch);
    save();
    res.json(agent);
  });
}
