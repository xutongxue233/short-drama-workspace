import type { Element, Root, Text } from "hast";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitMentions, type MentionAgent } from "../shared/mentions";
import "./text-content.css";

/** Work on parsed text, so mentions never alter Markdown syntax or code samples. */
function rehypeMentions(agents: MentionAgent[]) {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      for (let index = 0; index < parent.children.length; index += 1) {
        const child = parent.children[index];
        if (child.type === "element") {
          if (child.tagName !== "code" && child.tagName !== "pre") visit(child);
          continue;
        }
        if (child.type !== "text") continue;
        const parts = splitMentions(child.value, agents);
        if (!parts.some((part) => part.agentId || part.userId)) continue;
        const nodes: (Element | Text)[] = parts.map((part) =>
          part.agentId || part.userId
            ? {
                type: "element",
                tagName: "span",
                properties: { className: ["message-mention"] },
                children: [{ type: "text", value: part.text }],
              }
            : { type: "text", value: part.text },
        );
        parent.children.splice(index, 1, ...nodes);
        index += nodes.length - 1;
      }
    };
    visit(tree);
  };
}

// Generated content may offer a reference, but it must not navigate to local
// application routes or execute an arbitrary URL scheme.
function safeUrl(value: string) {
  if (/\s/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return value;
  } catch {
    // Relative and malformed destinations remain readable, non-clickable text.
  }
  return undefined;
}

const components: Components = {
  a({ href, title, children }) {
    if (!href) return <span>{children}</span>;
    return (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const label = alt ? `图片：${alt}` : "图片链接";
    // Chat output cannot silently load a third-party image or tracking pixel.
    // A text placeholder also remains valid inside Markdown's linked images.
    return (
      <span
        className="rich-text-image-label"
        title={typeof src === "string" ? src : undefined}
      >
        {label}
      </span>
    );
  },
  table({ children }) {
    return (
      <div
        className="rich-text-table-scroll"
        role="region"
        aria-label="表格内容，可横向滚动"
        tabIndex={0}
      >
        <table>{children}</table>
      </div>
    );
  },
};

export function TextContent({
  text,
  mentions = [],
}: {
  text: string;
  mentions?: MentionAgent[];
}) {
  return (
    <div className="rich-text markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={mentions.length ? [[rehypeMentions, mentions]] : []}
        components={components}
        skipHtml
        urlTransform={safeUrl}
      >
        {text}
      </Markdown>
    </div>
  );
}
