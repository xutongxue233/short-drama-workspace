export type NodeStatus = "pending" | "running" | "waiting" | "completed" | "failed";
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  kind: "human" | "bot";
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
}
export type ProjectAccess = "owner" | "editor" | "member" | "viewer";
export interface ProjectParticipant {
  userId: string;
  username: string;
  displayName: string;
  kind: "human" | "bot";
  access: ProjectAccess;
  jobTitle?: string;
}
export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  color: string;
  enabled: boolean;
  providerId: string;
  model: string;
  systemPrompt: string;
  skillIds?: string[];
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type SkillUsage = Pick<Skill, "id" | "name" | "version">;
export interface Provider {
  id: string;
  name: string;
  kind: "text" | "image" | "video";
  protocol: "openai" | "webhook" | "anthropic" | "ark" | "minimax";
  baseUrl: string;
  model: string;
  hasKey: boolean;
  enabled: boolean;
}
export interface Message {
  id: string;
  agentId: string;
  sender?: Pick<PublicUser, "id" | "displayName" | "kind">;
  recipientUserId?: string;
  content: string;
  createdAt: string;
  type: "text" | "system" | "result" | "approval" | "error";
  nodeId?: string;
  replyTo?: string;
  event?: {
    skills?: SkillUsage[];
    kind:
      | "start"
      | "result"
      | "approval_requested"
      | "approved"
      | "revision_requested"
      | "handoff"
      | "error"
      | "paused"
      | "completed"
      | "progress";
    scope?: "workflow" | "chat";
    runId?: string;
    approvalId?: string;
    phase?: string;
    fromAgentId?: string;
    toAgentId?: string;
    fromNodeId?: string;
    toNodeId?: string;
  };
}
export interface WorkflowNode {
  id: string;
  name: string;
  description: string;
  agentId: string;
  status: NodeStatus;
  output: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  videoGeneration?: {
    providerId: string;
    baseUrl: string;
    model: string;
    shotId: string;
    requestKey: string;
    taskId: string;
  };
  characterGeneration?: {
    skills?: SkillUsage[];
    id: string;
    key: string;
    stage?: "pilot" | "batch";
    outputKind?: "image" | "text";
    pilotName?: string;
    images?: {
      captureId: string;
      name: string;
      status: string;
      result?: { url?: string };
    }[];
    plan: {
      name: string;
      description: string;
      content: string;
      characterDesign?: CharacterDesign;
    }[];
  };
}
export interface CharacterDesign {
  version: 1;
  subjectType: "person" | "object";
  baseAppearance: string;
  sceneStates: { name: string; description: string }[];
}
export interface Asset {
  id: string;
  name: string;
  type: "character" | "scene" | "storyboard" | "script" | "video" | "audio";
  description: string;
  content: string;
  url?: string;
  materialId?: string;
  locked: boolean;
  version: number;
  createdAt: string;
  tags: string[];
  characterDesign?: CharacterDesign;
  videoShot?: {
    id: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    storyboardId: string;
    storyboardVersion: number;
  };
}
export interface Material {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  projectId: string;
  nodeId?: string;
  assetId?: string;
  providerId?: string;
  model?: string;
  prompt?: string;
  referenceAssets?: {
    id: string;
    name: string;
    type: Asset["type"];
    version: number;
    materialId?: string;
  }[];
  providerTaskId?: string;
  videoShot?: Asset["videoShot"];
  sourceUrl: string;
  url: string;
  status: "local" | "remote" | "failed" | "downloading";
  mimeType?: string;
  bytes?: number;
  createdAt: string;
  savedAt?: string;
  error?: string;
}
export interface Memory {
  summary: string;
  facts: string[];
  decisions: string[];
  compressedCount: number;
  lastCompressedAt?: string;
}
export interface Approval {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  kind: "style" | "script" | "character" | "storyboard" | "delivery";
  phase?: "character-pilot";
  options?: string[];
  fields?: {
    id: string;
    label: string;
    type: "select" | "text";
    options?: string[];
    value?: string;
    required?: boolean;
    help?: string;
  }[];
  nextStep?: { name: string; agentId: string };
}
export interface Chapter {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}
export interface CurrentEpisode {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  startMessageIndex: number;
  startAssetIds: string[];
  startMaterialIds: string[];
  startDecisions?: string[];
}
export interface EpisodeArchive {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  archivedAt: string;
  chapters: Chapter[];
  nodes: WorkflowNode[];
  productionBrief?: Project["productionBrief"];
  memory: Memory;
  messages: Message[];
  assets: Asset[];
  materials: Material[];
}
export interface Project {
  counts?: ProjectCounts;
  snapshot?: { history: "recent" | "full" };
  messagePage?: Omit<MessagePage, "items" | "episodeId">;
  id: string;
  name: string;
  description: string;
  genre: string;
  style: string;
  visualStyleGuide?: string;
  createdAt: string;
  updatedAt: string;
  currentEpisode?: CurrentEpisode;
  episodeArchive?: EpisodeArchive[];
  members: string[];
  participants?: ProjectParticipant[];
  currentUserAccess?: ProjectAccess;
  messages: Message[];
  nodes: WorkflowNode[];
  assets: Asset[];
  materials?: Material[];
  chapters: Chapter[];
  memory: Memory;
  approval: Approval | null;
  running: boolean;
  backgroundTask?: "image-test" | null;
  chatPending?: { agentId: string; messageId: string; startedAt: string } | null;
  productionBrief?: {
    episodeCount: number;
    durationSeconds: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    platform: string;
  };
  workflowIssues?: { nodeId: string; agentId: string; message: string }[];
}
export interface WorkspaceState {
  skills?: Skill[];
  currentUser?: PublicUser;
  projects: Project[];
  projectSummaries?: ProjectSummary[];
  agents: Agent[];
  providers: Provider[];
}
export interface ProjectCounts {
  assets: number;
  materials: number;
  savedMaterials: number;
  episodes: number;
  messages: number;
}
export type ProjectSummary = Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "genre"
  | "style"
  | "createdAt"
  | "updatedAt"
  | "members"
  | "participants"
  | "currentUserAccess"
  | "running"
  | "approval"
  | "backgroundTask"
  | "chatPending"
> & {
  counts?: ProjectCounts;
  currentEpisode?: Pick<CurrentEpisode, "id" | "number" | "title" | "createdAt">;
};
export interface MessagePage {
  items: Message[];
  total: number;
  nextBefore: number | null;
  startIndex: number;
  episodeId: string | null;
}
export type Mutate = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<unknown>;
