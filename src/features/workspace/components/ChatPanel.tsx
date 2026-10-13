import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Action } from "../../../shared/contracts";
import type { Agent, Project, Skill, WorkflowNode } from "../../../types";
import { ChatComposer } from "./ChatComposer";
import { ChatHistory } from "./ChatHistory";
import { Button } from "../../../ui";
import { useMessageHistory } from "../useMessageHistory";

export function ChatPanel({
  project,
  agents,
  skills = [],
  busy,
  onAction,
  onSource,
  onAssets,
  onNode,
}: {
  project: Project;
  agents: Agent[];
  skills?: Skill[];
  busy: boolean;
  onAction: Action;
  onSource: () => void;
  onAssets: () => void;
  onNode: (node: WorkflowNode) => void;
}) {
  const [autoFollow, setAutoFollow] = useState(true);
  const [replyingAgent, setReplyingAgent] = useState<string | null>(null);
  const messageHistory = useMessageHistory(project);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const pendingAgentId = project.chatPending?.agentId || replyingAgent;
  const approvalId = project.approval?.id;
  const following = useRef(true);
  const userScrolling = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const previousApproval = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!anchor.current || !scroll.current) return;
    const saved = anchor.current;
    const element = Array.from(
      history.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((item) => item.dataset.messageId === saved.id);
    if (element)
      scroll.current.scrollTop += element.getBoundingClientRect().top - saved.top;
    anchor.current = null;
  }, [messageHistory.startIndex]);
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
  }, [messageHistory.messages.length, approvalId, project.running, pendingAgentId]);
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
        {messageHistory.nextBefore !== null && (
          <div className="chat-history-pagination">
            <Button
              size="sm"
              variant="ghost"
              loading={messageHistory.loading}
              onClick={async () => {
                following.current = false;
                userScrolling.current = true;
                setAutoFollow(false);
                const top = scroll.current?.getBoundingClientRect().top ?? 0;
                const visible = Array.from(
                  history.current?.querySelectorAll<HTMLElement>("[data-message-id]") ??
                    [],
                ).find((item) => item.getBoundingClientRect().bottom > top);
                anchor.current = visible?.dataset.messageId
                  ? {
                      id: visible.dataset.messageId,
                      top: visible.getBoundingClientRect().top,
                    }
                  : null;
                if (!(await messageHistory.loadEarlier())) anchor.current = null;
              }}
            >
              {messageHistory.error ? "重试加载更早消息" : "查看更早消息"}
            </Button>
            {messageHistory.error && <p role="alert">{messageHistory.error}</p>}
          </div>
        )}
        <ChatHistory
          project={{ ...project, messages: messageHistory.messages }}
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
          onSource={onSource}
          historyRef={history}
          pendingAgentId={pendingAgentId}
        />
      </div>
      <ChatComposer
        project={project}
        agents={agents}
        skills={skills}
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
