"use client";

import { Button } from "@/components/ui/button";
import { useRef, useEffect, useState } from "react";
import { Code, Copy, Check, FileText, GitBranch } from "lucide-react";
import { Artifact, CodeContent } from "@/lib/chat";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-json";
import "./prism-dark-plus.css";

function SyntaxHighlighter({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, language]);

  return (
    <pre className="text-xs bg-background/50 p-4 rounded border">
      <code ref={codeRef} className={`language-${language}`}>
        {code}
      </code>
    </pre>
  );
}

// Get language from file extension
const getLanguageFromFile = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mapping: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    css: "css",
    html: "html",
    json: "json",
    md: "markdown",
  };
  return mapping[ext || ""] || "text";
};

export function CodeArtifactPanel({ artifacts }: { artifacts: Artifact[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col">
      {artifacts.length > 1 && (
        <div className="border-b bg-muted/20">
          <div className="flex overflow-x-auto">
            {artifacts.map((artifact, index) => {
              const content = artifact.content as CodeContent;
              return (
                <button
                  key={artifact.id}
                  onClick={() => setActiveTab(index)}
                  className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === index
                      ? "border-primary text-primary bg-background"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {content.file
                    ? content.file.split("/").pop()
                    : `Code ${index + 1}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {artifacts.map((artifact, index) => {
          const content = artifact.content as CodeContent;
          return (
            <div
              key={artifact.id}
              className={`h-full flex flex-col ${activeTab === index ? "" : "hidden"}`}
            >
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <Code className="w-4 h-4 flex-shrink-0" />
                  {content.file ? (
                    <div className="flex items-center gap-2 min-w-0">
                      {content.action && getActionIcon(content.action)}
                      <span className="text-sm font-medium truncate">
                        {content.file}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-medium">Code</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(content.content, artifact.id)}
                  className="h-8 w-8 p-0 flex-shrink-0"
                >
                  {copied === artifact.id ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {content.change && (
                <div className="px-4 pt-2 bg-muted/20 border-b text-sm">
                  <div className="flex items-center text-muted-foreground">
                    {/* <span className="font-medium">Change:</span> */}
                    <span>{content.change}</span>
                  </div>
                </div>
              )}

              <div className="p-4 pt-1 flex-1 min-h-0 min-w-0 overflow-auto">
                <SyntaxHighlighter
                  code={content.content}
                  language={
                    content.file
                      ? getLanguageFromFile(content.file)
                      : content.language || "text"
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Get action icon
const getActionIcon = (action: string) => {
  switch (action.toLowerCase()) {
    case "create":
      return <FileText className="w-4 h-4 text-green-500" />;
    case "update":
      return <GitBranch className="w-4 h-4 text-blue-500" />;
    case "delete":
      return <FileText className="w-4 h-4 text-red-500" />;
    default:
      return <FileText className="w-4 h-4 text-gray-500" />;
  }
};
