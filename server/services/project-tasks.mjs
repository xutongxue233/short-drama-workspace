import { HttpError } from "../http/errors.mjs";

const tasks = new WeakMap();
export const projectTask = (project) => tasks.get(project)?.kind ?? null;

export function beginProjectTask(project, kind) {
  if (tasks.has(project))
    throw new HttpError(409, "当前项目仍有后台任务，请等待完成。");
  const task = { kind };
  tasks.set(project, task);
  return () => {
    if (tasks.get(project) === task) tasks.delete(project);
  };
}
