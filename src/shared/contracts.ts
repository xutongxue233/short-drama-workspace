import type { Asset } from "../types";
export type View =
  "workspace" | "assets" | "materials" | "agents" | "models" | "skills";
export type Tab = "chat" | "workflow" | "assets" | "materials" | "memory";
export type Action = (
  path: string,
  body?: unknown,
  success?: string,
  method?: string,
) => Promise<boolean>;
export interface AssetSelection {
  asset: Asset;
  projectId: string;
  projectName?: string;
}
export interface ToastMessage {
  message: string;
  kind: "success" | "error";
}
