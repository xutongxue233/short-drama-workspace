import {
  Bot,
  Clapperboard,
  Image,
  MessageSquareText,
  Scissors,
  ShieldCheck,
  Video,
} from "lucide-react";

export const agentIcon = (id: string) =>
  id === "writer"
    ? MessageSquareText
    : id === "compliance"
      ? ShieldCheck
      : id === "character"
        ? Image
        : id === "director"
          ? Clapperboard
          : id === "video"
            ? Video
            : id === "editor"
              ? Scissors
              : Bot;
