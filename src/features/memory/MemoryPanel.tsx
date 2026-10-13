import {
  BookOpen,
  BrainCircuit,
  Check,
  CheckCheck,
  Layers3,
  LockKeyhole,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { TextContent } from "../../components/TextContent";
import type { Action } from "../../shared/contracts";
import type { Project } from "../../types";
import { Button, IconButton } from "../../ui";

export function MemoryPanel({
  project,
  busy,
  onAction,
}: {
  project: Project;
  busy: boolean;
  onAction: Action;
}) {
  const [fact, setFact] = useState("");
  const memory = project.memory;
  const path = `/projects/${project.id}`;
  async function saveFact(event: React.FormEvent) {
    event.preventDefault();
    if (!fact.trim() || busy) return;
    const draft = fact;
    const ok = await onAction(
      `${path}/memory/facts`,
      { fact: draft.trim() },
      "已加入项目事实",
    );
    if (ok) setFact((current) => (current === draft ? "" : current));
  }
  return (
    <div className="tab-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">A SHARED UNDERSTANDING</div>
          <h2>对话可以很长，故事不会走散</h2>
          <p>原著、事实与已确认决策共同构成这个项目的创作上下文。</p>
        </div>
        <Button
          variant="primary"
          disabled={busy || project.running}
          onClick={() => void onAction(`${path}/memory/compress`, {}, "项目记忆已整理")}
        >
          <BrainCircuit size={15} />
          整理记忆
        </Button>
      </div>
      <div className="memory-stats">
        <div>
          <BookOpen size={20} />
          <strong>{project.chapters.length}</strong>
          <span>本集原文</span>
        </div>
        <div>
          <LockKeyhole size={20} />
          <strong>{memory.facts.length}</strong>
          <span>固定事实</span>
        </div>
        <div>
          <CheckCheck size={20} />
          <strong>{memory.decisions.length}</strong>
          <span>已确认决策</span>
        </div>
        <div>
          <Layers3 size={20} />
          <strong>{memory.compressedCount}</strong>
          <span>已压缩消息</span>
        </div>
      </div>
      <section className="memory-section">
        <div className="section-heading">
          <h3>
            <BrainCircuit size={17} />
            阶段摘要
          </h3>
          <span className="muted">
            {memory.lastCompressedAt
              ? new Date(memory.lastCompressedAt).toLocaleString("zh-CN")
              : "开始制作后自动更新"}
          </span>
        </div>
        <TextContent
          text={
            memory.summary ||
            "还没有阶段摘要。导入本集原文并运行制作流程后，主控会记录阶段进展。"
          }
        />
        <p className="memory-note">
          整理记忆会更新供 Agent 使用的摘要；完整聊天记录与原著仍保留。
        </p>
      </section>
      <div className="memory-columns">
        <section className="memory-section">
          <h3>
            <LockKeyhole size={17} />
            不可丢失的事实
          </h3>
          <p className="muted">例如角色身份、时间线和世界观规则。</p>
          <div className="fact-list">
            {memory.facts.map((f, i) => (
              <div key={i}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{f}</p>
                <LockKeyhole size={12} />
              </div>
            ))}
          </div>
          <form className="fact-form" onSubmit={(event) => void saveFact(event)}>
            <input
              aria-label="添加项目事实"
              maxLength={1000}
              placeholder="添加一条需要始终遵循的事实…"
              value={fact}
              onChange={(e) => setFact(e.target.value)}
            />
            <IconButton type="submit" label="保存事实" disabled={!fact.trim() || busy}>
              <Plus size={17} />
            </IconButton>
          </form>
        </section>
        <section className="memory-section">
          <h3>
            <CheckCheck size={17} />
            创作决策
          </h3>
          <div className="decision-list">
            {memory.decisions.length ? (
              memory.decisions.map((d, i) => (
                <div key={i}>
                  <Check size={13} />
                  <p>{d}</p>
                </div>
              ))
            ) : (
              <p className="muted">你确认的风格、剧本和资产将记录在这里。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
