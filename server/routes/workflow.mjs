import { HttpError } from "../http/errors.mjs";
import { bodyObject, textInput } from "../http/validation.mjs";
import { validateBriefAnswers } from "../workflow/brief.mjs";
import { stateTransaction } from "../state-transaction.mjs";

export function mountWorkflowRoutes(app, { save, findProject, workflow }) {
  app.post("/api/projects/:id/run", (req, res) => {
    const input = bodyObject(req);
    const nodeId =
      input.nodeId === undefined
        ? undefined
        : textInput(input.nodeId, "节点标识", { max: 80, required: true });
    const shotId =
      input.shotId === undefined
        ? undefined
        : textInput(input.shotId, "镜号", { max: 8, required: true });
    const project = workflow.start(findProject(req.params.id), { nodeId, shotId });
    res.status(202).json(project);
  });

  app.post("/api/projects/:id/stop", (req, res) =>
    res.json(workflow.stop(findProject(req.params.id))),
  );

  app.post("/api/projects/:id/video-task/archive", (req, res) => {
    const input = bodyObject(req);
    res.json(
      workflow.archiveVideoTask(findProject(req.params.id), {
        taskId: textInput(input.taskId, "视频任务 ID", { max: 200, required: true }),
        acknowledgement: input.acknowledgement,
      }),
    );
  });

  app.post("/api/projects/:id/image-task/archive", (req, res) => {
    const input = bodyObject(req);
    res.json(
      workflow.archiveImageTask(findProject(req.params.id), {
        captureId: textInput(input.captureId, "图片请求 ID", {
          max: 100,
          required: true,
        }),
        acknowledgement: input.acknowledgement,
      }),
    );
  });

  app.post("/api/projects/:id/approval", (req, res) => {
    const input = bodyObject(req);
    if (!["approve", "revise"].includes(input.decision))
      throw new HttpError(400, "确认操作必须是 approve 或 revise");
    const value =
      input.value === undefined
        ? undefined
        : textInput(input.value, "选择值", { max: 80 });
    const feedback =
      input.feedback === undefined
        ? undefined
        : textInput(input.feedback, "反馈", { max: 5000 });
    res.json(
      workflow.approve(findProject(req.params.id), {
        approvalId: textInput(input.approvalId, "确认事项 ID", {
          max: 100,
          required: true,
        }),
        decision: input.decision,
        value,
        feedback,
        answers: validateBriefAnswers(input.answers),
      }),
    );
  });

  app.post("/api/projects/:id/invite", (req, res) => {
    const project = findProject(req.params.id),
      input = bodyObject(req);
    stateTransaction(project, () => {
      workflow.invite(
        project,
        textInput(input.agentId, "Agent 标识", { max: 80, required: true }),
      );
      save();
      res.json(project);
    });
  });
}
