"use client";

/**
 * Design preview — redesigned workflow canvas nodes in a real React Flow canvas.
 * Visit /prototype/workflow-nodes. Drag nodes, zoom, toggle theme.
 */

import React, { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Sun, Moon } from "lucide-react";
import StepNodeCard, { type StepNodeCardData } from "@/components/workflow/StepNodeCard";

const nodeTypes = { stepCard: StepNodeCard };

type N = Node<StepNodeCardData>;

const NODES: N[] = [
  { id: "start", type: "stepCard", position: { x: 0, y: 212 }, data: { alias: "Start", skill: "", category: "automated", variant: "terminal", terminalKind: "start" } },
  { id: "setvar", type: "stepCard", position: { x: 150, y: 200 }, data: { alias: "set_system_override", skill: "IfValue", category: "setvar", status: "finished", timing: "329ms" } },
  { id: "cond", type: "stepCard", position: { x: 440, y: 214 }, data: { alias: "check_prototype_mode", skill: "IfCondition", category: "condition", status: "finished", variant: "condition" } },
  { id: "request", type: "stepCard", position: { x: 620, y: 70 }, data: { alias: "fetch_context", skill: "Request", category: "request", status: "finished", timing: "415ms" } },
  { id: "json", type: "stepCard", position: { x: 620, y: 330 }, data: { alias: "build_payload", skill: "JSONBuilder", category: "json", status: "finished", timing: "141ms" } },
  { id: "prompt", type: "stepCard", position: { x: 910, y: 70 }, data: { alias: "ask_clarification", skill: "Prompt", category: "prompt", status: "in_progress", timing: "1s" } },
  { id: "boolean", type: "stepCard", position: { x: 910, y: 330 }, data: { alias: "user_approved", skill: "Boolean", category: "boolean", status: "pending" } },
  { id: "foreach", type: "stepCard", position: { x: 1200, y: 70 }, data: { alias: "iterate_files", skill: "forEachLoop", category: "loop", status: "finished", timing: "2m 41s" } },
  { id: "while", type: "stepCard", position: { x: 1200, y: 330 }, data: { alias: "poll_until_ready", skill: "whileLoop", category: "loop", status: "halted", timing: "5m 09s" } },
  { id: "human", type: "stepCard", position: { x: 1490, y: 70 }, data: { alias: "review_changes", skill: "Human review", category: "human", status: "finished", timing: "3m 02s" } },
  { id: "automated", type: "stepCard", position: { x: 1490, y: 330 }, data: { alias: "cleanup_artifacts", skill: "Automated", category: "automated", status: "error", timing: "12ms" } },
  { id: "end", type: "stepCard", position: { x: 1780, y: 80 }, data: { alias: "End", skill: "", category: "automated", variant: "terminal", terminalKind: "end" } },
  { id: "halt", type: "stepCard", position: { x: 1780, y: 330 }, data: { alias: "Halt", skill: "", category: "automated", variant: "terminal", terminalKind: "halt" } },
];

const EDGES: Edge[] = [
  { id: "e0", source: "start", target: "setvar" },
  { id: "e1", source: "setvar", target: "cond" },
  { id: "e2", source: "cond", target: "request" },
  { id: "e3", source: "cond", target: "json" },
  { id: "e4", source: "request", target: "prompt" },
  { id: "e5", source: "json", target: "boolean" },
  { id: "e6", source: "prompt", target: "foreach" },
  { id: "e7", source: "boolean", target: "while" },
  { id: "e8", source: "foreach", target: "human" },
  { id: "e9", source: "while", target: "automated" },
  { id: "e10", source: "human", target: "end" },
  { id: "e11", source: "automated", target: "halt" },
];

export default function WorkflowNodesPreviewPage() {
  const [dark, setDark] = useState(true);

  const defaultEdgeOptions = useMemo(
    () => ({ type: "smoothstep", style: { stroke: "rgba(127,127,127,0.45)", strokeWidth: 1.5 } }),
    [],
  );

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Workflow nodes — redesign preview</h1>
            <p className="text-sm text-muted-foreground">
              Live React Flow canvas. Drag, zoom, pan. Toggle theme to check both. Every status colour is shown.
            </p>
          </div>
          <button
            onClick={() => setDark((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            {dark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {dark ? "Dark" : "Light"}
          </button>
        </div>

        <div className={dark ? "dark" : ""}>
          <div
            className="h-[640px] overflow-hidden rounded-2xl border shadow-xl ring-1 ring-black/5"
            style={{ backgroundColor: "var(--background)" }}
          >
            <ReactFlow
              nodes={NODES}
              edges={EDGES}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(127,127,127,0.35)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Statuses: green check = finished · sky pulse = running · red = error · grey = skipped/pending. Left accent
          bar keeps state readable when zoomed out.
        </p>
      </div>
    </div>
  );
}
