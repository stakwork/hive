import { NextRequest, NextResponse } from "next/server";
import type { JarvisNode } from "@/types/jarvis";

export const runtime = "nodejs";

const MOCK_EVAL_SETS: JarvisNode[] = [
  {
    ref_id: "eval-set-1",
    node_type: "EvalSet",
    properties: {
      name: "Code Quality Evals",
      description: "Checks for clean code patterns",
    },
  },
  {
    ref_id: "eval-set-2",
    node_type: "EvalSet",
    properties: {
      name: "Agent Accuracy Suite",
      description: "Tests agent instruction-following",
    },
  },
  {
    ref_id: "eval-set-3",
    node_type: "EvalSet",
    properties: {
      name: "Refactoring Safety",
      description: "Ensures no regressions on refactor tasks",
    },
  },
];

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    data: { nodes: MOCK_EVAL_SETS, total: MOCK_EVAL_SETS.length },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, description } = body ?? {};

  const newNode: JarvisNode = {
    ref_id: crypto.randomUUID(),
    node_type: "EvalSet",
    properties: { name, description },
  };

  return NextResponse.json({ success: true, data: { ref_id: newNode.ref_id } });
}
