import { HttpError } from "./errors.mjs";
import { projectTask } from "../services/project-tasks.mjs";

export function textInput(value, field, { max = 2000, required = false } = {}) {
  if (typeof value !== "string") throw new HttpError(400, `${field}必须是文本`);
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `${field}不能为空`);
  if (result.length > max) throw new HttpError(400, `${field}最多 ${max} 字`);
  return result;
}

export function booleanInput(value, field) {
  if (typeof value !== "boolean") throw new HttpError(400, `${field}必须是布尔值`);
  return value;
}

export function validateProjectScope(input) {
  if (Object.hasOwn(input, "episodes"))
    throw new HttpError(400, "已移除总集数设置，请导入本集原文，每轮制作一集。");
  // Accept old clients explicitly selecting the sole remaining execution path,
  // without persisting a mode field or allowing a template-generation fallback.
  if (Object.hasOwn(input, "mode") && input.mode !== "live")
    throw new HttpError(400, "演示模式已移除，请配置模型接口后进行创作。");
}

export function bodyObject(req) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new HttpError(400, "请求正文必须是 JSON 对象");
  return req.body;
}

export function projectGuard(project) {
  if (projectTask(project))
    throw new HttpError(409, "项目正在执行图片测试，请等待完成后再操作。");
  if (project.running)
    throw new HttpError(409, "请先暂停项目，再修改原文、项目配置或资产。");
}
