import type { Provider } from "../../types";
import { MessageSquareText, Image, Video } from "lucide-react";

export type ProviderKind = Provider["kind"];

export const kindLabels: Record<ProviderKind, string> = {
  text: "文本生成",
  image: "图像生成",
  video: "视频生成",
};

export const kindIcons = {
  text: MessageSquareText,
  image: Image,
  video: Video,
};

export const protocolLabels: Record<Provider["protocol"], string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic 原生",
  ark: "火山方舟原生",
  minimax: "MiniMax 原生",
  webhook: "自定义 Webhook",
};

export const protocolDescriptions: Record<Provider["protocol"], string> = {
  openai:
    "文本使用 Chat Completions，图片使用 Images Generations。请确认所选模型支持对应能力。",
  anthropic: "使用 Claude 原生 Messages 接口，适用于小说改编、剧本创作与分镜规划。",
  ark: "使用火山方舟原生图像与视频接口。视频任务提交后，工作台将持续查询生成进度。",
  minimax:
    "使用 MiniMax 原生图片与视频接口。图片直接返回结果，视频自动查询任务并将生成素材保存到本地。",
  webhook:
    "将创作要求发送到此地址，由你的服务调用模型并返回结果。视频和参考图创作需要服务端自行适配。",
};

export const protocolTestDescriptions: Record<Provider["protocol"], string> = {
  openai: "通过模型列表接口检查连接与认证。通过测试不代表所有生成模型都可用。",
  anthropic: "通过 Anthropic 模型列表接口检查连接与认证，不调用 Messages 生成接口。",
  ark: "检查方舟任务接口，不提交生成任务。图片与模型权限仍需通过真实创作验证。",
  minimax: "通过 MiniMax 模型列表检查连接与认证，不提交图片或视频生成任务。",
  webhook:
    "Webhook 服务需要支持 GET 健康检查。通过连接测试后，还需用真实创作任务验证返回内容。",
};

export function supportsProtocol(protocol: Provider["protocol"], kind: ProviderKind) {
  return (
    protocol === "webhook" ||
    (protocol === "anthropic"
      ? kind === "text"
      : protocol === "ark" || protocol === "minimax"
        ? kind !== "text"
        : kind !== "video")
  );
}
