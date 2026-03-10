"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  Bot,
  User,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Bug,
  FlaskConical,
  Pencil,
  GitCompare,
  Workflow,
  Layers,
  Play,
  Terminal,
  History,
  Loader2,
} from "lucide-react";

// ──────────────────────────────────────────────
// Mock data
// ──────────────────────────────────────────────

// The agent debug summary — exactly the long markdown the agent returns
const AGENT_DEBUG_MARKDOWN = `## Run 143404227 — ✅ SUCCESS!

The workflow completed fully end-to-end with \`wf_state: completed\`. Every step passed:

| Step | Status | Output |
|------|--------|--------|
| \`set_var\` | ✅ finished | inputs received correctly |
| \`wait_for_skill\` | ✅ finished | broke after 1 loop, \`skill_found_check\` returned \`"found"\` |
| \`build_message\` | ✅ finished | \`"Your skill SetVar is ready to be used"\` |
| \`build_webhook_body\` | ✅ finished | \`{"taskId": "cmmjcb00k000zlf048ougqmyy", "message": "Your skill SetVar is ready to be used"}\` |
| \`send_webhook\` | ✅ finished | HTTP 200, \`success: true\` |

### Webhook Response from hive.sphinx.chat

\`\`\`json
{
  "success": true,
  "data": {
    "id": "cmmjg34ek000jl204jgg9csva",
    "taskId": "cmmjcb00k000zlf048ougqmyy",
    "message": "Your skill SetVar is ready to be used",
    "role": "ASSISTANT",
    "status": "SENT",
    "timestamp": "2026-03-09T17:18:18.380Z"
  }
}
\`\`\`

The notification was sent and received successfully. The workflow is fully working! 🎉
`;

// A second run to show history
const AGENT_DEBUG_MARKDOWN_PREV = `## Run 143404101 — ❌ FAILED

The workflow failed at \`send_webhook\` step with a 401 Unauthorized response.

| Step | Status | Output |
|------|--------|--------|
| \`set_var\` | ✅ finished | inputs received correctly |
| \`wait_for_skill\` | ✅ finished | \`skill_found_check\` returned \`"found"\` |
| \`build_message\` | ✅ finished | \`"Your skill SetVar is ready to be used"\` |
| \`build_webhook_body\` | ✅ finished | payload constructed |
| \`send_webhook\` | ❌ error | HTTP 401 Unauthorized — check webhook token |

**Root cause:** The webhook auth token was missing from the step configuration. Update \`WEBHOOK_SECRET\` in the step env vars and re-run.
`;

const MOCK_CHAT = [
  {
    id: "1",
    role: "user",
    content: "Test the notify skill workflow end-to-end.",
    ts: "3 min ago",
  },
  {
    id: "2",
    role: "assistant",
    content: "I'll trigger a test run now and report back once it's complete.",
    ts: "3 min ago",
  },
  {
    id: "3",
    role: "user",
    content: "The webhook body looks off — `taskId` should be snake_case. Can you fix that?",
    ts: "1 min ago",
  },
  {
    id: "4",
    role: "assistant",
    content:
      "Good catch. I've updated `build_webhook_body` to use `task_id`. Re-running the test now…",
    ts: "45s ago",
  },
];

const CHILD_WORKFLOWS = [
  { id: "441", name: "Notify Skill — Core" },
  { id: "442", name: "Webhook Dispatcher" },
];

const DEBUG_RUNS = [
  { id: "143404227", status: "success", ts: "2 min ago", label: "Run #143404227" },
  { id: "143404101", status: "failed",  ts: "8 min ago", label: "Run #143404101" },
];

// ──────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> Passed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
      ❌ Failed
    </span>
  );
}

// Placeholder for the workflow diagram (greyed-out mock)
function WorkflowDiagramMock({ label = "Workflow Diagram" }: { label?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-muted/10 gap-3">
      <Workflow className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground/50">{label}</p>
    </div>
  );
}

// Placeholder for Changes panel
function ChangesMock() {
  return (
    <div className="p-4 space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-3">Changed Steps</p>
      {["build_webhook_body"].map((s) => (
        <div key={s} className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs font-mono text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
          {s}
          <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1 border-amber-500/30 text-amber-500">modified</Badge>
        </div>
      ))}
    </div>
  );
}

// Chat area (left side)
function ChatArea() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-4">
          {MOCK_CHAT.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && (
                <div className="h-7 w-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className={cn(
                "max-w-[82%] rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm",
              )}>
                <MarkdownRenderer size="compact" variant={m.role === "user" ? "user" : "assistant"}>
                  {m.content}
                </MarkdownRenderer>
                <p className={cn("mt-1 text-[10px] opacity-40", m.role === "user" && "text-right")}>{m.ts}</p>
              </div>
              {m.role === "user" && (
                <div className="h-7 w-7 shrink-0 rounded-full bg-muted flex items-center justify-center mt-0.5">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-3 bg-background">
        <div className="flex items-end gap-2 rounded-xl border bg-muted/30 px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
          <Textarea
            placeholder="Ask the agent to modify the workflow…"
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            rows={1}
          />
          <Button size="icon" className="h-7 w-7 shrink-0 rounded-lg">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// The three Debug tab content variations
// ──────────────────────────────────────────────

// Variation A: Latest run only — clean markdown view
function DebugTabLatestOnly() {
  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <RunStatusBadge status="success" />
          <a
            href="https://jobs.stakwork.com/admin/projects/143404227"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View on Stakwork <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <MarkdownRenderer size="compact">
          {AGENT_DEBUG_MARKDOWN}
        </MarkdownRenderer>
      </div>
    </ScrollArea>
  );
}

// Variation B: Run history list on top, markdown below
function DebugTabWithHistory() {
  const [selectedRun, setSelectedRun] = useState(DEBUG_RUNS[0]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Run selector strip */}
      <div className="shrink-0 border-b bg-muted/20 px-3 py-2 flex items-center gap-2 flex-wrap">
        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground font-medium shrink-0">Test runs:</span>
        <div className="flex gap-1.5 flex-wrap">
          {DEBUG_RUNS.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedRun(r)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                selectedRun.id === r.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground",
              )}
            >
              {r.status === "success"
                ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                : <span className="text-[10px]">❌</span>
              }
              {r.label}
              <span className="opacity-60">{r.ts}</span>
            </button>
          ))}
        </div>
        <a
          href="https://jobs.stakwork.com/admin/projects/143404227"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Stakwork <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Markdown content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <MarkdownRenderer size="compact">
            {selectedRun.status === "success" ? AGENT_DEBUG_MARKDOWN : AGENT_DEBUG_MARKDOWN_PREV}
          </MarkdownRenderer>
        </div>
      </ScrollArea>
    </div>
  );
}

// Variation C: Markdown with a slim status bar at top (minimal chrome)
function DebugTabMinimalHeader() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Thin status bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-emerald-500/5 border-emerald-500/15">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          Run #143404227 passed · 5/5 steps
        </span>
        <span className="text-xs text-muted-foreground ml-1">2 min ago</span>
        <a
          href="https://jobs.stakwork.com/admin/projects/143404227"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Full markdown */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <MarkdownRenderer size="compact">
            {AGENT_DEBUG_MARKDOWN}
          </MarkdownRenderer>
        </div>
      </ScrollArea>
    </div>
  );
}

// ──────────────────────────────────────────────
// The shared WorkflowArtifactPanel tab shell
// mirrors the REAL component — tabs + content
// ──────────────────────────────────────────────

type WorkflowTab = "editor" | "changes" | "prompts" | "stakwork" | "children" | "debug";

function WorkflowArtifactPanelShell({
  debugTabContent,
  defaultTab = "debug",
  showDebugBadge = false,
}: {
  debugTabContent: React.ReactNode;
  defaultTab?: WorkflowTab;
  showDebugBadge?: boolean;
}) {
  const [tab, setTab] = useState<WorkflowTab>(defaultTab);

  // matches real col count logic: 3 base + changes + children + debug
  const tabs: { value: WorkflowTab; label: React.ReactNode }[] = [
    { value: "editor",   label: <><Pencil className="h-3 w-3 mr-1" />Edit Steps</> },
    { value: "changes",  label: <><GitCompare className="h-3 w-3 mr-1" />Changes</> },
    { value: "prompts",  label: <><Layers className="h-3 w-3 mr-1" />Prompts</> },
    { value: "stakwork", label: <><Play className="h-3 w-3 mr-1" />Stak Run</> },
    { value: "children", label: <><Workflow className="h-3 w-3 mr-1" />Child Workflows</> },
    {
      value: "debug",
      label: (
        <span className="flex items-center gap-1">
          <Terminal className="h-3 w-3" />
          Debug
          {showDebugBadge && (
            <span className="ml-0.5 flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Mirrors the StakworkRunDropdown button area */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <button className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors">
          <Play className="h-3 w-3" />
          Run #143404227
          <ExternalLink className="h-3 w-3 ml-0.5 opacity-50" />
        </button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as WorkflowTab)}
        className="flex flex-col flex-1 overflow-hidden"
      >
        {/* 6-column grid matching real panel grid layout */}
        <TabsList className="grid w-full flex-shrink-0 grid-cols-6 mx-0 rounded-none border-b bg-transparent h-9">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className={cn(
                "flex items-center text-[11px] px-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-full",
                t.value === "debug" && "data-[state=active]:border-emerald-500",
              )}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="editor"   className="flex-1 overflow-hidden mt-0"><WorkflowDiagramMock label="Edit Steps — Workflow Diagram" /></TabsContent>
        <TabsContent value="changes"  className="flex-1 overflow-auto  mt-0"><ChangesMock /></TabsContent>
        <TabsContent value="prompts"  className="flex-1 overflow-hidden mt-0"><WorkflowDiagramMock label="Prompts Panel" /></TabsContent>
        <TabsContent value="stakwork" className="flex-1 overflow-hidden mt-0"><WorkflowDiagramMock label="Stak Run — Live Diagram" /></TabsContent>
        <TabsContent value="children" className="flex-1 overflow-auto  mt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="w-16">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CHILD_WORKFLOWS.map((wf) => (
                <TableRow key={wf.id}>
                  <TableCell className="font-medium text-sm">{wf.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{wf.id}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="debug" className="flex-1 overflow-hidden mt-0">
          {debugTabContent}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────
// Full layout: chat left | artifact panel right
// This is the actual production layout in workflow_editor mode
// ──────────────────────────────────────────────

function FullLayout({
  label,
  debugContent,
  showDebugBadge = false,
}: {
  label: string;
  debugContent: React.ReactNode;
  showDebugBadge?: boolean;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Variation label bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b bg-background">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Notify Skill Workflow — Editor Mode</span>
        <span className="ml-auto text-xs text-muted-foreground italic">{label}</span>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Chat panel */}
        <ResizablePanel defaultSize={38} minSize={25}>
          <div className="h-full border-r">
            <ChatArea />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* WorkflowArtifactPanel */}
        <ResizablePanel defaultSize={62} minSize={35}>
          <WorkflowArtifactPanelShell
            debugTabContent={debugContent}
            defaultTab="debug"
            showDebugBadge={showDebugBadge}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ──────────────────────────────────────────────
// Page Shell
// ──────────────────────────────────────────────

const VARIATIONS = [
  {
    id: "a",
    label: "A — Latest run only",
    desc: "Debug tab shows the most recent run summary as plain markdown. Simple, no history UI.",
    content: <DebugTabLatestOnly />,
    badge: false,
  },
  {
    id: "b",
    label: "B — Run history strip",
    desc: "A pill row at the top lets you switch between past test runs. Markdown below.",
    content: <DebugTabWithHistory />,
    badge: false,
  },
  {
    id: "c",
    label: "C — Status bar header",
    desc: "Thin coloured status bar (pass/fail + step count) above the markdown body. Minimal chrome.",
    content: <DebugTabMinimalHeader />,
    badge: true,
  },
];

export default function WorkflowDebugPrototype() {
  const [active, setActive] = useState("a");
  const current = VARIATIONS.find((v) => v.id === active)!;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Selector */}
      <div className="shrink-0 border-b bg-muted/20 px-4 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Debug Tab in Workflow Editor</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {VARIATIONS.map((v) => (
            <button
              key={v.id}
              onClick={() => setActive(v.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                active === v.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground hidden md:block italic">{current.desc}</p>
      </div>

      {/* Live preview */}
      <div className="flex-1 overflow-hidden">
        <FullLayout
          key={active}
          label={current.label}
          debugContent={current.content}
          showDebugBadge={current.badge}
        />
      </div>
    </div>
  );
}
