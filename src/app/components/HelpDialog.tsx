import { ArrowRight } from "lucide-react";
import { Button, Dialog, DialogBody, DialogFooter } from "../../ui";

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="从小说，到你的第一部短剧"
      description="映序 · 本地创作工作台 0.1"
      onClose={() => onClose()}
    >
      <DialogBody>
        <div className="help-steps">
          {[
            [
              "导入本集原文",
              "新建项目，添加本集要改编的章节或片段。无需确定总集数，也无需上传整本小说。",
            ],
            [
              "和团队一起创作",
              "点击「开始制作」，主控会按节点邀请编剧、审核、角色与分镜等 Agent。",
            ],
            [
              "在关键处做决定",
              "风格、剧本、角色和分镜会请求确认。你可以批准，也可以写下意见要求修改。",
            ],
            [
              "沉淀资产与记忆",
              "锁定角色设定、记录剧情事实，压缩阶段摘要。项目间的上下文相互独立。",
            ],
            [
              "接入你的模型",
              "在模型接入中配置文字、图片和视频接口，再给 Agent 绑定模型。配置完成后即可开始制作。",
            ],
            [
              "复用创作技能",
              "在技能库维护创作方法，导入或导出 SKILL.md。聊天中选择技能或输入 $技能名，也可以在 Agent 配置中绑定技能，自动用于文字任务。",
            ],
          ].map(([title, content], i) => (
            <div key={title}>
              <span>{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{content}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={() => onClose()}>
          开始创作
          <ArrowRight size={15} />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
