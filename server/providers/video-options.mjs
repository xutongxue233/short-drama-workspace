import { ProviderError } from "./errors.mjs";

const RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]);
// Official creation API: integer seconds, Seedance 2.0 [4,15], 2.5 [4,30].
// https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh
const SEEDANCE_DURATIONS = new Map([
  ["doubao-seedance-2-0-260128", [4, 15]],
  ["doubao-seedance-2-0-fast-260128", [4, 15]],
  ["doubao-seedance-2-0-mini-260615", [4, 15]],
  ["doubao-seedance-2-5-260628", [4, 30]],
]);

export function videoOptionsInput(value, kind) {
  if (value === undefined) return undefined;
  if (kind !== "video") throw new ProviderError("只有视频请求可以传入视频时长和画幅。");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    !RATIOS.has(value.ratio)
  )
    throw new ProviderError(
      "视频参数需要明确的正数 duration（秒）和支持的 ratio（画幅），不能自动猜测。",
    );
  return { duration: value.duration, ratio: value.ratio };
}

export function arkVideoOptions(value, model) {
  // Legacy standalone adapter calls keep compatibility. Production workflow
  // supplies an explicit shot duration and the confirmed project ratio.
  if (value === undefined) return { duration: 5, ratio: "9:16" };
  const options = videoOptionsInput(value, "video");
  const range = SEEDANCE_DURATIONS.get(model);
  if (!range)
    throw new ProviderError(
      "当前方舟模型或 ep- 接入点的镜头时长边界尚未确认。请使用已验证的 Seedance 2.0 / 2.5 模型 ID，或通过 Webhook 明确适配；不会擅自调整镜头时长。",
    );
  if (
    !Number.isInteger(options.duration) ||
    options.duration < range[0] ||
    options.duration > range[1]
  )
    throw new ProviderError(
      `已批准镜头时长为 ${options.duration} 秒；当前 Seedance 模型要求 ${range[0]}–${range[1]} 秒的整数时长。请修订并重新确认分镜，或改用支持该时长的模型；不会自动拉长、缩短或跳过此镜。`,
    );
  return options;
}
