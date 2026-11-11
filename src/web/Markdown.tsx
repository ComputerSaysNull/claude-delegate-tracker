// Replies, tasks and thinking are Markdown, with GitHub's tables, strikethrough and task
// lists. react-markdown builds React elements, never an HTML string, so raw HTML in a reply
// shows as text and never runs, and its default URL check drops javascript: links. A link
// opens in a new tab without a handle on this page. An image is shown as a link and never
// loaded, so the page fetches no address the model wrote.
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const PLUGINS = [remarkGfm];

const COMPONENTS: Components = {
  // `node` is the syntax-tree node; it must not reach the DOM as an attribute.
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
  img: ({ node, src, alt }) => {
    void node;
    const text = alt ? `Image: ${alt}` : "Image";
    if (typeof src !== "string" || src === "") return <span>{text}</span>;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  },
  // A wide table scrolls inside its own box, so the bubble around it never does.
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="max-w-full overflow-x-auto">
        <table {...props} />
      </div>
    );
  },
};

const LOOK = [
  "flex min-w-0 flex-col gap-2 text-sm",
  "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_a]:underline [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_p_code]:rounded [&_p_code]:bg-line/50 [&_p_code]:px-1",
  "[&_pre]:whitespace-pre-wrap [&_pre]:rounded [&_pre]:border [&_pre]:border-line [&_pre]:p-2",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted",
  "[&_table]:border-collapse [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_td_code]:rounded [&_td_code]:bg-line/50 [&_td_code]:px-1",
  // The page lets long strings break anywhere, which lets a table squeeze a column down to a
  // letter a line; in a table, words stay whole and the box scrolls when they do not fit.
  "[&_th]:[overflow-wrap:normal] [&_td]:[overflow-wrap:normal]",
].join(" ");

export function Markdown({ text }: { text: string }) {
  return (
    <div data-markdown className={LOOK}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// A blank line ends a block unless the next line carries on what came before: an indented
// line, or a list item. Inside a code fence nothing splits.
const CARRIES_ON = /^(\s|[-*+] |\d{1,9}[.)] )/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Splits Markdown at blank lines into blocks that each render as they would inside the whole.
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let afterBlank = false;
  const flush = () => {
    while (current.length > 0 && current[current.length - 1].trim() === "") current.pop();
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (fence !== null) {
      current.push(line);
      const close = FENCE.exec(line);
      if (close !== null && line.trim() === close[1] && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (line.trim() === "") {
      if (current.length > 0) {
        current.push(line);
        afterBlank = true;
      }
      continue;
    }
    if (afterBlank && !CARRIES_ON.test(line)) flush();
    afterBlank = false;
    current.push(line);
    const open = FENCE.exec(line);
    if (open !== null) fence = open[1];
  }
  flush();
  return blocks;
}

const Block = memo(Markdown);

// Thinking can run to hundreds of kilobytes, too long to parse whole again on each new piece.
// Each block is parsed once and kept, so a new piece parses only the block it lands in.
export function MarkdownBlocks({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {splitBlocks(text).map((block, i) => (
        <Block key={i} text={block} />
      ))}
    </div>
  );
}
