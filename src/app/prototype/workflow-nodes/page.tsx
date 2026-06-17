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
  { id: "n1", type: "stepCard", position: { x: 0, y: 140 }, data: { alias: "set_system_override", skill: "IfValue", category: "setvar", status: "finished", timing: "329ms" } },
  { id: "c1", type: "stepCard", position: { x: 280, y: 150 }, data: { alias: "check_prototype_mode", skill: "IfCondition", category: "condition", status: "finished", variant: "condition" } },
  { id: "n2", type: "stepCard", position: { x: 470, y: 40 }, data: { alias: "set_user_msg_and_history", skill: "IfValue", category: "setvar", status: "finished", timing: "415ms" } },
  { id: "n3", type: "stepCard", position: { x: 470, y: 250 }, data: { alias: "set_final_prompt", skill: "IfValue", category: "setvar", status: "finished", timing: "117ms" } },
  { id: "n4", type: "stepCard", position: { x: 760, y: 40 }, data: { alias: "build_feature_title_prompt", skill: "JSONBuilder", category: "json", status: "finished", timing: "141ms" } },
  { id: "n5", type: "stepCard", position: { x: 760, y: 250 }, data: { alias: "llm_generate_feature_title", skill: "Request", category: "request", status: "in_progress", timing: "1s" } },
  { id: "n6", type: "stepCard", position: { x: 1050, y: 40 }, data: { alias: "validate_title_schema", skill: "JSONBuilder", category: "json", status: "error", timing: "12ms" } },
  { id: "n7", type: "stepCard", position: { x: 1050, y: 250 }, data: { alias: "set_feature_title", skill: "SetVar", category: "setvar", status: "pending" } },
  { id: "c2", type: "stepCard", position: { x: 1340, y: 150 }, data: { alias: "skip_title_update", skill: "IfCondition", category: "condition", status: "skipped", variant: "condition" } },
];

const EDGES: Edge[] = [
  { id: "e1", source: "n1", target: "c1" },
  { id: "e2", source: "c1", target: "n2" },
  { id: "e3", source: "c1", target: "n3" },
  { id: "e4", source: "n2", target: "n4" },
  { id: "e5", source: "n3", target: "n5" },
  { id: "e6", source: "n4", target: "n6" },
  { id: "e7", source: "n5", target: "n7" },
  { id: "e8", source: "n6", target: "c2" },
  { id: "e9", source: "n7", target: "c2" },
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
