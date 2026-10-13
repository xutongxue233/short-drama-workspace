import {
  ArrowDown,
  AtSign,
  BookOpen,
  LoaderCircle,
  Pause,
  Play,
  Send,
  X,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MemberAvatar, MemberKindBadge } from "../../../components/MemberIdentity";
import {
  projectMembers,
  projectPermissions,
  type RosterMember,
} from "../../../shared/project-members";
import type { Action } from "../../../shared/contracts";
import {
  findMentionQuery,
  splitMentions,
  type MentionQuery,
} from "../../../shared/mentions";
import type { Agent, Project } from "../../../types";
import { IconButton, Select } from "../../../ui";

const draftSentEvent = "yingxu:chat-draft-sent";
type ChatIntent = "group" | "auto" | "discussion";

function readDraft(
  draftKey: string,
  fallback: ChatIntent,
): { text: string; intent: ChatIntent } {
  try {
    const saved = sessionStorage.getItem(draftKey) || "";
    try {
      const draft = JSON.parse(saved);
      if (
        draft?.version === 1 &&
        typeof draft.text === "string" &&
        ["group", "auto", "discussion"].includes(draft.intent)
      )
        return { text: draft.text, intent: draft.intent };
    } catch {
      // Earlier releases stored just the message text.
    }
    return { text: saved, intent: fallback };
  } catch {
    return { text: "", intent: fallback };
  }
}

export function ChatComposer({
  project,
  agents,
  busy,
  onAction,
  onSource,
  autoFollow,
  onFollowLatest,
  onSendingChange,
  currentUserId,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onSource: () => void;
  autoFollow: boolean;
  onFollowLatest: () => void;
  onSendingChange?: (agentId: string | null) => void;
  currentUserId?: string;
}) {
  const { canChat, canEdit } = projectPermissions(project);
  const defaultIntent: ChatIntent = project.currentUserAccess ? "group" : "auto";
  const draftKey = currentUserId
    ? `yingxu-draft-${currentUserId}-${project.id}`
    : `yingxu-draft-${project.id}`;
  const [savedDraft] = useState(() => readDraft(draftKey, defaultIntent));
  const [text, setText] = useState(savedDraft.text);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [sending, setSending] = useState(false);
  const [intent, setIntent] = useState<ChatIntent>(savedDraft.intent);
  const sendingRef = useRef(false);
  const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const composerBox = useRef<HTMLDivElement>(null);
  const nextSelection = useRef<number | null>(null);
  const path = `/projects/${project.id}`;
  const targetMenuId = useId();
  const recipientHintId = useId();
  const members = projectMembers(project, agents, currentUserId).filter(
    (member) => member.kind !== "agent" || member.agent?.enabled,
  );
  const parts = splitMentions(text, members);
  const mentions = parts.filter((part) => part.agentId || part.userId);
  const target = mentions[0]?.agentId || mentions[0]?.userId;
  const targetMember = members.find((member) => member.id === target);
  const targetAgent = targetMember?.kind === "agent" ? targetMember : undefined;
  const groupMessage =
    parts.some((part) => part.ambiguous) ||
    !canEdit ||
    Boolean(mentions[0]?.userId) ||
    (!targetAgent && intent === "group");
  const candidates = mentionQuery
    ? members.filter(
        (agent) =>
          (canEdit || agent.kind !== "agent") &&
          `${agent.name} ${agent.role} ${agent.username || ""}`
            .toLocaleLowerCase()
            .includes(mentionQuery.query.toLocaleLowerCase()),
      )
    : [];
  const selectedOption = Math.min(activeOption, Math.max(candidates.length - 1, 0));
  const menuOpen = mentionQuery !== null;
  const syncHighlight = () => {
    if (!composer.current || !highlight.current) return;
    highlight.current.style.width = `${composer.current.clientWidth}px`;
    highlight.current.scrollTop = composer.current.scrollTop;
    highlight.current.scrollLeft = composer.current.scrollLeft;
  };
  const updateQuery = (value: string, caret: number) => {
    setMentionQuery(composing.current ? null : findMentionQuery(value, caret, members));
    setActiveOption(0);
  };
  useLayoutEffect(() => {
    if (nextSelection.current !== null && composer.current) {
      composer.current.focus({ preventScroll: true });
      composer.current.setSelectionRange(nextSelection.current, nextSelection.current);
      nextSelection.current = null;
    }
    syncHighlight();
  }, [text]);
  useEffect(() => {
    if (!composer.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncHighlight);
    observer.observe(composer.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      if (text || intent !== defaultIntent)
        sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, text, intent }));
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* Draft persistence is optional when browser storage is unavailable. */
    }
  }, [draftKey, defaultIntent, text, intent]);
  useEffect(() => {
    const clearSentDraft = (event: Event) => {
      const detail = (
        event as CustomEvent<{ draftKey: string; draft: string; intent: ChatIntent }>
      ).detail;
      if (detail?.draftKey === draftKey && detail.intent === intent)
        setText((current) => (current === detail.draft ? "" : current));
    };
    window.addEventListener(draftSentEvent, clearSentDraft);
    return () => window.removeEventListener(draftSentEvent, clearSentDraft);
  }, [draftKey, intent]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!composerBox.current?.contains(event.target as Node)) setMentionQuery(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    document
      .getElementById(`${targetMenuId}-${selectedOption}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [menuOpen, selectedOption, targetMenuId]);

  const selectMention = (agent: RosterMember) => {
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(mentionQuery.end);
    const duplicateName =
      members.filter((member) => member.name === agent.name).length > 1;
    const mentionName = duplicateName && agent.username ? agent.username : agent.name;
    const token = `@${mentionName}${after.startsWith(" ") ? "" : " "}`;
    const value = `${before}${token}${after}`;
    if (value.length > 10000) return;
    nextSelection.current = before.length + token.length;
    setText(value);
    setMentionQuery(null);
  };

  const openMentions = () => {
    const input = composer.current;
    if (!input) return;
    const query = findMentionQuery(text, input.selectionStart, members);
    if (query) {
      input.focus({ preventScroll: true });
      setMentionQuery(query);
    } else {
      const start = input.selectionStart;
      const before = text.slice(0, start);
      const prefix = before && !/\s$/.test(before) ? " @" : "@";
      const value = before + prefix + text.slice(input.selectionEnd);
      if (value.length > 10000) return;
      const caret = before.length + prefix.length;
      nextSelection.current = caret;
      setText(value);
      setMentionQuery({ start: caret - 1, end: caret, query: "" });
    }
    setActiveOption(0);
  };

  const removeRecipient = () => {
    const value = parts
      .map((part) =>
        target && (part.agentId === target || part.userId === target) ? "" : part.text,
      )
      .join("");
    nextSelection.current = value.length;
    setText(value);
    setMentionQuery(null);
  };

  const send = async () => {
    if (!canChat || !text.trim() || sendingRef.current || busy || composing.current)
      return;
    const draft = text;
    sendingRef.current = true;
    setSending(true);
    setMentionQuery(null);
    onSendingChange?.(groupMessage ? null : targetAgent?.id || "producer");
    onFollowLatest();
    try {
      const ok = await onAction(`${path}/messages`, {
        content: draft.trim(),
        agentId: groupMessage ? null : targetAgent?.id || undefined,
        ...(mentions[0]?.userId ? { recipientUserId: mentions[0].userId } : {}),
        ...(!groupMessage && intent === "discussion" ? { intent } : {}),
      });
      if (ok) {
        // A reply can finish after this composer unmounts. Clear the saved draft
        // and notify a remounted instance without erasing newer user edits.
        try {
          const key = draftKey;
          const saved = readDraft(draftKey, defaultIntent);
          if (saved.text === draft && saved.intent === intent)
            sessionStorage.removeItem(key);
        } catch {
          /* The in-memory draft still works when storage is unavailable. */
        }
        window.dispatchEvent(
          new CustomEvent(draftSentEvent, {
            detail: { draftKey, draft, intent },
          }),
        );
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      onSendingChange?.(null);
    }
  };
  const done =
    project.nodes.length > 0 && project.nodes.every((n) => n.status === "completed");

  return (
    <div className="composer-wrap">
      {!autoFollow && (
        <button className="latest-button" onClick={onFollowLatest}>
          <ArrowDown size={13} />
          回到最新消息
        </button>
      )}
      <div className="composer" ref={composerBox}>
        <div className="composer-editor">
          <div className="composer-highlight" ref={highlight} aria-hidden="true">
            {parts.map((part, index) =>
              part.agentId || part.userId ? (
                <mark className="composer-mention" key={index}>
                  {part.text}
                </mark>
              ) : (
                part.text
              ),
            )}
            {"\n"}
          </div>
          <textarea
            ref={composer}
            aria-label="群聊消息"
            disabled={!canChat}
            maxLength={10000}
            value={text}
            aria-autocomplete="list"
            aria-controls={menuOpen ? targetMenuId : undefined}
            aria-activedescendant={
              menuOpen && candidates.length
                ? `${targetMenuId}-${selectedOption}`
                : undefined
            }
            aria-describedby={recipientHintId}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              updateQuery(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) =>
              updateQuery(e.currentTarget.value, e.currentTarget.selectionStart)
            }
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                updateQuery(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onScroll={syncHighlight}
            onBlur={(e) => {
              if (!composerBox.current?.contains(e.relatedTarget))
                setMentionQuery(null);
            }}
            onCompositionStart={() => {
              composing.current = true;
              setMentionQuery(null);
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              updateQuery(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)
                return;
              if (menuOpen) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
                if (candidates.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  setActiveOption(
                    (selectedOption +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      candidates.length) %
                      candidates.length,
                  );
                  return;
                }
                if (
                  candidates.length &&
                  ((e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
                    (e.key === "Tab" && !e.shiftKey))
                ) {
                  e.preventDefault();
                  selectMention(candidates[selectedOption]);
                  return;
                }
                if (e.key === "Tab") setMentionQuery(null);
              }
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={canChat ? "输入消息，@ 提及群成员…" : "只读成员暂不能发送消息"}
            rows={2}
          />
          {menuOpen && (
            <div className="mention-picker">
              <div className="mention-picker-heading">
                <span>提及群成员</span>
                <small>↑↓ 选择 · Enter 确认</small>
              </div>
              <div
                id={targetMenuId}
                className="mention-options"
                role="listbox"
                aria-label="可提及的群成员"
              >
                {candidates.map((agent, index) => (
                  <button
                    type="button"
                    role="option"
                    tabIndex={-1}
                    id={`${targetMenuId}-${index}`}
                    key={agent.id}
                    aria-selected={selectedOption === index}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectMention(agent)}
                    onMouseEnter={() => setActiveOption(index)}
                  >
                    <MemberAvatar member={agent} size="small" />
                    <span className="mention-option-copy">
                      <strong>
                        {agent.name} <MemberKindBadge kind={agent.kind} />
                      </strong>
                      <small>
                        {agent.role ||
                          (agent.kind === "agent"
                            ? "AI 回复"
                            : `@${agent.username || agent.name}`)}
                      </small>
                    </span>
                    <AtSign size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {!candidates.length && (
                <p className="mention-empty" role="status">
                  {members.length
                    ? "没有匹配的群成员，试试名称或角色。"
                    : "暂无可提及的成员，请联系项目所有者添加成员。"}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools">
            {canEdit && (
              <Select
                className="chat-intent-select"
                aria-label="消息协作模式"
                value={intent}
                onChange={(event) => setIntent(event.target.value as ChatIntent)}
                title="群聊发送给团队；@ Agent 时请求 AI 回复。自动协作可启动制作；仅讨论让 AI 只回复。"
              >
                <option value="group">群聊</option>
                <option value="auto">自动协作</option>
                <option value="discussion">仅讨论</option>
              </Select>
            )}
            <IconButton
              className={target ? "selected" : ""}
              title="提及群成员"
              label="提及群成员"
              disabled={!canChat}
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
              aria-controls={menuOpen ? targetMenuId : undefined}
              onClick={openMentions}
            >
              <AtSign size={18} />
            </IconButton>
            {canEdit && (
              <button className="source-text-button" onClick={onSource}>
                <BookOpen size={14} />
                {project.chapters.length ? (
                  <>
                    本集原文<span>{project.chapters.length}</span>
                  </>
                ) : (
                  "导入原文"
                )}
              </button>
            )}
            {target && (
              <button
                className="target-label"
                title={`移除 @${targetMember?.name || "成员"}`}
                aria-label={`取消提及：${targetMember?.name || "成员"}`}
                onClick={removeRecipient}
              >
                <span>@{targetMember?.name}</span>
                <X size={11} />
              </button>
            )}
          </div>
          <button
            className="send-button"
            aria-label="发送消息"
            title="发送消息（Ctrl / ⌘ + Enter）"
            disabled={!canChat || !text.trim() || sending || busy}
            onClick={() => void send()}
          >
            {sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
      <div className="composer-footer">
        <p className="composer-recipient" id={recipientHintId}>
          {!canChat
            ? "只读权限 · 可查看项目内容"
            : parts.some((part) => part.ambiguous)
              ? "存在同名成员，请使用 @用户名；本条消息仅发送到群聊"
              : groupMessage
                ? targetMember && targetMember.kind !== "agent"
                  ? `提及「${targetMember.name}」，发送到群聊`
                  : "发送到群聊，所有项目成员可见"
                : new Set(mentions.map((part) => part.agentId || part.userId)).size > 1
                  ? `提及了多位成员，本次由首位「${targetAgent?.name}」回复`
                  : targetAgent
                    ? `由「${targetAgent.name}」回复`
                    : "由总制片回复"}
        </p>
        {canEdit &&
          (project.running ? (
            <button onClick={() => void onAction(`${path}/stop`)} disabled={busy}>
              <Pause size={12} />
              暂停制作
            </button>
          ) : !project.approval && !done && project.chapters.length > 0 ? (
            <button
              className="run-text-button"
              onClick={() => void onAction(`${path}/run`)}
              disabled={busy}
            >
              <Play size={12} />
              {project.nodes.some((n) => n.status === "failed")
                ? "重试失败节点"
                : project.nodes.every((n) => n.status === "pending" && !n.startedAt)
                  ? "开始制作"
                  : "继续制作"}
            </button>
          ) : null)}
      </div>
    </div>
  );
}
