import { Archive, ArrowRight, BookOpen, FileClock, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { TextContent } from "../../../components/TextContent";
import { statusNames } from "../../../shared/labels";
import type { Project } from "../../../types";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
} from "../../../ui";
import { canStartNextEpisode } from "../episodes";
import "../styles/episodes.css";

export function EpisodeArchiveDialog({
  project,
  onClose,
  onCreate,
  onActivity,
  onWorkflow,
}: {
  project: Project;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
  onActivity: (episodeId?: string) => void;
  onWorkflow: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const archives = project.episodeArchive ?? [];
  const selected = archives.find((episode) => episode.id === selectedId);
  const current = project.currentEpisode;
  const number = current?.number ?? 1;
  const viewed = selected ?? project;
  const viewedTitle = selected?.title ?? current?.title ?? `第 ${number} 集`;
  const done = viewed.nodes.filter((node) => node.status === "completed").length;
  const canAdvance = canStartNextEpisode(project);
  return (
    <Dialog
      title="剧集档案"
      description="逐集积累，无需预设整部短剧的总集数。"
      onClose={onClose}
      wide
      busy={saving}
      dirty={preparing && Boolean(title.trim())}
      className="episode-archive-dialog"
    >
      <DialogBody className="episode-archive-body">
        <div className="episode-library-summary">
          <Archive size={19} />
          <div>
            <strong>
              {archives.length + 1} 集已建立 · {archives.length} 集已归档
            </strong>
            <p>
              归档保存该集原文、节点产物、资产快照与工作记录；流程验收不等于已生成完整成片。
            </p>
          </div>
        </div>
        <div className="episode-library-layout">
          <nav className="episode-picker" aria-label="选择剧集">
            <button
              className={!selected ? "selected" : ""}
              aria-pressed={!selected}
              onClick={() => setSelectedId("")}
            >
              <span className="episode-picker-number">
                {String(number).padStart(2, "0")}
              </span>
              <span>
                <strong>{current?.title || `第 ${number} 集`}</strong>
                <small>
                  当前制作 ·{" "}
                  {project.nodes.filter((node) => node.status === "completed").length}/
                  {project.nodes.length} 节点
                </small>
              </span>
            </button>
            {[...archives].reverse().map((episode) => (
              <button
                key={episode.id}
                className={selected?.id === episode.id ? "selected" : ""}
                aria-pressed={selected?.id === episode.id}
                onClick={() => setSelectedId(episode.id)}
              >
                <span className="episode-picker-number">
                  {String(episode.number).padStart(2, "0")}
                </span>
                <span>
                  <strong>{episode.title}</strong>
                  <small>已归档 · 只读</small>
                </span>
              </button>
            ))}
          </nav>
          <section className="episode-detail" aria-label={`${viewedTitle}详情`}>
            <div className="episode-detail-heading">
              <div>
                <span>第 {selected?.number ?? number} 集</span>
                <h3>{viewedTitle}</h3>
              </div>
              <Badge tone={selected ? "neutral" : "accent"}>
                {selected ? "归档快照" : "当前一集"}
              </Badge>
            </div>
            <p className="episode-detail-meta">
              {viewed.chapters.length} 份原文 · {done}/{viewed.nodes.length} 节点验收
              {viewed.productionBrief &&
                ` · ${viewed.productionBrief.durationSeconds} 秒 · ${viewed.productionBrief.aspectRatio}`}
            </p>
            <div className="episode-detail-actions">
              <Button size="sm" onClick={() => onActivity(selected?.id)}>
                <FileClock size={14} />
                查看工作记录
              </Button>
              {!selected && (
                <DialogClose size="sm" variant="secondary" onConfirmClose={onWorkflow}>
                  进入本集流程
                  <ArrowRight size={14} />
                </DialogClose>
              )}
            </div>
            {selected ? (
              <>
                <div className="episode-snapshot-section">
                  <h4>本集原文</h4>
                  {selected.chapters.map((chapter) => (
                    <details key={chapter.id}>
                      <summary>
                        <BookOpen size={14} />
                        <span>{chapter.title}</span>
                        <small>{chapter.content.length.toLocaleString()} 字</small>
                      </summary>
                      <div className="episode-source-text">{chapter.content}</div>
                    </details>
                  ))}
                </div>
                <div className="episode-snapshot-section">
                  <h4>节点产物快照</h4>
                  {selected.nodes.map((node) => (
                    <details key={node.id}>
                      <summary>
                        <span>{node.name}</span>
                        <small>{statusNames[node.status]}</small>
                      </summary>
                      <div className="episode-node-output">
                        {node.error && <p className="error-text">{node.error}</p>}
                        {node.output ? (
                          <TextContent text={node.output} />
                        ) : (
                          <p>该节点没有留存文字产物。</p>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
                <p className="episode-archive-note">
                  归档时保存 {selected.assets.length} 份资产、
                  {selected.materials.length}{" "}
                  份素材记录。媒体文件继续在项目素材库中管理。
                </p>
              </>
            ) : (
              <div className="episode-current-note">
                <BookOpen size={20} />
                <p>
                  每集只导入当次需要改编的章节。验收本集全部节点后，可归档并开始下一集；已锁定角色、场景与项目素材继续保留。
                </p>
                {!canAdvance && <strong>本集尚有待处理事项，请先完成节点验收。</strong>}
              </div>
            )}
          </section>
        </div>
        {preparing && (
          <form
            id="next-episode-form"
            className="next-episode-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!canAdvance || pending.current) return;
              pending.current = true;
              setSaving(true);
              setError("");
              try {
                await onCreate(title.trim());
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "新集创建失败，请重试。",
                );
              } finally {
                pending.current = false;
                setSaving(false);
              }
            }}
          >
            <Field
              label={`第 ${number + 1} 集标题`}
              htmlFor="next-episode-title"
              optional
              hint="确认后归档当前一集，并打开新集的原文导入。"
            >
              <Input
                id="next-episode-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={`第 ${number + 1} 集`}
                maxLength={120}
                disabled={saving}
              />
            </Field>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </form>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose>返回工作台</DialogClose>
        {preparing ? (
          <Button
            key="confirm-next-episode"
            variant="primary"
            type="submit"
            form="next-episode-form"
            loading={saving}
            disabled={!canAdvance}
          >
            归档并创建第 {number + 1} 集
          </Button>
        ) : (
          <Button
            key="prepare-next-episode"
            variant="primary"
            disabled={!canAdvance}
            onClick={(event) => {
              // Do not let this click become a submit as the footer changes.
              event.preventDefault();
              setPreparing(true);
              setSelectedId("");
            }}
          >
            <Plus size={15} />
            开始下一集
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
