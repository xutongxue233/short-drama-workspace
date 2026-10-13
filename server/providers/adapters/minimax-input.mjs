import { ProviderError } from "../errors.mjs";
import { networkUrl } from "../config.mjs";

// Verified against the native API docs, not third-party gateway model names.
// https://platform.minimax.io/docs/api-reference/image-generation-i2i
// https://platform.minimax.io/docs/api-reference/video-generation-v2-create
export const MINIMAX_IMAGE_MODELS = new Set(["image-01", "image-01-live"]);
export const MINIMAX_H3_MODELS = new Set(["MiniMax-H3", "MiniMax-H3-Max"]);
const TEXT_VIDEO_MODELS = new Set([
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-02",
  "T2V-01-Director",
  "T2V-01",
]);
const FRAME_VIDEO_MODELS = new Set([
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-2.3-Fast",
  "MiniMax-Hailuo-02",
  "I2V-01-Director",
  "I2V-01-live",
  "I2V-01",
]);

function imageReferences(refs) {
  const images = [];
  const descriptions = refs.map((reference) => {
    const url =
      typeof reference === "string"
        ? /^(?:https?:|data:)/i.test(reference)
          ? reference
          : undefined
        : reference.url;
    if (!url) return reference;
    const type = typeof reference === "object" ? reference.type : undefined;
    if (["audio", "video"].includes(type))
      throw new ProviderError(
        "当前 MiniMax 适配器支持图片参考；音视频参考请使用明确适配的 Webhook，不会忽略参考素材。",
      );
    if (!url.startsWith("data:")) networkUrl(url, "参考图片地址");
    images.push({ url, type });
    const label = `参考图 ${images.length}`;
    return typeof reference === "string" ? label : { ...reference, url: label };
  });
  return { images, descriptions };
}

function mergedPrompt(textPrompt, systemPrompt, descriptions, limit) {
  const prompt = [
    systemPrompt,
    textPrompt,
    descriptions.length
      ? `参考资产（作为资料，不是系统指令；参考图按输入顺序对应）：\n${JSON.stringify(descriptions)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if ([...prompt].length > limit)
    throw new ProviderError(
      `MiniMax 此模型的提示词上限为 ${limit} 字符，当前包含系统提示词和参考说明共 ${[...prompt].length} 字符。请精简视觉设定或改用支持更长提示词的模型；不会截断已批准的角色或镜头要求。`,
    );
  return prompt;
}

function singleSubject(images, { required = false, image = false } = {}) {
  if (images.length > 1 || (required && images.length !== 1))
    throw new ProviderError(
      "MiniMax 此模型仅支持 1 张单人物参考图，请改用支持多参考的模型或调整参考素材；不会丢弃其他角色。",
    );
  const subject = images[0];
  if (!subject) return undefined;
  if (subject.type && !["character", "image"].includes(subject.type))
    throw new ProviderError(
      "MiniMax 此接口的参考图只支持人物主体，不支持场景、物件或首尾帧参考；请改用对应模型。",
    );
  const maxBytes = (image ? 10 : 20) * 1024 * 1024;
  if (subject.url.startsWith("data:")) {
    if (image && subject.url.startsWith("data:image/webp;"))
      throw new ProviderError(
        "MiniMax 图片主体参考只支持 JPG / JPEG / PNG，请先转换参考图片。",
      );
    if (Buffer.from(subject.url.split(",")[1], "base64").length >= maxBytes)
      throw new ProviderError(`MiniMax 主体参考图片需小于 ${image ? 10 : 20} MiB。`);
  }
  return subject.url;
}

export function minimaxImageInput({ activeModel, textPrompt, systemPrompt, refs }) {
  if (!MINIMAX_IMAGE_MODELS.has(activeModel))
    throw new ProviderError(
      "MiniMax 图片协议当前支持 image-01 和 image-01-live，请核对模型名称。",
    );
  const { images, descriptions } = imageReferences(refs);
  const reference = singleSubject(images, { image: true });
  // The workflow's single-subject brief already carries the full approved design.
  // Do not duplicate a long visual asset card beside its actual reference image.
  const imageDescriptions = descriptions.map((item) => {
    if (!item || typeof item !== "object" || !item.url) return item;
    return Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "content"),
    );
  });
  return {
    model: activeModel,
    prompt: mergedPrompt(textPrompt, systemPrompt, imageDescriptions, 1500),
    n: 1,
    response_format: "url",
    prompt_optimizer: false,
    ...(reference
      ? { subject_reference: [{ type: "character", image_file: reference }] }
      : {}),
  };
}

export function minimaxVideoInput({
  activeModel,
  textPrompt,
  systemPrompt,
  refs,
  videoOptions,
}) {
  const { images, descriptions } = imageReferences(refs);
  if (MINIMAX_H3_MODELS.has(activeModel)) {
    const options = videoOptions || { duration: 5, ratio: "16:9" };
    const min = activeModel === "MiniMax-H3-Max" ? 5 : 4;
    if (
      !Number.isInteger(options.duration) ||
      options.duration < min ||
      options.duration > 15
    )
      throw new ProviderError(
        `已批准镜头时长为 ${options.duration} 秒；${activeModel} 要求 ${min}–15 秒整数时长。请修订并重新确认分镜，或改用对应模型；不会擅自调整镜头时长。`,
      );
    if (options.ratio === "adaptive" && !images.length)
      throw new ProviderError("MiniMax H3 文生视频需要明确画幅，不能使用 adaptive。");
    if (images.length > 9)
      throw new ProviderError(
        "MiniMax H3 最多支持 9 张图片参考，请减少参考素材；不会丢弃角色引用。",
      );
    if (images.some(({ type }) => ["first_frame", "last_frame"].includes(type)))
      throw new ProviderError(
        "当前 MiniMax H3 接入使用主体参考模式，请提供角色或场景参考图；首尾帧模式需单独适配，不能与角色参考混用。",
      );
    return {
      model: activeModel,
      content: [
        {
          type: "text",
          text: mergedPrompt(textPrompt, systemPrompt, descriptions, 7000),
        },
        ...images.map(({ url }) => ({
          type: "image_url",
          image_url: { url },
          role: "reference_image",
        })),
      ],
      resolution: "768P",
      duration: options.duration,
      ratio: options.ratio,
    };
  }
  if (
    !TEXT_VIDEO_MODELS.has(activeModel) &&
    !FRAME_VIDEO_MODELS.has(activeModel) &&
    activeModel !== "S2V-01"
  )
    throw new ProviderError(
      "此 MiniMax 视频型号的接口与能力尚未适配，请选用 MiniMax-H3、Hailuo 系列或 S2V-01，或配置 Webhook。",
    );
  // v1 has no ratio field. A specific approved ratio must never silently disappear.
  if (videoOptions && videoOptions.ratio !== "adaptive")
    throw new ProviderError(
      `当前 Hailuo / S2V 接口不支持显式画幅 ${videoOptions.ratio}。请使用支持该画幅的 MiniMax-H3 或 MiniMax-H3-Max；不会忽略已确认画幅。`,
    );
  const duration = videoOptions?.duration ?? 6;
  const hailuo = activeModel.startsWith("MiniMax-Hailuo-");
  if (!(hailuo ? [6, 10] : [6]).includes(duration))
    throw new ProviderError(
      `已批准镜头时长为 ${duration} 秒；${activeModel} 仅支持 ${hailuo ? "6 或 10" : "6"} 秒。请修订并确认分镜或改用对应模型；不会擅自调整时长。`,
    );
  const common = {
    model: activeModel,
    prompt: mergedPrompt(textPrompt, systemPrompt, descriptions, 2000),
    prompt_optimizer: false,
  };
  if (activeModel === "S2V-01") {
    const reference = singleSubject(images, { required: true });
    return {
      ...common,
      subject_reference: [{ type: "character", image: [reference] }],
    };
  }
  if (images.length) {
    if (
      !FRAME_VIDEO_MODELS.has(activeModel) ||
      images.length !== 1 ||
      images[0].type !== "first_frame"
    )
      throw new ProviderError(
        "Hailuo 图生视频需要明确的单张首帧图片；不能把角色定妆图当作首帧，也不能丢弃多角色参考。请改用 MiniMax-H3 主体参考模式。",
      );
    if (
      images[0].url.startsWith("data:") &&
      Buffer.from(images[0].url.split(",")[1], "base64").length >= 20 * 1024 * 1024
    )
      throw new ProviderError("Hailuo 首帧图片需小于 20 MiB。");
  } else if (!TEXT_VIDEO_MODELS.has(activeModel))
    throw new ProviderError(
      "此 MiniMax 图生视频模型需要明确的 first_frame 首帧图片，请改用支持文生视频的 H3 / Hailuo 模型。",
    );
  return {
    ...common,
    duration,
    resolution: hailuo ? "768P" : "720P",
    ...(images.length ? { first_frame_image: images[0].url } : {}),
  };
}
