import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clapperboard,
  Layers3,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  EmptyState,
  Field,
  Form,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
} from "./index";
import "./showcase.css";

/** Local component workbench. Examples never call the production API. */
export function Showcase() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    document.title = "映序 UI · 组件预览";
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  function saveDemo() {
    setLoading(true);
    setSaved(false);
    timer.current = setTimeout(() => {
      setLoading(false);
      setSaved(true);
    }, 1200);
  }
  return (
    <main className="ui-showcase">
      <header className="showcase-topbar">
        <a href="/" className="showcase-brand">
          <span>
            <Clapperboard size={22} />
          </span>
          <strong>
            映序 <small>UI</small>
          </strong>
        </a>
        <a href="/" className="showcase-back">
          <ArrowLeft size={14} />
          返回工作台
        </a>
      </header>
      <div className="showcase-shell">
        <section className="showcase-intro">
          <Badge tone="accent">映序 Studio · 组件系统</Badge>
          <h1>
            好创作，
            <br />
            从每个细节开始。
          </h1>
          <p>
            一套服务于创作流程的轻量界面组件。让每一次点击、输入、确认，都有一致而清晰的反馈。
          </p>
          <div className="showcase-principles">
            <span>
              01 <b>清晰可读</b>
            </span>
            <span>
              02 <b>键盘可达</b>
            </span>
            <span>
              03 <b>布局稳妥</b>
            </span>
          </div>
          <aside>
            <Sparkles size={17} />
            <p>这里的交互仅用于组件预览，不会修改项目或调用模型。</p>
          </aside>
        </section>
        <div className="showcase-sections">
          <section className="showcase-card">
            <div className="showcase-card-heading">
              <span>01 / ACTIONS</span>
              <h2>操作与反馈</h2>
              <p>轻重有别，等待时保留按钮尺寸。</p>
            </div>
            <div className="showcase-row">
              <Button variant="primary">
                <Plus />
                新建项目
              </Button>
              <Button>
                <Layers3 />
                查看资产
              </Button>
              <Button variant="ghost">
                稍后处理
                <ArrowUpRight />
              </Button>
              <Button variant="danger">移除配置</Button>
            </div>
            <div className="showcase-row">
              <Button size="sm" onClick={saveDemo} loading={loading}>
                <Check />
                预览保存反馈
              </Button>
              <Button disabled>等待前置节点</Button>
              <IconButton label="设置示例">
                <Settings2 />
              </IconButton>
              <IconButton label="搜索示例">
                <Search />
              </IconButton>
            </div>
            <p className="showcase-status" role="status">
              {loading
                ? "正在保存示例…"
                : saved
                  ? "保存完成，按钮已恢复。"
                  : "点击「预览保存反馈」体验加载状态。"}
            </p>
          </section>
          <section className="showcase-card">
            <div className="showcase-card-heading">
              <span>02 / INPUTS</span>
              <h2>每个输入都有回应</h2>
              <p>标签、提示、校验和焦点保持同一套规则。</p>
            </div>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
              }}
            >
              <div className="showcase-grid">
                <Field
                  htmlFor="example-project"
                  label="项目名称"
                  hint="给这个故事起一个容易记住的名字。"
                >
                  <Input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：长夜有回声"
                  />
                </Field>
                <Field
                  htmlFor="example-password"
                  label="密码校验示例"
                  hint="至少 12 个字符，仅用于预览。"
                >
                  <Input
                    type="password"
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field
                  htmlFor="example-style"
                  label="制作风格"
                  hint="可在正式制作前再次调整。"
                >
                  <Select defaultValue="真人短剧">
                    <option>真人短剧</option>
                    <option>二次元动画</option>
                    <option>动态漫画</option>
                  </Select>
                </Field>
                <Field
                  htmlFor="example-disabled"
                  label="等待分配的模型"
                  hint="配置模型服务后可用。"
                >
                  <Select disabled defaultValue="">
                    <option value="">暂未配置</option>
                  </Select>
                </Field>
                <Field
                  htmlFor="example-readonly"
                  label="项目编号"
                  hint="此字段可以选择和复制。"
                >
                  <Input readOnly value="STUDIO-2026-001" />
                </Field>
                <Field
                  htmlFor="example-model-search"
                  label="可搜索的模型列表"
                  hint="统一菜单支持搜索、键盘导航和分组，示例不会请求模型。"
                >
                  <Select
                    searchable
                    searchPlaceholder="搜索模型名称或 ID"
                    defaultValue="image-01"
                  >
                    <optgroup label="图片生成">
                      <option value="gpt-image-2.5">gpt-image-2.5</option>
                      <option value="image-01">image-01</option>
                    </optgroup>
                    <optgroup label="视频生成">
                      <option value="MiniMax-Hailuo-2.3">MiniMax-Hailuo-2.3</option>
                      <option value="doubao-seedance-2-0-260128">
                        doubao-seedance-2-0-260128
                      </option>
                      <option disabled value="unavailable">
                        暂未开通的模型
                      </option>
                    </optgroup>
                  </Select>
                </Field>
              </div>
              <Field
                htmlFor="example-description"
                label="创作方向"
                optional
                hint="输入内容只保留在当前预览页。"
              >
                <Textarea placeholder="记录故事的基调、人物关系或改编想法…" rows={3} />
              </Field>
              <div className="showcase-form-footer">
                <Button type="submit">检查表单</Button>
                <span role="status">
                  {submitted && name.trim()
                    ? "校验通过，示例内容不会提交。"
                    : "支持 Tab 导航与键盘操作"}
                </span>
              </div>
            </Form>
          </section>
          <section className="showcase-card">
            <div className="showcase-card-heading">
              <span>03 / STATES</span>
              <h2>让状态一目了然</h2>
              <p>颜色与文字共同传递进度。</p>
            </div>
            <div className="showcase-row">
              <Badge>待开始</Badge>
              <Badge tone="accent">制作中</Badge>
              <Badge tone="success">已完成</Badge>
              <Badge tone="warning">待你确认</Badge>
              <Badge tone="danger">需处理</Badge>
            </div>
            <div className="showcase-feedback-stack">
              <Alert tone="success">配置已保存，下次制作时生效。</Alert>
              <Alert tone="warning" title="模型尚未配置">
                请先配置文字模型，再开始制作。
              </Alert>
              <Alert
                tone="danger"
                title="保存未完成"
                action={<Button size="sm">重试示例</Button>}
              >
                连接暂时中断，填写内容已保留。
              </Alert>
            </div>
            <div className="showcase-switch-row">
              <div>
                <strong>启用一致性检查</strong>
                <p>{enabled ? "角色与剧情检查已启用" : "角色与剧情检查已停用"}</p>
              </div>
              <Switch
                label="启用一致性检查"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="showcase-switch-row">
              <div>
                <strong>自动开始制作</strong>
                <p>需要先确认创作风格</p>
              </div>
              <Switch
                label="自动开始制作"
                checked={false}
                onCheckedChange={() => {}}
                disabled
              />
            </div>
          </section>
          <section className="showcase-card showcase-dialog-example">
            <div className="showcase-card-heading">
              <span>04 / DIALOGS</span>
              <h2>留住尚未完成的想法</h2>
              <p>焦点停留在弹窗内；修改后关闭，会先询问是否放弃。</p>
            </div>
            <Button
              onClick={() => {
                setDraft("");
                setDialog(true);
              }}
            >
              预览编辑弹窗
              <ArrowUpRight />
            </Button>
          </section>
          <section className="showcase-card showcase-empty-example">
            <EmptyState
              icon={<Layers3 size={28} />}
              title="资产会随着故事一起生长"
              description="空状态说明当前处境，并提供一个明确的下一步。"
              action={
                <Button
                  onClick={() => {
                    setDraft("");
                    setDialog(true);
                  }}
                >
                  添加第一份设定
                </Button>
              }
            />
          </section>
          <footer className="showcase-footnote">
            映序 UI · 使用原生 React 与 CSS 构建
          </footer>
        </div>
      </div>
      {dialog && (
        <Dialog
          title="记录一个创作想法"
          description="试着输入一些文字，然后按 Esc 或点击取消，体验未保存提醒。"
          onClose={() => setDialog(false)}
          dirty={Boolean(draft)}
        >
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              setDialog(false);
            }}
          >
            <DialogBody>
              <Field
                htmlFor="example-draft"
                label="你的想法"
                hint="此示例不会保存到项目。"
              >
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  placeholder="也许故事可以从一封没有署名的信开始…"
                />
              </Field>
              <Field
                htmlFor="example-dialog-select"
                label="制作风格"
                hint="菜单在弹窗内也可完整展开，Esc 先关闭菜单。"
              >
                <Select defaultValue="二维赛璐璐">
                  <option>二维赛璐璐</option>
                  <option>真人短剧</option>
                  <option>动态漫画</option>
                </Select>
              </Field>
              <p className="showcase-dialog-hint">
                弹窗关闭后，焦点会回到打开它的位置。
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose>取消</DialogClose>
              <DialogClose onConfirmClose={() => setDialog(false)}>
                确认后返回预览
              </DialogClose>
              <Button variant="primary" type="submit">
                完成预览
              </Button>
            </DialogFooter>
          </Form>
        </Dialog>
      )}
    </main>
  );
}
