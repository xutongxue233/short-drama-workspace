import { ArrowRight, Clapperboard, RotateCcw } from "lucide-react";
import type { Action } from "../../../shared/contracts";
import { failureAdvice } from "../../../shared/workflow-failure";
import type { Agent, Project, WorkflowNode } from "../../../types";
import { Button } from "../../../ui";
import { characterReview } from "../character-review";

function CharacterProgress({
  project,
  node,
}: {
  project: Project;
  node: WorkflowNode;
}) {
  const checkpoint = node.characterGeneration;
  if (!checkpoint?.plan.length)
    return project.running ? (
      <div className="character-generation-progress" role="status">
        {project.visualStyleGuide?.trim()
          ? "正在整理本集角色名单与基础设定，计划确定后先生成一位角色样板。"
          : "正在整理角色名单与设定，计划确定后逐项保存资产。"}
      </div>
    ) : null;
  const assets = project.assets.filter(
    (asset) =>
      asset.type === "character" &&
      !asset.tags.includes("历史版本") &&
      !asset.tags.includes("待更新"),
  );
  if (checkpoint.stage === "pilot") {
    const planned = checkpoint.plan.find((item) => item.name === checkpoint.pilotName);
    const pilot = assets.find(
      (asset) =>
        planned &&
        asset.name === planned.name &&
        asset.content === planned.content &&
        !asset.locked &&
        asset.characterDesign?.version === 1 &&
        asset.url?.trim() &&
        asset.tags.includes(`generation:${checkpoint.id}`),
    );
    return (
      <div className="character-generation-progress" role="status" aria-live="polite">
        <strong>
          角色样板：{planned?.name || "待确定"} ·{" "}
          {pilot ? "已保存" : project.running ? "制作中" : "待继续制作"}
        </strong>
        <p>
          {pilot
            ? "样板图片已保存，等待整理确认卡；画风与基础造型仍需你目视验收。"
            : "当前只制作一位角色样板，完成后先请你确认画风与基础造型。"}
        </p>
        <p>
          本集已规划 {checkpoint.plan.length} 位角色
          {checkpoint.plan.length > 1
            ? `；其余 ${checkpoint.plan.length - 1} 位将在样板确认后继续制作。`
            : "；样板确认后进入角色资产最终验收。"}
        </p>
      </div>
    );
  }
  const review = characterReview(project, node);
  const saved = checkpoint.plan.map((planned) => ({
    name: planned.name,
    asset: review.assets.find((asset) => asset.name === planned.name),
  }));
  const count = saved.filter((item) => item.asset).length;
  const missing = saved.filter((item) => !item.asset).map((item) => item.name);
  const newDraft = saved.some(
    ({ asset }) =>
      asset &&
      !asset.locked &&
      Date.parse(asset.createdAt) >= Date.parse(node.startedAt ?? ""),
  );
  return (
    <div className="character-generation-progress" role="status" aria-live="polite">
      <strong>
        已保存 {count} / {checkpoint.plan.length} 项角色资产
      </strong>
      <p>
        {checkpoint.stage === "batch"
          ? project.running
            ? "样板已确认，正在继续制作其余角色；已保存的样板会直接沿用。"
            : "样板已确认，已保存的角色图片会保留，恢复后继续未完成的角色。"
          : newDraft
            ? "按本次已落盘的角色计划统计，含可沿用的锁定图片。"
            : project.running
              ? "已存角色计划，正在校验或等待首张结果。"
              : "按已存角色计划统计，恢复制作时会重新校验。"}
      </p>
      <p>
        {missing.length
          ? `计划中尚无草稿：${missing.join("、")}`
          : "已存计划中的角色资产均已保存，节点结果尚待整理或确认。"}
      </p>
    </div>
  );
}

export function WorkflowStatusCard({
  project,
  agents,
  busy,
  onAction,
}: {
  project: Project;
  agents: Agent[];
  busy: boolean;
  onAction: Action;
}) {
  const next = project.nodes.find((node) => node.status !== "completed");
  if (!next || project.approval || !project.chapters.length) return null;
  const generatingCharacters =
    project.running && next.id === "characters" && next.status === "running";
  const generatingPilot =
    generatingCharacters && next.characterGeneration?.stage === "pilot";
  const planningPilot =
    generatingCharacters &&
    !next.characterGeneration &&
    Boolean(project.visualStyleGuide?.trim());
  if (project.running && !generatingCharacters) return null;
  const completed = project.nodes.filter((node) => node.status === "completed").length;
  const hasChatDraft = project.messages.some(
    (message) =>
      message.agentId !== "user" &&
      message.agentId !== "system" &&
      message.type === "text" &&
      !message.nodeId &&
      message.content.length > 250,
  );
  const failed = next.status === "failed";
  const unstarted = project.nodes.every(
    (node) => node.status === "pending" && !node.startedAt,
  );
  const agent = agents.find((item) => item.id === next.agentId);
  return (
    <section
      className="workflow-handoff"
      aria-label={generatingCharacters ? "角色生成进度" : "下一步制作安排"}
    >
      <div className="workflow-handoff-heading">
        <Clapperboard size={17} />
        <strong>
          {generatingCharacters
            ? generatingPilot
              ? "正在制作首位角色样板"
              : planningPilot
                ? "正在整理基础角色设计"
                : "角色资产正在逐项保存"
            : failed
              ? "制作需要处理"
              : unstarted
                ? "准备进入制作流程"
                : "从当前进度继续"}
        </strong>
        <span>
          {completed} / {project.nodes.length} 个节点已完成
        </span>
      </div>
      <p>
        {generatingCharacters
          ? generatingPilot
            ? "先生成一位角色基础样板，确认画风与造型后再继续其余角色。"
            : planningPilot
              ? "先按本集内容整理角色，再生成一位基础样板供你确认；样板通过后才继续其余角色。"
              : "每个角色完成后会单独保存草稿。全部处理完成后会展示角色确认卡。"
          : failed
            ? `「${next.name}」尚未完成。处理下方原因后，可以从这个节点重试。`
            : unstarted && hasChatDraft
              ? "群聊中的提案已保留为创作参考，尚未进入正式制作节点。启动后，总制片会邀请所需成员并依次安排工作。"
              : "团队会从当前节点接着制作，在需要你决定时展示确认卡；提交确认后自动交给下一位 Agent。"}
      </p>
      {next.id === "characters" && <CharacterProgress project={project} node={next} />}
      {failed && next.error && (
        <div className="workflow-handoff-error">
          <p>{failureAdvice(next.error)}</p>
          <details>
            <summary>查看原始错误详情</summary>
            <pre>{next.error}</pre>
          </details>
        </div>
      )}
      {!generatingCharacters && (
        <div className="workflow-handoff-next">
          <span>
            下一步：
            <strong>
              {agent?.name || "Agent"} · {next.name}
            </strong>
          </span>
          <Button
            variant="primary"
            disabled={busy || Boolean(project.chatPending)}
            onClick={() => void onAction(`/projects/${project.id}/run`)}
          >
            {failed ? <RotateCcw size={14} /> : <ArrowRight size={14} />}
            {failed ? "重试当前节点" : unstarted ? "启动制作流程" : "继续制作流程"}
          </Button>
        </div>
      )}
    </section>
  );
}
