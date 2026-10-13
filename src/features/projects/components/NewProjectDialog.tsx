import { BookOpen, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
  Select,
  Textarea,
} from "../../../ui";

export function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: unknown) => Promise<void>;
}) {
  const id = useId();
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("悬疑");
  const [style, setStyle] = useState("真人短剧");
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <Dialog
      title="开一个群，拍一个好故事"
      description="建立独立的创作群，按你提供的原文制作当前一集。"
      onClose={close}
      busy={saving}
      dirty={Boolean(name || description || genre !== "悬疑" || style !== "真人短剧")}
    >
      <form
        aria-label="创建项目"
        aria-busy={saving || undefined}
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || !name.trim()) return;
          pending.current = true;
          setSaving(true);
          try {
            await onCreate({
              name: name.trim(),
              description: description.trim(),
              genre,
              style,
            });
          } catch {
            /* Keep the form so the request can be retried. */
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      >
        <DialogBody className="studio-form-body">
          <Field htmlFor={`${id}-name`} label="项目名称">
            <Input
              required
              maxLength={80}
              placeholder="例如：长夜有回声"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field htmlFor={`${id}-description`} label="故事简介" optional>
            <Textarea
              maxLength={2000}
              placeholder="一句话介绍这个故事，或者写下你的改编方向…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
          </Field>
          <div className="form-row">
            <Field htmlFor={`${id}-genre`} label="故事类型">
              <Select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                disabled={saving}
              >
                {["悬疑", "都市情感", "古装", "奇幻", "喜剧", "成长", "其他"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </Select>
            </Field>
            <Field htmlFor={`${id}-style`} label="初步风格" hint="制作前还会与你确认。">
              <Select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                disabled={saving}
              >
                {["真人短剧", "二次元动画", "动态漫画", "国风动画"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="form-info">
            <BookOpen size={16} aria-hidden="true" />
            <span>
              创建后导入本集要改编的章节或片段，团队会据此创作一集。
              无需确定总集数，也无需上传整本小说。
            </span>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>取消</DialogClose>
          <Button
            variant="primary"
            loading={saving}
            disabled={saving || !name.trim()}
            type="submit"
          >
            <Plus size={15} />
            创建项目群聊
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
