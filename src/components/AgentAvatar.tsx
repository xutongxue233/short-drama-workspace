import {
  Clapperboard,
  FileText,
  Image,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import type { Agent } from "../types";

const avatarIcon = (id: string) =>
  /director|storyboard/.test(id)
    ? Clapperboard
    : /character|art/.test(id)
      ? Image
      : /writer|adapt/.test(id)
        ? FileText
        : /compliance|review/.test(id)
          ? ShieldCheck
          : /video|editor/.test(id)
            ? Video
            : Sparkles;

export function Avatar({
  agent,
  size = "normal",
}: {
  agent?: Agent;
  size?: "normal" | "small";
}) {
  const Icon = avatarIcon(agent?.id || "");
  return (
    <span
      className={`avatar ${size}`}
      style={{ "--agent-color": agent?.color || "#7062d9" } as React.CSSProperties}
    >
      <Icon size={size === "small" ? 14 : 19} />
    </span>
  );
}
