import {
  ArrowDown,
  AtSign,
  BookOpen,
  LoaderCircle,
  Paperclip,
  Pause,
  Play,
  Send,
  X,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "../../../components/AgentAvatar";
import type { Action } from "../../../shared/contracts";
import {
  findMentionQuery,
  splitMentions,
  type MentionQuery,
} from "../../../shared/mentions";
import type { Agent, Project } from "../../../types";
import { IconButton, Select } from "../../../ui";

const draftSentEvent = "yingxu:chat-draft-sent";

export function ChatComposer({
  project,
  agents,
  busy,
  onAction,
  onSource,
  autoFollow,
  onFollowLatest,
  onSendingChange,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
  onSource: () => void;
  autoFollow: boolean;
  onFollowLatest: () => void;
  onSendingChange?: (agentId: string | null) => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(`yingxu-draft-${project.id}`) || "";
    } catch {
      return "";
    }
  });
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [sending, setSending] = useState(false);
  const [intent, setIntent] = useState<"auto" | "discussion">("auto");
  const sendingRef = useRef(false);
  const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const composerBox = useRef<HTMLDivElement>(null);
  const nextSelection = useRef<number | null>(null);
  const path = `/projects/${project.id}`;
  const targetMenuId = useId();
  const recipientHintId = useId();
  const members = agents.filter(
    (agent) => agent.enabled && project.members.includes(agent.id),
  );
  const parts = splitMentions(text, members);
  const mentions = parts.filter((part) => part.agentId);
  const target = mentions[0]?.agentId;
  const targetAgent = members.find((agent) => agent.id === target);
  const candidates = mentionQuery
    ? members.filter((agent) =>
        `${agent.name} ${agent.role}`
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
      if (text) sessionStorage.setItem(`yingxu-draft-${project.id}`, text);
      else sessionStorage.removeItem(`yingxu-draft-${project.id}`);
    } catch {
      /* Draft persistence is optional when browser storage is unavailable. */
    }
  }, [project.id, text]);
  useEffect(() => {
    const clearSentDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; draft: string }>)
        .detail;
      if (detail?.projectId === project.id)
        setText((current) => (current === detail.draft ? "" : current));
    };
    window.addEventListener(draftSentEvent, clearSentDraft);
    return () => window.removeEventListener(draftSentEvent, clearSentDraft);
  }, [project.id]);
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

  const selectMention = (agent: Agent) => {
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(mentionQuery.end);
    const token = `@${agent.name}${after.startsWith(" ") ? "" : " "}`;
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
      .map((part) => (part.agentId === target ? "" : part.text))
      .join("");
    nextSelection.current = value.length;
    setText(value);
    setMentionQuery(null);
  };

  const send = async () => {
    if (!text.trim() || sendingRef.current || busy || composing.current) return;
    const draft = text;
    sendingRef.current = true;
    setSending(true);
    setMentionQuery(null);
    onSendingChange?.(target || "producer");
    onFollowLatest();
    try {
      const ok = await onAction(`${path}/messages`, {
        content: draft.trim(),
        agentId: target || undefined,
        ...(intent === "discussion" ? { intent } : {}),
      });
      if (ok) {
        // A reply can finish after this composer unmounts. Clear the saved draft
        // and notify a remounted instance without erasing newer user edits.
        try {
          const key = `yingxu-draft-${project.id}`;
          if (sessionStorage.getItem(key) === draft) sessionStorage.removeItem(key);
        } catch {
          /* The in-memory draft still works when storage is unavailable. */
        }
        window.dispatchEvent(
          new CustomEvent(draftSentEvent, { detail: { projectId: project.id, draft } }),
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
              part.agentId ? (
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
            placeholder="说说你的想法，或 @一位 Agent 开始协作…"
            rows={2}
          />
          {menuOpen && (
            <div className="mention-picker">
              <div className="mention-picker-heading">
                <span>选择回复 Agent</span>
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
                    <Avatar agent={agent} size="small" />
                    <span className="mention-option-copy">
                      <strong>{agent.name}</strong>
                      <small>{agent.role}</small>
                    </span>
                    <AtSign size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {!candidates.length && (
                <p className="mention-empty" role="status">
                  {members.length
                    ? "没有匹配的群成员，试试名称或角色。"
                    : "暂无可提及的成员，请先邀请并启用 Agent。"}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools">
            <Select
              className="chat-intent-select"
              aria-label="消息协作模式"
              value={intent}
              onChange={(event) =>
                setIntent(event.target.value as "auto" | "discussion")
              }
              title="自动协作：向总制片发送明确的创作指令会启动制作流程；仅讨论：只回复消息。"
            >
              <option value="auto">自动协作</option>
              <option value="discussion">仅讨论</option>
            </Select>
            <IconButton title="导入小说章节" label="导入小说章节" onClick={onSource}>
              <Paperclip size={18} />
            </IconButton>
            <IconButton
              className={target ? "selected" : ""}
              title="选择回复 Agent"
              label="选择回复 Agent"
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
              aria-controls={menuOpen ? targetMenuId : undefined}
              onClick={openMentions}
            >
              <AtSign size={18} />
            </IconButton>
            <span className="composer-divider" />
            <button className="source-text-button" onClick={onSource}>
              <BookOpen size={14} />
              本集原文<span>{project.chapters.length}</span>
            </button>
            {target && (
              <button
                className="target-label"
                title={`移除 @${targetAgent?.name || "Agent"}`}
                aria-label={`取消指定回复 Agent：${targetAgent?.name || "Agent"}`}
                onClick={removeRecipient}
              >
                <span>@{targetAgent?.name}</span>
                <X size={11} />
              </button>
            )}
          </div>
          <button
            className="send-button"
            aria-label="发送消息"
            title="发送消息（Ctrl / ⌘ + Enter）"
            disabled={!text.trim() || sending || busy}
            onClick={() => void send()}
          >
            {sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="composer-recipient" id={recipientHintId}>
          {new Set(mentions.map((part) => part.agentId)).size > 1
            ? `提及了多位成员，本次由首位「${targetAgent?.name}」回复`
            : targetAgent
              ? `由「${targetAgent.name}」回复`
              : intent === "auto"
                ? "总制片统筹 · 发送「开始制作」启动流程"
                : "仅讨论 · 未指定成员时由总制片回复"}
          <span>Ctrl / ⌘ + Enter 发送</span>
        </p>
      </div>
      <div className="composer-footer">
        <span>
          <span className="status-dot running" />
          使用 Agent 绑定的模型
        </span>
        {project.running ? (
          <button onClick={() => void onAction(`${path}/stop`)} disabled={busy}>
            <Pause size={12} />
            暂停制作
          </button>
        ) : (
          <button
            className="run-text-button"
            onClick={() => void onAction(`${path}/run`)}
            disabled={busy || !!project.approval || done || !project.chapters.length}
          >
            <Play size={12} />
            {done
              ? "本轮已完成"
              : project.approval
                ? "等待上方确认"
                : !project.chapters.length
                  ? "请先导入本集原文"
                  : project.nodes.some((n) => n.status === "failed")
                    ? "重试失败节点"
                    : "开始 / 继续制作"}
          </button>
        )}
      </div>
    </div>
  );
}
