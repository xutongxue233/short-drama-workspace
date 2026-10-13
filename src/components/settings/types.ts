import type { Mutate, WorkspaceState } from "../../types";

export interface SettingsProps {
  state: WorkspaceState;
  mutate: Mutate;
  notify: (message: string, kind?: "success" | "error") => void;
}
