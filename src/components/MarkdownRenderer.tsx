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
import { PodPasswordWrapper } from "./ui/PodPasswordWrapper";

interface MarkdownRendererProps {
  children: string;
  className?: string;
  variant?: "user" | "assistant";
  size?: "default" | "compact";
  inlineIconPattern?: RegExp;
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

const compactStyles = {
  heading: "font-semibold scroll-m-20",
  h1: "text-xl lg:text-2xl mt-4 mb-2 border-b pb-1",
  h2: "text-lg lg:text-xl mt-3 mb-2",
  h3: "text-base lg:text-lg mt-3 mb-1.5",
  h4: "text-sm lg:text-base mt-2 mb-1",
  h5: "text-sm mt-2 mb-1",
  h6: "text-xs lg:text-sm mt-1 mb-0.5",
  paragraph: "leading-6 text-sm [&:not(:first-child)]:mt-2",
  blockquote: "border-l-4 pl-3 py-1.5 my-2 rounded-r-md italic text-sm",
  list: "my-2 ml-5 space-y-0.5 [&>li]:mt-0.5 text-sm",
  listDisc: "list-disc",
  listDecimal: "list-decimal",
  listItem: "leading-6 text-sm",
  codeInline: "relative rounded-xs px-0.75 py-0.5 text-xs font-mono",
  codeBlock: "relative rounded-lg border overflow-x-auto text-sm",
  table: "w-full border-collapse text-sm",
  tableWrapper: "my-3 w-full overflow-y-auto rounded-lg border",
  tableHeader: "border-b font-medium [&>tr]:border-b text-sm",
  tableBody: "[&>tr:last-child]:border-0 text-sm",
  tableRow: "border-b transition-colors hover:bg-muted/50",
  tableCell: "px-3 py-1.5 text-left align-middle text-sm",
  tableHeaderCell: "px-3 py-2 text-left font-semibold text-sm",
  image: "max-w-full h-auto rounded-lg border my-2 shadow-sm",
  hr: "my-4 border-t",
  link: "underline underline-offset-4 hover:opacity-80 transition-colors text-sm",
} as const;

const createComponents = (
  styles: ReturnType<typeof createStyles>,
  styleConfig: typeof baseStyles | typeof compactStyles,
  codeInlineClass: string,
  inlineIconPattern?: RegExp,
): Components => ({
  h1: ({ children, ...props }) => (
    <h1
      className={cn(
        styleConfig.heading,
        styleConfig.h1,
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
      className={cn(styleConfig.heading, styleConfig.h2, styles.text)}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className={cn(styleConfig.heading, styleConfig.h3, styles.text)}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4
      className={cn(styleConfig.heading, styleConfig.h4, styles.text)}
      {...props}
    >
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5
      className={cn(styleConfig.heading, styleConfig.h5, styles.text)}
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6
      className={cn(styleConfig.heading, styleConfig.h6, styles.muted)}
      {...props}
    >
      {children}
    </h6>
  ),

  p: ({ children, ...props }) => (
    <p className={cn(styleConfig.paragraph, styles.text)} {...props}>
      <PodPasswordWrapper>{children}</PodPasswordWrapper>
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
        styleConfig.blockquote,
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
    <ul className={cn(styleConfig.list, styleConfig.listDisc)} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className={cn(styleConfig.list, styleConfig.listDecimal)} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className={cn(styleConfig.listItem, styles.text)} {...props}>
      {children}
    </li>
  ),

  table: ({ children, ...props }) => (
    <div className={cn(styleConfig.tableWrapper, styles.border)}>
      <table className={styleConfig.table} {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className={cn(styleConfig.tableHeader, styles.bg)} {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className={styleConfig.tableBody} {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className={styleConfig.tableRow} {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className={cn(styleConfig.tableHeaderCell, styles.text, styles.border)}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className={cn(styleConfig.tableCell, styles.text, styles.border)}
      {...props}
    >
      {children}
    </td>
  ),

  a: ({ children, href, ...props }) => (
    <a
      className={cn(styleConfig.link, styles.link, "break-all")}
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  img: ({ src, alt, ...props }) => {
    // Check if this is an inline icon by matching against the pattern
    const srcString = typeof src === "string" ? src : "";
    const isInlineIcon = inlineIconPattern ? inlineIconPattern.test(srcString) : false;

    if (isInlineIcon) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="inline-block w-4 h-4 mr-1 align-text-bottom !my-0 !border-0 !rounded-none !shadow-none"
          src={src ?? ""}
          alt={alt || "Icon"}
          {...props}
        />
      );
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={cn(`${(styleConfig.image, styles.border)} rounded-md`)}
        src={src ?? ""}
        alt={alt || "Image"}
        loading="lazy"
        {...props}
      />
    );
  },
  hr: ({ ...props }) => (
    <hr className={cn(styleConfig.hr, styles.border)} {...props} />
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || "");

    if (!match) {
      return (
        <code className={cn(styleConfig.codeInline, codeInlineClass, className)}>
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
  size = "default",
  inlineIconPattern = /svg-icons/,
}: MarkdownRendererProps) {
  const isUser = variant === "user";
  const styles = createStyles(isUser);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const codeInlineClass = isDarkTheme ? "bg-zinc-600/70" : "bg-zinc-300/60";
  const styleConfig = size === "compact" ? compactStyles : baseStyles;
  const components = createComponents(styles, styleConfig, codeInlineClass, inlineIconPattern);

  const processedContent =
    typeof children === "string"
      ? children
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
      : children;

  return (
    <div className={cn("prose dark:prose-invert max-w-full overflow-wrap-anywhere", className)}>
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
