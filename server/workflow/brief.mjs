import { HttpError } from "../http/errors.mjs";
import { STYLES } from "../seed.mjs";

export const ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
export const PLATFORMS = ["抖音", "快手", "视频号", "小红书", "哔哩哔哩", "通用"];
const ANSWER_KEYS = [
  "style",
  "episodeCount",
  "durationSeconds",
  "aspectRatio",
  "platform",
];

/** Suggestions are never persisted until the user approves the production brief. */
export function suggestedBrief(project) {
  return {
    durationSeconds: 90,
    aspectRatio: "9:16",
    platform: "抖音",
    ...project.productionBrief,
    episodeCount: 1,
  };
}

export function briefDescription(project) {
  const brief = suggestedBrief(project);
  return `本集 ${brief.durationSeconds} 秒 · ${brief.aspectRatio} · ${brief.platform}`;
}

export function briefFields(project) {
  const brief = suggestedBrief(project);
  return [
    {
      id: "style",
      label: "视觉风格",
      type: "select",
      options: STYLES,
      value: STYLES.includes(project.style) ? project.style : STYLES[0],
      help: STYLES.includes(project.style)
        ? "已沿用项目风格，可在本次确认时调整。"
        : "建议先采用真人短剧，可按创作方向修改。",
    },
    {
      id: "durationSeconds",
      label: "本集时长（秒）",
      type: "text",
      value: String(brief.durationSeconds),
      help: "填写 15–600 秒，编剧和分镜将沿用这一时长。",
    },
    {
      id: "aspectRatio",
      label: "画幅比例",
      type: "select",
      options: ASPECT_RATIOS,
      value: brief.aspectRatio,
      help: "9:16 适合竖屏，16:9 为横屏，1:1 为方形。",
    },
    {
      id: "platform",
      label: "目标平台",
      type: "select",
      options: PLATFORMS,
      value: brief.platform,
      help: "用于创作节奏和呈现方式的建议，不代表平台审核或流量保证。",
    },
  ].map((field) => ({ ...field, required: true }));
}

export function validateBriefAnswers(answers) {
  if (answers === undefined) return {};
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw new HttpError(400, "制作方案答案必须是 JSON 对象");
  for (const [key, value] of Object.entries(answers)) {
    if (!ANSWER_KEYS.includes(key))
      throw new HttpError(400, `不支持的制作方案字段：${key.slice(0, 40)}`);
    if (typeof value !== "string" || !value.trim() || value.length > 80)
      throw new HttpError(400, "制作方案答案必须是 1–80 字的文本");
  }
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, value.trim()]),
  );
}

export function confirmedBrief(project, answers, legacyStyle) {
  const values = validateBriefAnswers(answers);
  if (values.episodeCount !== undefined && values.episodeCount !== "1")
    throw new HttpError(
      400,
      "每次提供的原文只制作一集，不再支持设置本轮集数。请刷新确认卡后重试。",
    );
  const defaults = suggestedBrief(project);
  const style =
    values.style ||
    legacyStyle ||
    (STYLES.includes(project.style) ? project.style : STYLES[0]);
  if (!STYLES.includes(style)) throw new HttpError(400, "请选择支持的视觉风格");
  function integer(key, label, min, max) {
    const value = values[key] ?? String(defaults[key]);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new HttpError(400, `${label}必须是 ${min} 到 ${max} 之间的整数`);
    return Number(value);
  }
  const aspectRatio = values.aspectRatio ?? defaults.aspectRatio;
  const platform = values.platform ?? defaults.platform;
  if (!ASPECT_RATIOS.includes(aspectRatio))
    throw new HttpError(400, "请选择支持的画幅比例");
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, "请选择支持的目标平台");
  return {
    style,
    productionBrief: {
      episodeCount: 1,
      durationSeconds: integer("durationSeconds", "单集时长", 15, 600),
      aspectRatio,
      platform,
    },
  };
}
