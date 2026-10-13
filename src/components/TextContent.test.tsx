import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextContent } from "./TextContent";

const agents = [{ id: "producer", name: "总制片" }];

describe("formatted model output", () => {
  it("renders headings, paragraphs, nested lists, quotes and GFM tables", () => {
    const view = render(
      <TextContent
        text={`# 第一集：借骨

**开场冲突**与*人物动机*。

1. 推进主线
   - 保留原文事实
2. 留下悬念

> 未确认设定需要复核。

---

| 镜头 | 内容 | 时长 |
| :--- | :--- | ---: |
| 01 | 夜归者敲门 | 5 秒 |

- [x] 剧情梗概
- [ ] 角色设计

~~旧方案~~`}
      />,
    );
    expect(screen.getByRole("heading", { name: "第一集：借骨" }).tagName).toBe("H1");
    expect(view.container.querySelector("strong")?.textContent).toBe("开场冲突");
    expect(view.container.querySelector("ol ul li")?.textContent).toBe("保留原文事实");
    expect(view.container.querySelector("blockquote")?.textContent).toContain(
      "未确认设定",
    );
    expect(view.container.querySelector("hr")).not.toBeNull();
    const region = screen.getByRole("region", { name: "表格内容，可横向滚动" });
    expect(region.tabIndex).toBe(0);
    expect(within(region).getByRole("table")).not.toBeNull();
    expect(within(region).getByRole("cell", { name: "夜归者敲门" })).not.toBeNull();
    expect(
      screen.getAllByRole("checkbox").every((input) => input.hasAttribute("disabled")),
    ).toBe(true);
    expect(view.container.querySelector("del")?.textContent).toBe("旧方案");
  });

  it("highlights known mentions in formatted content while preserving code and emails", () => {
    const view = render(
      <TextContent
        mentions={agents}
        text={`## 请 @总制片 确认

**＠总制片**，先推进剧情。hello@example.com @不存在

| 负责人 | 内容 |
| --- | --- |
| @总制片 | 确认风格 |

\`@总制片\`

\`\`\`text
@总制片 **原样代码**
\`\`\``}
      />,
    );
    expect(
      [...view.container.querySelectorAll(".message-mention")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["@总制片", "＠总制片", "@总制片"]);
    expect(view.container.querySelector("code .message-mention")).toBeNull();
    expect(view.container.querySelector("pre code")?.textContent).toBe(
      "@总制片 **原样代码**\n",
    );
    expect(view.container.textContent).toContain("hello@example.com @不存在");
  });

  it("does not execute raw HTML or allow unsafe and application-local links", () => {
    const view = render(
      <TextContent
        text={`<script>alert('bad')</script>

<img src=x onerror=alert(1)>

<iframe src="https://untrusted.example/"></iframe>

[执行](javascript:alert%281%29) [数据](data:text/html,test) [文件](file:///private) [应用](../settings) [协议相对](//untrusted.example/)

[编码执行](javascript&#58;alert%281%29)`}
      />,
    );
    expect(view.container.querySelector("script, img, iframe")).toBeNull();
    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toContain("执行 数据 文件 应用 协议相对");
  });

  it("keeps safe references clickable with isolated external navigation", () => {
    render(
      <TextContent text="[参考](https://example.com/story) [邮箱](mailto:team@example.com) https://example.com/reference" />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(
      links.every((link) => link.getAttribute("rel") === "noopener noreferrer"),
    ).toBe(true);
    expect(links.every((link) => link.getAttribute("target") === "_blank")).toBe(true);
    expect(screen.getByRole("link", { name: "参考" }).getAttribute("href")).toBe(
      "https://example.com/story",
    );
  });

  it("uses image placeholders and keeps linked images valid without remote requests", () => {
    const view = render(
      <TextContent text="![角色参考](https://example.com/portrait.png) ![无效图片](data:image/svg+xml,test) [![参考图](https://example.com/image.png)](https://example.com/reference)" />,
    );
    expect(view.container.querySelector("img")).toBeNull();
    expect(screen.getByText("图片：角色参考").getAttribute("title")).toBe(
      "https://example.com/portrait.png",
    );
    expect(screen.queryByRole("link", { name: "图片：无效图片" })).toBeNull();
    expect(screen.getByText("图片：无效图片")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "图片：参考图" }).getAttribute("href"),
    ).toBe("https://example.com/reference");
    expect(view.container.querySelector("a a")).toBeNull();
  });
});
