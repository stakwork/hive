import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import rehypeFormat from "rehype-format";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

interface MarkdownRendererProps {
  children: string;
  className?: string;
  variant?: "user" | "assistant";
}

const createStyles = (isUser: boolean) => ({
  text: isUser ? "text-primary-foreground" : "text-foreground",
  muted: isUser ? "text-primary-foreground/70" : "text-muted-foreground",
  border: isUser ? "border-primary-foreground/20" : "border-border",
  bg: isUser ? "bg-primary-foreground/10" : "bg-muted/50",
  link: isUser ? "text-primary-foreground" : "text-primary",
  borderAccent: isUser ? "border-primary-foreground/30" : "border-primary",
});

const baseStyles = {
  heading: "font-semibold scroll-m-20",
  h1: "text-3xl lg:text-4xl mt-8 mb-4 border-b pb-2",
  h2: "text-2xl lg:text-3xl mt-6 mb-3",
  h3: "text-xl lg:text-2xl mt-5 mb-2",
  h4: "text-lg lg:text-xl mt-4 mb-2",
  h5: "text-base lg:text-lg mt-3 mb-1",
  h6: "text-sm lg:text-base mt-2 mb-1",
  paragraph: "leading-7 [&:not(:first-child)]:mt-4",
  blockquote: "border-l-4 pl-4 py-2 my-4 rounded-r-md italic",
  list: "my-4 ml-6 space-y-1 [&>li]:mt-1",
  listDisc: "list-disc",
  listDecimal: "list-decimal",
  listItem: "leading-7",
  codeInline: "relative rounded-xs px-0.75 py-0.5 text-sm font-mono",
  codeBlock: "relative rounded-lg border overflow-x-auto",
  table: "w-full border-collapse",
  tableWrapper: "my-6 w-full overflow-y-auto rounded-lg border",
  tableHeader: "border-b font-medium [&>tr]:border-b",
  tableBody: "[&>tr:last-child]:border-0",
  tableRow: "border-b transition-colors hover:bg-muted/50",
  tableCell: "px-4 py-2 text-left align-middle",
  tableHeaderCell: "px-4 py-3 text-left font-semibold",
  image: "max-w-full h-auto rounded-lg border my-4 shadow-sm",
  hr: "my-8 border-t",
  link: "underline underline-offset-4 hover:opacity-80 transition-colors",
} as const;

const createComponents = (
  styles: ReturnType<typeof createStyles>,
  codeInlineClass: string,
): Components => ({
  h1: ({ children, ...props }) => (
    <h1
      className={cn(
        baseStyles.heading,
        baseStyles.h1,
        styles.text,
        styles.border,
      )}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className={cn(baseStyles.heading, baseStyles.h2, styles.text)}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className={cn(baseStyles.heading, baseStyles.h3, styles.text)}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4
      className={cn(baseStyles.heading, baseStyles.h4, styles.text)}
      {...props}
    >
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5
      className={cn(baseStyles.heading, baseStyles.h5, styles.text)}
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6
      className={cn(baseStyles.heading, baseStyles.h6, styles.muted)}
      {...props}
    >
      {children}
    </h6>
  ),

  p: ({ children, ...props }) => (
    <p className={cn(baseStyles.paragraph, styles.text)} {...props}>
      {children}
    </p>
  ),
  em: ({ children, ...props }) => (
    <em className={cn("italic", styles.text)} {...props}>
      {children}
    </em>
  ),
  strong: ({ children, ...props }) => (
    <strong className={cn("font-semibold", styles.text)} {...props}>
      {children}
    </strong>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className={cn(
        baseStyles.blockquote,
        styles.borderAccent,
        styles.bg,
        styles.muted,
      )}
      {...props}
    >
      {children}
    </blockquote>
  ),

  ul: ({ children, ...props }) => (
    <ul className={cn(baseStyles.list, baseStyles.listDisc)} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className={cn(baseStyles.list, baseStyles.listDecimal)} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className={cn(baseStyles.listItem, styles.text)} {...props}>
      {children}
    </li>
  ),

  table: ({ children, ...props }) => (
    <div className={cn(baseStyles.tableWrapper, styles.border)}>
      <table className={baseStyles.table} {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className={cn(baseStyles.tableHeader, styles.bg)} {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className={baseStyles.tableBody} {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className={baseStyles.tableRow} {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className={cn(baseStyles.tableHeaderCell, styles.text, styles.border)}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className={cn(baseStyles.tableCell, styles.text, styles.border)}
      {...props}
    >
      {children}
    </td>
  ),

  a: ({ children, href, ...props }) => (
    <a
      className={cn(baseStyles.link, styles.link)}
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  img: ({ src, alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cn(`${(baseStyles.image, styles.border)} rounded-md`)}
      src={src ?? ""}
      alt={alt || "Image"}
      loading="lazy"
      {...props}
    />
  ),
  hr: ({ ...props }) => (
    <hr className={cn(baseStyles.hr, styles.border)} {...props} />
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || "");

    if (!match) {
      return (
        <code className={cn(baseStyles.codeInline, codeInlineClass, className)}>
          {children}
        </code>
      );
    }

    return (
      <SyntaxHighlighter
        PreTag="pre"
        wrapLines={true}
        language={match[1]}
        style={tomorrow}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    );
  },
});

export function MarkdownRenderer({
  children,
  className,
  variant = "assistant",
}: MarkdownRendererProps) {
  const isUser = variant === "user";
  const styles = createStyles(isUser);
  const { theme } = useTheme();
  const isDarkTheme = theme === "dark";
  const codeInlineClass = isDarkTheme ? "bg-zinc-600/70" : "bg-zinc-300/60";
  const components = createComponents(styles, codeInlineClass);

  const processedContent =
    typeof children === "string"
      ? children
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
      : children;

  return (
    <div className={cn("prose dark:prose-invert max-w-full", className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkFrontmatter,
          remarkDirective,
          remarkMath,
          remarkBreaks,
        ]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeFormat]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
