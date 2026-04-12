"use client";

import { ArrowLeft, FileText, GitBranch, BookOpen, Code2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiagramViewer } from "@/app/w/[slug]/learn/components/DiagramViewer";
import ReactMarkdown from "react-markdown";
import type { ConnectionData } from "./ConnectionsPage";

interface ConnectionViewerProps {
  connection: ConnectionData;
  onBack: () => void;
}

export function ConnectionViewer({ connection, onBack }: ConnectionViewerProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-lg font-semibold truncate">{connection.name}</h1>
      </div>

      {/* Stacked sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Overview Section */}
        <section className="border-b">
          <div className="flex items-center gap-2 px-6 pt-6 pb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Overview
            </h2>
          </div>
          <div className="px-6 pb-6 prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{connection.summary}</ReactMarkdown>
          </div>
        </section>

        {/* Diagram Section */}
        <section className="border-b">
          <div className="flex items-center gap-2 px-6 pt-6 pb-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Diagram
            </h2>
          </div>
          {connection.diagram ? (
            <div className="h-[500px]">
              <DiagramViewer
                name={connection.name}
                body={connection.diagram}
                hideHeader
              />
            </div>
          ) : (
            <div className="px-6 pb-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Diagram pending</span>
            </div>
          )}
        </section>

        {/* Architecture Section */}
        <section className="border-b">
          <div className="flex items-center gap-2 px-6 pt-6 pb-3">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Architecture
            </h2>
          </div>
          {connection.architecture ? (
            <div className="px-6 pb-6 prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{connection.architecture}</ReactMarkdown>
            </div>
          ) : (
            <div className="px-6 pb-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Architecture pending</span>
            </div>
          )}
        </section>

        {/* OpenAPI Section */}
        <section>
          <div className="flex items-center gap-2 px-6 pt-6 pb-3">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              API Documentation
            </h2>
          </div>
          {connection.openApiSpec ? (
            <div className="px-6 pb-6">
              <pre className="text-xs bg-muted/30 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
                {connection.openApiSpec}
              </pre>
            </div>
          ) : (
            <div className="px-6 pb-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>API docs pending</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
