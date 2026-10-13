import { Check, LockKeyhole, Pause } from "lucide-react";
import { useState } from "react";
import { TextContent } from "../../../components/TextContent";
import { assetNames } from "../../../shared/labels";
import type { Asset } from "../../../types";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  Field,
  Input,
  Textarea,
} from "../../../ui";
import { AssetMedia } from "./AssetMedia";

export function AssetDialog({
  item,
  onClose,
  onSave,
  readOnly = false,
}: {
  item: Asset;
  onClose: () => void;
  onSave: (changes: unknown) => Promise<void>;
  readOnly?: boolean;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [content, setContent] = useState(item.content);
  const [preview, setPreview] = useState(false);
  const [locked, setLocked] = useState(item.locked);
  const [saving, setSaving] = useState(false);
  const dirty =
    name.trim() !== item.name ||
    description.trim() !== item.description ||
    content.trim() !== item.content;
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <Dialog
      title="资产档案"
      description={`${assetNames[item.type]} · v${item.version} · ${item.tags.includes("历史版本") ? "历史版本，仅供追溯" : item.locked ? "已锁定设定" : "待确认"}`}
      onClose={close}
      busy={saving}
      dirty={dirty || locked !== item.locked}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || readOnly) return;
          const changes: Record<string, string | boolean> = {};
          if (name.trim() !== item.name) changes.name = name.trim();
          if (description.trim() !== item.description)
            changes.description = description.trim();
          if (content.trim() !== item.content) changes.content = content.trim();
          if (locked !== item.locked) changes.locked = locked;
          setSaving(true);
          try {
            await onSave(changes);
          } catch {
            /* Preserve asset edits after a save failure. */
          } finally {
            setSaving(false);
          }
        }}
      >
        <DialogBody className="studio-form-body">
          <AssetMedia item={item} />
          {readOnly && (
            <p className="form-info">
              <Pause size={15} />
              {item.tags.includes("历史版本")
                ? "这是历史版本，保留用于追溯。请在资产库中打开最新版本进行修改。"
                : "项目正在制作，暂停后可修改资产设定。"}
            </p>
          )}
          <Field htmlFor="studio-field-8" label="资产名称">
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={saving}
              readOnly={readOnly || locked}
            />
          </Field>
          <Field htmlFor="studio-field-9" label="核心设定">
            <Textarea
              rows={3}
              maxLength={4000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              readOnly={readOnly || locked}
            />
          </Field>
          <div className="section-heading">
            <h3>正文 / 生成提示词</h3>
            {!locked && !readOnly && (
              <button
                type="button"
                className="text-button"
                onClick={() => setPreview(!preview)}
              >
                {preview ? "继续编辑" : "预览排版"}
              </button>
            )}
          </div>
          {locked || readOnly || preview ? (
            <div className="asset-content">
              <TextContent text={content} />
            </div>
          ) : (
            <Field
              htmlFor="studio-field-10"
              label="正文 / 生成提示词"
              hint={
                <>
                  {content.length.toLocaleString()} / 150,000 字 ·
                  修改会保存为资产的新版本
                </>
              }
            >
              <Textarea
                aria-label="正文 / 生成提示词"
                rows={10}
                maxLength={150000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                disabled={saving}
              />
            </Field>
          )}
          <label className="lock-option">
            <input
              type="checkbox"
              checked={locked}
              disabled={saving || readOnly || (item.locked && !locked && dirty)}
              onChange={(e) => setLocked(e.target.checked)}
            />
            <LockKeyhole size={16} />
            <span>
              <strong>锁定资产设定</strong>
              <small>
                {item.locked && !locked && dirty
                  ? "先保存修改，再重新锁定新版本的设定。"
                  : "后续 Agent 将沿用已确认设定；修改前需先解锁。"}
              </small>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>关闭</DialogClose>
          {!readOnly && (
            <Button
              variant="primary"
              loading={saving}
              disabled={
                saving || readOnly || !name.trim() || (!dirty && locked === item.locked)
              }
              type="submit"
            >
              <Check size={14} />
              保存资产
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
