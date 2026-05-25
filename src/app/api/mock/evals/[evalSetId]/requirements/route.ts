import { NextRequest, NextResponse } from "next/server";
import type { JarvisNode } from "@/types/jarvis";

export const runtime = "nodejs";

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
