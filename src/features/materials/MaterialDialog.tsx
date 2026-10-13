import { useState } from "react";
import { Dialog, DialogBody, DialogFooter, Button } from "../../ui";
import { MaterialMedia } from "./MaterialMedia";
import { MaterialActions } from "./MaterialActions";
import { MaterialStatus } from "./MaterialCard";
import {
  formatMaterialBytes,
  formatMaterialTime,
  materialSourceHost,
  materialTypeNames,
  type MaterialEntry,
} from "./materialUtils";

export function MaterialDialog({
  entry,
  busy,
  saving,
  onClose,
  onSave,
}: {
  entry: MaterialEntry;
  busy: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const { material } = entry;
  const [videoMetadata, setVideoMetadata] = useState<{
    materialId: string;
    duration: number;
    width: number;
    height: number;
  }>();
  return (
    <Dialog
      title={material.name}
      description={`${materialTypeNames[material.type]}素材 · ${entry.projectName}`}
      wide
      onClose={onClose}
      className="material-dialog"
    >
      <DialogBody>
        <div className="material-preview">
          <MaterialMedia
            key={`${material.id}-${material.status}`}
            material={material}
            onVideoMetadata={(metadata) =>
              setVideoMetadata({ materialId: material.id, ...metadata })
            }
          />
        </div>
        <div className="material-preview-status">
          <MaterialStatus status={material.status} />
          <span>
            {material.status === "local"
              ? "文件已保存在工作台，可直接下载。"
              : "当前预览使用远程地址，保存到本地后可避免链接失效。"}
          </span>
        </div>
        {material.error &&
          (material.status === "failed" || material.status === "local") && (
            <p className="error-box" role="status">
              {material.error}
            </p>
          )}
        <dl className="material-details">
          <div>
            <dt>生成模型</dt>
            <dd>{material.model || "未记录"}</dd>
          </div>
          <div>
            <dt>工作节点</dt>
            <dd>{entry.nodeName || "历史导入 / 手动测试"}</dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>{formatMaterialTime(material.createdAt)}</dd>
          </div>
          <div>
            <dt>文件大小</dt>
            <dd>{formatMaterialBytes(material.bytes)}</dd>
          </div>
          <div>
            <dt>保存时间</dt>
            <dd>
              {material.savedAt ? formatMaterialTime(material.savedAt) : "尚未保存"}
            </dd>
          </div>
          <div>
            <dt>素材来源</dt>
            <dd>{materialSourceHost(material)}</dd>
          </div>
          {material.videoShot && (
            <div>
              <dt>对应分镜</dt>
              <dd>
                镜头 {material.videoShot.id} · 请求 {material.videoShot.durationSeconds}{" "}
                秒
                <small className="material-detail-note">
                  分镜 v{material.videoShot.storyboardVersion} ·{" "}
                  {material.videoShot.startSeconds}–{material.videoShot.endSeconds}{" "}
                  秒；请求时长不代表实测时长
                </small>
              </dd>
            </div>
          )}
          {material.providerTaskId && (
            <div>
              <dt>模型任务编号</dt>
              <dd className="material-task-id">{material.providerTaskId}</dd>
            </div>
          )}
          {videoMetadata?.materialId === material.id && (
            <div>
              <dt>实际视频规格</dt>
              <dd>
                {videoMetadata.width} × {videoMetadata.height} ·{" "}
                {videoMetadata.duration.toFixed(3)} 秒
                <small className="material-detail-note">
                  读取当前文件；交付时仍需按分镜裁切与校时。
                </small>
              </dd>
            </div>
          )}
        </dl>
        {material.referenceAssets !== undefined && (
          <section className="material-reference-section" aria-label="生成参考依据">
            <h3>生成参考依据</h3>
            {material.referenceAssets.length ? (
              <ul className="material-reference-list">
                {material.referenceAssets.map((reference, index) => (
                  <li key={`${reference.id}-${index}`}>
                    <span className="material-reference-index">参考 {index + 1}</span>
                    <div>
                      <strong>{reference.name}</strong>
                      <span className="material-reference-version">
                        v{reference.version}
                      </span>
                      <small>{reference.id}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>本次生成未附加角色或场景参考图。</p>
            )}
            <p>记录本次提交的参考版本，生成结果仍需目视核对。</p>
          </section>
        )}
        {material.prompt && (
          <details className="material-prompt">
            <summary>查看生成提示词</summary>
            <p>{material.prompt}</p>
          </details>
        )}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>关闭预览</Button>
        <MaterialActions
          material={material}
          busy={busy}
          saving={saving}
          onSave={onSave}
        />
      </DialogFooter>
    </Dialog>
  );
}
