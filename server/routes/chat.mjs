import { bodyObject } from "../http/validation.mjs";

export function mountChatRoutes(app, { findProject, chat }) {
  app.post("/api/projects/:id/messages", async (req, res) => {
    const project = findProject(req.params.id);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    try {
      const message = await chat.sendMessage(project, bodyObject(req), {
        signal: controller.signal,
        sender: req.auth.user,
        access: req.projectAccess,
      });
      if (!res.destroyed) res.status(201).json(message);
    } finally {
      res.off("close", onClose);
    }
  });
}
