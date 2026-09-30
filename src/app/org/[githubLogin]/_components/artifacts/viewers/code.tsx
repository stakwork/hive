"use client";

import React, { useMemo, useState } from "react";
import { WrapText } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/hooks/use-theme";
import { getLanguageFromFile } from "@/lib/syntax-utils";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { InlineClamp, PanelToolbar, ScrollFade, ToolbarButton } from "../chrome";
import { lineCount, plural } from "../lines";

/** How much of a file a card shows before it fades out. */
const INLINE_LINES = 12;
/** Past this a file is shown as plain text: colouring it would hold the panel up. */
const HIGHLIGHT_MAX_CHARS = 200_000;

const MONO_FONT = "var(--font-geist-mono), ui-monospace, monospace";

export function codeLanguage({ language, filename }: ArtifactContents["code"]): string {
  return language ?? getLanguageFromFile(filename ?? "");
}

interface CodeBlockProps {
  code: string;
  language: string;
  lineNumbers?: boolean;
  wrap?: boolean;
}

/** Memoised on plain values: the highlighter reads the whole file again every time it renders. */
const Highlighted = React.memo(function Highlighted({
  code,
  language,
  lineNumbers = false,
  wrap = false,
  dark,
}: CodeBlockProps & { dark: boolean }) {
  return (
    // The highlighter styles a line number as a comment, italics included; a gutter reads better upright.
    <div className="[&_.linenumber]:!not-italic">
      <SyntaxHighlighter
        language={code.length > HIGHLIGHT_MAX_CHARS ? "text" : language}
        style={dark ? oneDark : oneLight}
        showLineNumbers={lineNumbers}
        wrapLongLines={wrap}
        // No scrolling of its own: the card clips it and the panel scrolls it.
        customStyle={{
          margin: 0,
          padding: 0,
          overflow: "visible",
          background: "transparent",
          fontSize: 12,
          lineHeight: 1.6,
        }}
        codeTagProps={{ style: { fontFamily: MONO_FONT, background: "transparent" } }}
        lineNumberStyle={{ minWidth: "3em", paddingRight: "1.25em", opacity: 0.45, userSelect: "none" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});

/** Highlighted code on the surface it sits on — the theme colours the tokens, not the background. */
function CodeBlock(props: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  return <Highlighted {...props} dark={resolvedTheme === "dark"} />;
}

export function CodeInline({ content }: ArtifactViewerProps<"code">) {
  const head = useMemo(() => content.code.split("\n", INLINE_LINES).join("\n"), [content.code]);
  return (
    <InlineClamp className="overflow-hidden px-3 py-2.5">
      <CodeBlock code={head} language={codeLanguage(content)} />
    </InlineClamp>
  );
}

export function CodePanel({ content }: ArtifactViewerProps<"code">) {
  const [wrap, setWrap] = useState(false);
  const language = codeLanguage(content);
  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <span className="min-w-0 truncate pl-1 font-mono text-[11px]">{content.filename ?? language}</span>
        <span className="shrink-0 pl-1.5 text-muted-foreground">{plural(lineCount(content.code), "line")}</span>
        <div className="ml-auto">
          <ToolbarButton label="Wrap lines" onClick={() => setWrap((w) => !w)} pressed={wrap}>
            <WrapText className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </PanelToolbar>
      <div className="min-h-0 flex-1">
        <ScrollFade className={wrap ? "p-4" : "w-max min-w-full p-4"}>
          <CodeBlock code={content.code} language={language} lineNumbers wrap={wrap} />
        </ScrollFade>
      </div>
    </div>
  );
}
