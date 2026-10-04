// Replies and tasks are Markdown. react-markdown builds React elements, never an HTML
// string, so raw HTML in a reply shows as text and never runs, and its default URL check
// drops javascript: links. A link opens in a new tab without a handle on this page.
import ReactMarkdown, { type Components } from "react-markdown";

const COMPONENTS: Components = {
  // `node` is the syntax-tree node; it must not reach the DOM as an attribute.
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
};

const LOOK = [
  "flex min-w-0 flex-col gap-2",
  "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_a]:underline [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_p_code]:rounded [&_p_code]:bg-line/50 [&_p_code]:px-1",
  "[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-line [&_pre]:p-2",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted",
].join(" ");

export function Markdown({ text }: { text: string }) {
  return (
    <div className={LOOK}>
      <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
