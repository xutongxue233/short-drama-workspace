import { ChevronRight, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Action } from "../../../shared/contracts";
import { projectMembers } from "../../../shared/project-members";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { ChatComposer } from "./ChatComposer";
import { ChatHistory } from "./ChatHistory";

export function ChatPanel({
  project,
  agents,
  busy,
  onAction,
  onSource,
  onInvite,
  onAssets,
  onNode,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onSource: () => void;
  onInvite: () => void;
  onAssets: () => void;
  onNode: (node: WorkflowNode) => void;
}) {
  const [autoFollow, setAutoFollow] = useState(true);
  const [replyingAgent, setReplyingAgent] = useState<string | null>(null);
  const pendingAgentId = project.chatPending?.agentId || replyingAgent;
  const approvalId = project.approval?.id;
  const following = useRef(true);
  const userScrolling = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const previousApproval = useRef<string | undefined>(undefined);
  const followLatest = () => {
    const viewport = scroll.current;
    if (viewport) {
      userScrolling.current = false;
      viewport.scrollTop = viewport.scrollHeight;
    }
  };
  useLayoutEffect(() => {
    const newApproval = approvalId !== previousApproval.current;
    previousApproval.current = approvalId;
    if (following.current && approvalId && newApproval) {
      const viewport = scroll.current;
      const card = history.current?.querySelector<HTMLElement>(".approval-card");
      if (viewport && card) {
        userScrolling.current = false;
        viewport.scrollTop +=
          card.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 14;
        const nearBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96;
        following.current = nearBottom;
        setAutoFollow(nearBottom);
        return;
      }
    }
    if (following.current) followLatest();
  }, [project.messages.length, approvalId, project.running, pendingAgentId]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (following.current) followLatest();
    });
    if (scroll.current) observer.observe(scroll.current);
    if (history.current) observer.observe(history.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="chat-panel">
      <div className="chat-context-bar">
        <span>
          <Users size={14} />
          <strong>本集创作群 · {projectMembers(project, agents).length} 位成员</strong>
          <i />
          总制片统筹，团队按制作节点协作。
        </span>
        <button className="text-button" onClick={onInvite}>
          群成员
          <ChevronRight size={12} />
        </button>
      </div>
      <div
        className="chat-scroll"
        ref={scroll}
        onWheelCapture={() => {
          userScrolling.current = true;
        }}
        onTouchMoveCapture={() => {
          userScrolling.current = true;
        }}
        onPointerDownCapture={(event) => {
          // Native scrollbar drags target the scrolling viewport itself.
          if (event.target === scroll.current) userScrolling.current = true;
        }}
        onKeyDownCapture={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
              " ",
              "Tab",
            ].includes(event.key)
          )
            userScrolling.current = true;
        }}
        onScroll={() => {
          const el = scroll.current;
          if (el) {
            // Removing an approval or adding results can trigger scroll anchoring.
            // Only user input may cancel the follow intent set by an action.
            if (following.current && !userScrolling.current) followLatest();
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
            if (userScrolling.current) following.current = nearBottom;
            setAutoFollow(nearBottom);
          }
        }}
      >
        <ChatHistory
          project={project}
          agents={agents}
          busy={busy}
          onAction={(...args) => {
            userScrolling.current = false;
            following.current = true;
            setAutoFollow(true);
            return onAction(...args);
          }}
          onNode={onNode}
          onAssets={onAssets}
          historyRef={history}
          pendingAgentId={pendingAgentId}
        />
      </div>
      <ChatComposer
        project={project}
        agents={agents}
        busy={busy || Boolean(project.chatPending)}
        onAction={onAction}
        onSource={onSource}
        autoFollow={autoFollow}
        onSendingChange={setReplyingAgent}
        onFollowLatest={() => {
          userScrolling.current = false;
          following.current = true;
          setAutoFollow(true);
          followLatest();
        }}
      />
    </div>
  );
}
