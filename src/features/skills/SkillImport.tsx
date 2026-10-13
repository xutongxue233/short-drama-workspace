import { useId, useRef, useState, type FormEvent } from "react";
import { FileUp } from "lucide-react";
import { request } from "../../api";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Textarea,
} from "../../ui";
import type { SkillDraft } from "./SkillEditor";

export function SkillImport({
  onClose,
  onParsed,
}: {
  onClose: () => void;
  onParsed: (draft: SkillDraft) => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  async function readFile(file: File) {
    if (busy) return;
    setError("");
    if (!/\.md$/i.test(file.name) || file.size > 128 * 1024) {
      setError("请选择不超过 128 KB 的 Markdown（.md）文件。");
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      if (content.length > 64 * 1024) throw new Error("文件内容不能超过 65,536 字符。");
      setMarkdown(content);
      setFilename(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取文件，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function parse(event: FormEvent) {
    event.preventDefault();
    if (busy || !markdown.trim()) return;
    setBusy(true);
    setError("");
    try {
      const draft = await request<Omit<SkillDraft, "enabled">>("/skills/parse", {
        markdown,
      });
      onParsed({ ...draft, enabled: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "解析失败，请检查 SKILL.md 格式。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导入 SKILL.md"
      description="选择 Markdown 文件或粘贴内容，检查名称、用途和指令后再保存。"
      className="settings-dialog skill-editor"
      wide
      busy={busy}
      dirty={Boolean(markdown)}
      onClose={onClose}
    >
      <form onSubmit={parse} aria-busy={busy}>
        <DialogBody className="settings-form-body">
          <fieldset className="settings-form-fields" disabled={busy}>
            <div className="skill-import-file">
              <Button onClick={() => inputRef.current?.click()} disabled={busy}>
                <FileUp size={16} />
                选择 .md 文件
              </Button>
              <span>{filename || "最多 128 KB"}</span>
              <input
                ref={inputRef}
                type="file"
                accept=".md,text/markdown"
                aria-label="选择 SKILL.md 文件"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readFile(file);
                }}
              />
            </div>
            <Field
              label="SKILL.md 内容"
              htmlFor={`${formId}-markdown`}
              hint="文件以 --- 包围的 YAML 开头，包含 name 与 description；后面是 Markdown 指令。"
            >
              <Textarea
                className="skill-instructions"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                required
                maxLength={65536}
                rows={13}
                placeholder={
                  "---\nname: review-drama\ndescription: 检查短剧剧本的节奏与人物动机\n---\n\n# 审阅步骤\n1. 阅读当前剧本…"
                }
              />
            </Field>
            {error && (
              <p className="skill-error" role="alert">
                {error}
              </p>
            )}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={busy}>取消</DialogClose>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!markdown.trim() || busy}
          >
            检查技能
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
