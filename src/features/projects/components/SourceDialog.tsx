import { BookOpen, FileText, LoaderCircle, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import type { Project } from "../../../types";
import {
  Alert,
  Form,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
  Textarea,
} from "../../../ui";

export function SourceDialog({
  project,
  onClose,
  onImport,
}: {
  project: Project;
  onClose: () => void;
  onImport: (data: { title: string; content: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const close = () => {
    if (!saving && !reading) onClose();
  };
  const importDisabled =
    saving || reading || project.running || Boolean(project.backgroundTask);
  async function readFile(file: File) {
    if (input.current) input.current.value = "";
    if (file.size > 2 * 1024 * 1024) {
      setFileError("单次导入文件请控制在 2 MB 内，并按章节拆分。");
      return;
    }
    setReading(true);
    setFileError("");
    try {
      const text = await file.text();
      if (text.length > 200000) {
        setFileError("单个章节最多 20 万字，请拆分后导入。");
        return;
      }
      setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
      setContent(text);
    } catch {
      setFileError("无法读取文件，请重新选择文件，或直接粘贴原文。");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <Dialog
      title="把故事交给创作团队"
      description="导入本集要改编的章节或片段，可以分次添加；团队将据此创作一集，无需上传整本小说。"
      onClose={close}
      busy={saving || reading}
      dirty={Boolean(title || content)}
      wide
    >
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || importDisabled || !content.trim()) return;
          pending.current = true;
          setSaving(true);
          setError("");
          try {
            await onImport({
              title: title.trim() || `原文片段 ${project.chapters.length + 1}`,
              content,
            });
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "导入失败，请重试。原文已保留。",
            );
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      >
        <DialogBody className="studio-form-body">
          {project.chapters.length > 0 && (
            <div className="existing-chapters">
              {project.chapters.map((c) => (
                <details key={c.id}>
                  <summary>
                    <BookOpen size={13} />
                    <span className="chapter-title" title={c.title}>
                      {c.title}
                    </span>
                    <span>{c.content.length.toLocaleString()} 字</span>
                  </summary>
                  <p>{c.content}</p>
                </details>
              ))}
            </div>
          )}
          <div className="source-import-bar">
            <span>
              <FileText size={15} />
              粘贴文字，或导入 TXT / Markdown
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={importDisabled}
              onClick={() => input.current?.click()}
            >
              {reading ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Paperclip size={14} />
              )}
              选择文件
            </Button>
            <input
              ref={input}
              hidden
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>
          {fileError && <Alert tone="danger">{fileError}</Alert>}
          {project.running && (
            <Alert tone="warning">项目正在制作，请先暂停制作再导入新章节。</Alert>
          )}
          {project.backgroundTask && (
            <Alert tone="info">图片测试进行中，请等待测试完成再导入新章节。</Alert>
          )}
          <Field htmlFor="studio-field-6" label="章节或片段标题" optional>
            <Input
              value={title}
              maxLength={120}
              placeholder={`例如：第 1–3 章，或原文片段 ${project.chapters.length + 1}`}
              onChange={(e) => setTitle(e.target.value)}
              disabled={importDisabled}
            />
          </Field>
          <Field
            htmlFor="studio-field-7"
            label="原著内容"
            hint={
              <>
                {content.length.toLocaleString()} / 200,000 字 ·
                只需提供本集相关原文，可分次补充
              </>
            }
          >
            <Textarea
              required
              maxLength={200000}
              rows={11}
              value={content}
              placeholder="在这里粘贴需要改编的小说内容…"
              onChange={(e) => setContent(e.target.value)}
              disabled={importDisabled}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving || reading}>取消</DialogClose>
          <Button
            variant="primary"
            loading={saving}
            disabled={importDisabled}
            type="submit"
          >
            <BookOpen size={15} />
            导入本集原文
          </Button>
        </DialogFooter>
      </Form>
    </Dialog>
  );
}
