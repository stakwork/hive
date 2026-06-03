import { NextRequest, NextResponse } from "next/server";
import type { JarvisNode } from "@/types/jarvis";

export const runtime = "nodejs";

type RequirementNode = JarvisNode & {
  properties: {
    name: string;
    description: string;
    prompt_snippet: string;
    positive_cases: string[];
    negative_cases: string[];
    order: number;
  };
};

const SEED_REQUIREMENTS: Record<string, RequirementNode[]> = {
  "eval-set-1": [
    {
      ref_id: "req-1-1",
      node_type: "EvalRequirement",
      properties: {
        name: "Basic greeting response",
        description: "Agent should greet the user appropriately",
        prompt_snippet: "Say hello to the user",
        positive_cases: ["Response includes a greeting", "Response is polite"],
        negative_cases: ["Response is rude", "Response ignores the user"],
        order: 0,
      },
    },
    {
      ref_id: "req-1-2",
      node_type: "EvalRequirement",
      properties: {
        name: "Code generation accuracy",
        description: "Agent should generate syntactically correct code",
        prompt_snippet: "Write a function that adds two numbers",
        positive_cases: ["Output is valid JavaScript", "Function accepts two arguments", "Returns the sum"],
        negative_cases: ["Syntax errors present", "Wrong return value"],
        order: 1,
      },
    },
    {
      ref_id: "req-1-3",
      node_type: "EvalRequirement",
      properties: {
        name: "Error handling explanation",
        description: "Agent should explain errors clearly",
        prompt_snippet: "Explain what a null pointer exception is",
        positive_cases: ["Explains the concept clearly", "Provides an example"],
        negative_cases: ["Response is too technical", "No explanation given"],
        order: 2,
      },
    },
  ],
  "eval-set-2": [
    {
      ref_id: "req-2-1",
      node_type: "EvalRequirement",
      properties: {
        name: "Security vulnerability detection",
        description: "Agent should identify SQL injection risks",
        prompt_snippet: "Review this query for security issues",
        positive_cases: ["Identifies injection risk", "Suggests parameterized queries"],
        negative_cases: ["Misses the vulnerability", "No remediation suggested"],
        order: 0,
      },
    },
    {
      ref_id: "req-2-2",
      node_type: "EvalRequirement",
      properties: {
        name: "Refactor suggestion quality",
        description: "Agent should suggest meaningful refactors",
        prompt_snippet: "How can I improve this function?",
        positive_cases: ["Suggestions improve readability", "Performance considered"],
        negative_cases: ["Suggestions break functionality", "No explanation provided"],
        order: 1,
      },
    },
  ],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ evalSetId: string }> },
) {
  const { evalSetId } = await params;
  const nodes = SEED_REQUIREMENTS[evalSetId] ?? [];
  return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, description, prompt_snippet, positive_cases, negative_cases } =
    body ?? {};

  const newNode: JarvisNode = {
    ref_id: crypto.randomUUID(),
    node_type: "EvalRequirement",
    properties: {
      name,
      description,
      prompt_snippet,
      positive_cases: positive_cases ?? [],
      negative_cases: negative_cases ?? [],
    },
  };

  return NextResponse.json({ success: true, data: { ref_id: newNode.ref_id } });
}
