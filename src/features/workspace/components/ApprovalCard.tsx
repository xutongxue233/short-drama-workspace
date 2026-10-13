import {
  ArrowRight,
  AtSign,
  Check,
  Clock3,
  Film,
  FileText,
  Layers3,
  Maximize2,
  Sparkles,
  Users,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import type { Action } from "../../../shared/contracts";
import { projectPermissions } from "../../../shared/project-members";
import type { Agent, Approval, Project } from "../../../types";
import { Button, Field, Input, Select, Textarea } from "../../../ui";
import { AssetMedia } from "../../assets/components/AssetMedia";
import { characterImageKey, characterReview } from "../character-review";
import { CharacterImagePreview } from "./CharacterImagePreview";

interface ApprovalCardProps {
  project: Project;
  agents?: Agent[];
  busy: boolean;
  onAction: Action;
  onAssets?: () => void;
}

const numberFields: Record<string, { min: number; max: number; unit: string }> = {
  durationSeconds: { min: 15, max: 600, unit: "秒" },
};

function initialAnswers(project: Project, approval: Approval) {
  const answers = Object.fromEntries(
    (approval.fields ?? [])
      .filter((field) => field.id !== "episodeCount")
      .map((field) => [field.id, field.value ?? ""]),
  );
  const styles =
    approval.fields?.find((field) => field.id === "style")?.options ?? approval.options;
  if (styles?.length) {
    answers.style = styles.includes(project.style)
      ? project.style
      : styles.includes(answers.style)
        ? answers.style
        : styles[0];
  }
  return answers;
}

export function ApprovalCard(props: ApprovalCardProps) {
  if (!props.project.approval) return null;
  return (
    <ApprovalForm
      key={`${props.project.id}:${props.project.approval.id}`}
      {...props}
      approval={props.project.approval}
    />
  );
}

function ApprovalForm({
  project,
  agents = [],
  approval,
  busy,
  onAction,
  onAssets,
}: ApprovalCardProps & { approval: Approval }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const [answers, setAnswers] = useState(() => initialAnswers(project, approval));
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState("");
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [imageStates, setImageStates] = useState<
    Record<string, "loading" | "loaded" | "failed">
  >({});
  const { canEdit } = projectPermissions(project);
  const locked = busy || submitting || submitted || !canEdit;
  const fields = (approval.fields ?? []).filter((field) => field.id !== "episodeCount");
  const styleField = fields.find((field) => field.id === "style");
  const styles = styleField?.options ?? approval.options;
  const currentNode = project.nodes.find((node) => node.id === approval.nodeId);
  const nextAgent = agents.find((agent) => agent.id === approval.nextStep?.agentId);
  const isCharacterPilot = approval.phase === "character-pilot";
  const isCharacterFinal = approval.kind === "character" && !isCharacterPilot;
  const checkpoint = currentNode?.characterGeneration;
  const plannedPilot = checkpoint?.plan.find(
    (character) => character.name === checkpoint.pilotName,
  );
  const activeCharacters = project.assets.filter(
    (asset) =>
      asset.type === "character" &&
      !asset.tags.includes("历史版本") &&
      !asset.tags.includes("待更新"),
  );
  const pilot = activeCharacters.find(
    (asset) =>
      plannedPilot &&
      asset.name === plannedPilot.name &&
      asset.content === plannedPilot.content &&
      !asset.locked &&
      asset.characterDesign?.version === 1 &&
      asset.url?.trim() &&
      asset.tags.includes(`generation:${checkpoint?.id}`),
  );
  const review = characterReview(project, currentNode);
  const characters = isCharacterPilot ? (pilot ? [pilot] : []) : review.assets;
  const pilotImageState = pilot ? imageStates[characterImageKey(pilot)] : undefined;
  const pilotReady = Boolean(pilot && pilotImageState === "loaded");
  const missingImages = characters.filter((asset) => !asset.url?.trim());
  const failedImages = characters.filter(
    (asset) => imageStates[characterImageKey(asset)] === "failed",
  );
  const loadedImageCount = characters.filter(
    (asset) => imageStates[characterImageKey(asset)] === "loaded",
  ).length;
  const finalReviewIssue = isCharacterFinal
    ? review.missingNames.length
      ? `缺少本轮角色资产：${review.missingNames.join("、")}。请提出修改后补全。`
      : !characters.length
        ? "本轮尚无有效角色资产，请先补全角色设定。"
        : review.requiresImages && missingImages.length
          ? `以下角色缺少图片：${missingImages.map((asset) => asset.name).join("、")}。请提出修改后补全。`
          : review.requiresImages && failedImages.length
            ? `以下角色图片无法加载：${failedImages.map((asset) => asset.name).join("、")}。请检查素材或提出修改后重试。`
            : review.requiresImages && loadedImageCount < characters.length
              ? `正在加载本轮角色图片（已显示 ${loadedImageCount} / ${characters.length}）；图片全部显示后可确认。`
              : ""
    : "";
  const previewAsset = characters.find((asset) => asset.id === previewAssetId);
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const answer = answers[field.id]?.trim() ?? "";
    if (field.required && !answer) errors[field.id] = `请填写${field.label}`;
    else if (answer && field.options && !field.options.includes(answer))
      errors[field.id] = `请选择有效的${field.label}`;
    else if (answer && numberFields[field.id]) {
      const range = numberFields[field.id];
      if (!/^\d+$/.test(answer) || +answer < range.min || +answer > range.max)
        errors[field.id] = `请输入 ${range.min}–${range.max} ${range.unit}的整数`;
    }
  }
  if (styles?.length && !styles.includes(answers.style))
    errors.style = "请选择视觉风格";

  function changeAnswer(fieldId: string, value: string) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setFailure("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || pending.current) return;
    setAttempted(true);
    setFailure("");
    if (revising && !feedback.trim()) return;
    if (!revising && isCharacterPilot && !pilotReady) return;
    if (!revising && finalReviewIssue) return;
    if (!revising && Object.keys(errors).length) {
      const invalid = form.current?.elements.namedItem(
        Object.keys(errors)[0],
      ) as HTMLElement | null;
      invalid?.focus();
      return;
    }
    pending.current = true;
    setSubmitting(true);
    try {
      const ok = await onAction(
        `/projects/${project.id}/approval`,
        {
          approvalId: approval.id,
          decision: revising ? "revise" : "approve",
          ...(!revising && {
            value: answers.style ?? "",
            answers: Object.fromEntries(
              Object.entries(answers).map(([key, answer]) => [key, answer.trim()]),
            ),
          }),
          feedback: isCharacterPilot && !revising ? "" : feedback.trim(),
        },
        revising ? "修改意见已提交" : "已确认，团队继续创作",
      );
      if (ok) setSubmitted(true);
      else setFailure("提交未完成，填写内容已保留，请重试。");
    } catch {
      setFailure("提交未完成，填写内容已保留，请重试。");
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      className="approval-card"
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-labelledby={`${id}-title`}
      aria-busy={submitting || undefined}
    >
      <div className="approval-eyebrow">
        <span>
          <AtSign size={13} />
          {currentNode
            ? `审核 · ${currentNode.name}`
            : canEdit
              ? "需要你的决定"
              : "等待团队决定"}
        </span>
        <span className="approval-state">
          <Clock3 size={12} />
          {submitted ? "已提交" : submitting ? "正在提交" : "等待确认"}
        </span>
      </div>
      <h3 id={`${id}-title`}>{approval.title}</h3>
      {!canEdit && (
        <p className="form-info">等待项目所有者或编辑者确认，你可以查看当前方案。</p>
      )}
      <p>
        {isCharacterPilot
          ? "请目视检查画风与基础造型，采用后再生成其余角色。"
          : approval.description}
      </p>
      {approval.kind === "character" && (
        <div className="approval-characters">
          <details open>
            <summary>
              <Users size={15} aria-hidden="true" />
              <strong>{isCharacterPilot ? "本轮样板预览" : "角色定妆预览"}</strong>
              <span>
                {characters.length} 项 ·{" "}
                {characters.filter((asset) => asset.url?.trim()).length} 张图
              </span>
            </summary>
            {characters.length ? (
              <div
                className={`approval-character-grid${isCharacterPilot ? " is-pilot" : ""}`}
                role="list"
                aria-label="本轮角色资产"
              >
                {characters.map((asset) => (
                  <figure key={asset.id} role="listitem">
                    <div className="approval-character-media">
                      {asset.url?.trim() ? (
                        <AssetMedia
                          key={characterImageKey(asset)}
                          item={asset}
                          onLoadStateChange={
                            isCharacterPilot || review.requiresImages
                              ? (state) =>
                                  setImageStates((current) => ({
                                    ...current,
                                    [characterImageKey(asset)]: state,
                                  }))
                              : undefined
                          }
                        />
                      ) : (
                        <div className="approval-character-text">
                          <FileText size={26} aria-hidden="true" />
                          <span>仅文字设定，暂无图片</span>
                        </div>
                      )}
                    </div>
                    <figcaption>
                      <strong>{asset.name}</strong>
                      <span>
                        v{asset.version} ·{" "}
                        {asset.url?.trim() ? "定妆图" : "文字卡 · 无图片"}
                      </span>
                      <span className={asset.locked ? "is-locked" : "is-pending"}>
                        {asset.locked
                          ? "已锁定标准"
                          : canEdit
                            ? "待你确认"
                            : "待团队确认"}
                      </span>
                      {asset.characterDesign && (
                        <div className="approval-character-badges">
                          <span>基础设定</span>
                          {asset.characterDesign.sceneStates.length > 0 && (
                            <span>
                              含 {asset.characterDesign.sceneStates.length} 种待制作状态
                            </span>
                          )}
                        </div>
                      )}
                      {asset.url?.trim() && (
                        <Button
                          className="approval-character-expand"
                          variant="secondary"
                          size="sm"
                          onClick={() => setPreviewAssetId(asset.id)}
                        >
                          <Maximize2 size={13} aria-hidden="true" />
                          放大查看 {asset.name}
                        </Button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="approval-character-empty" role="status">
                {isCharacterPilot
                  ? "本轮样板尚未就绪，请先修改或补全样板后再确认。其余角色将在样板通过后生成。"
                  : "当前没有有效的角色资产，请提出修改，补全角色设定后再确认。"}
              </p>
            )}
          </details>
          <details className="approval-character-guidance" open={!isCharacterPilot}>
            <summary>验收标准与项目画风</summary>
            <div className="approval-character-review">
              <p>请逐张目视检查：五官可辨、头脚完整、服装固定、画风统一。</p>
              <p>逆光、受伤、现形等剧情状态另行制作，不作为基础身份设定。</p>
              {project.visualStyleGuide && (
                <p className="approval-character-style">
                  <span>本项目画风</span>
                  {project.visualStyleGuide}
                </p>
              )}
            </div>
          </details>
          <div className="approval-character-footer">
            <span>
              {isCharacterPilot
                ? pilot && !pilotReady
                  ? pilotImageState === "failed"
                    ? "样板图片未能加载，请检查素材或修改样板，暂不能采用。"
                    : "样板图片加载中，请待图片显示后进行目视验收。"
                  : "本次只确认样板；其余角色生成后仍需逐张验收。"
                : "图片已生成不代表验收通过，请检查后再确认。"}
            </span>
            {onAssets && (
              <Button variant="ghost" size="sm" onClick={onAssets}>
                查看项目资产
                <ArrowRight size={13} />
              </Button>
            )}
          </div>
          {finalReviewIssue &&
            (characters.length > 0 || review.missingNames.length > 0) && (
              <p className="approval-character-empty" role="status">
                {finalReviewIssue}
              </p>
            )}
        </div>
      )}
      {styles && styles.length > 0 && (
        <div className="approval-style-field">
          <div className="approval-section-label">
            <strong>{styleField?.label ?? "视觉风格"}</strong>
            {styles.includes(project.style) && <span>已沿用项目设置，可调整</span>}
          </div>
          <div className="style-options" role="group" aria-label="视觉风格选项">
            {styles.map((option, index) => (
              <button
                type="button"
                key={option}
                className={answers.style === option ? "selected" : ""}
                aria-pressed={answers.style === option}
                disabled={locked || revising}
                onClick={() => changeAnswer("style", option)}
              >
                <span className={`style-icon style-${index}`} aria-hidden="true">
                  {index === 0 ? (
                    <Film size={21} />
                  ) : index === 1 ? (
                    <Sparkles size={21} />
                  ) : (
                    <Layers3 size={21} />
                  )}
                </span>
                <strong>{option}</strong>
                <span className="radio-indicator" aria-hidden="true">
                  {answers.style === option && <Check size={11} />}
                </span>
              </button>
            ))}
          </div>
          {styleField?.help && <p className="approval-field-help">{styleField.help}</p>}
          {attempted && !revising && errors.style && (
            <p className="approval-form-error" role="alert">
              {errors.style}
            </p>
          )}
        </div>
      )}
      {fields.some((field) => field.id !== "style") && (
        <div className="approval-fields">
          {fields
            .filter((field) => field.id !== "style")
            .map((field) => (
              <Field
                key={field.id}
                htmlFor={`${id}-${field.id}`}
                label={field.label}
                optional={!field.required}
                hint={field.help}
                error={attempted && !revising ? errors[field.id] : undefined}
              >
                {field.type === "select" ? (
                  <Select
                    name={field.id}
                    value={answers[field.id] ?? ""}
                    required={field.required}
                    disabled={locked || revising}
                    onChange={(event) => changeAnswer(field.id, event.target.value)}
                  >
                    <option value="" disabled>
                      请选择{field.label}
                    </option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    name={field.id}
                    value={answers[field.id] ?? ""}
                    required={field.required}
                    disabled={locked || revising}
                    inputMode={numberFields[field.id] ? "numeric" : undefined}
                    maxLength={numberFields[field.id] ? 3 : 200}
                    onChange={(event) => changeAnswer(field.id, event.target.value)}
                  />
                )}
              </Field>
            ))}
        </div>
      )}
      {(!isCharacterPilot || revising) && (
        <Field
          className="approval-feedback"
          htmlFor={`${id}-feedback`}
          label={revising ? "修改意见" : "补充要求"}
          optional={!revising}
          hint={revising ? "写明需要修改的内容，团队会重做当前节点。" : undefined}
          error={
            attempted && revising && !feedback.trim() ? "请填写修改意见" : undefined
          }
        >
          <Textarea
            maxLength={5000}
            placeholder={
              revising
                ? isCharacterPilot
                  ? "例如：保留清晰线稿，将服装改为灰蓝色，面部细节更明确…"
                  : "例如：保留原著悬疑感，调整开场冲突…"
                : "例如：保留主角的身份悬念，结尾留一个反转…"
            }
            value={feedback}
            disabled={locked}
            onChange={(event) => setFeedback(event.target.value)}
            rows={3}
          />
        </Field>
      )}
      {!revising && approval.nextStep && (
        <div className="approval-next-step">
          <ArrowRight size={16} aria-hidden="true" />
          <p>
            <span>确认后自动继续</span>
            <strong>
              {nextAgent ? `${nextAgent.name} · ` : ""}
              {approval.nextStep.name}
            </strong>
          </p>
        </div>
      )}
      {failure && (
        <p className="approval-form-error" role="alert">
          {failure}
        </p>
      )}
      <div className="approval-bottom">
        <div>
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => {
              setRevising(!revising);
              if (isCharacterPilot && revising) setFeedback("");
              setAttempted(false);
              setFailure("");
            }}
          >
            {revising ? "取消修改" : isCharacterPilot ? "修改样板" : "提出修改"}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={
              locked ||
              (!revising &&
                ((isCharacterPilot && !pilotReady) || Boolean(finalReviewIssue)))
            }
            loading={submitting}
          >
            {revising ? <ArrowRight size={14} /> : <Check size={14} />}
            {submitted
              ? "已提交"
              : revising
                ? "提交修改"
                : isCharacterPilot
                  ? "采用样板并继续"
                  : "确认并继续"}
          </Button>
        </div>
      </div>
      {previewAsset && (
        <CharacterImagePreview
          asset={previewAsset}
          onClose={() => setPreviewAssetId(null)}
        />
      )}
    </form>
  );
}
