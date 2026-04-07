import { NextRequest, NextResponse } from "next/server";

// Shared in-memory store — mirrors the one in [id]/route.ts
// In dev, all mock routes share the same module cache so this Map is the same object.
const mockPrompts = new Map([
  [
    1,
    {
      id: 1,
      name: "User Story Generator",
      value:
        "Generate a detailed user story for the following feature:\n\n{feature_description}\n\nInclude acceptance criteria and technical considerations.",
      description: "Generates structured user stories from feature descriptions",
      workflow_id: 101,
      current_version_id: 3,
      version_count: 5,
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-02-20T14:30:00Z",
    },
  ],
  [
    2,
    {
      id: 2,
      name: "Code Review Assistant",
      value:
        "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Performance issues\n4. Security concerns\n\nCode:\n{code}",
      description: "AI-powered code review with focus on quality and security",
      workflow_id: 102,
      current_version_id: 5,
      version_count: 2,
      created_at: "2024-01-20T09:00:00Z",
      updated_at: "2024-02-25T16:45:00Z",
    },
  ],
  [
    3,
    {
      id: 3,
      name: "API Documentation Writer",
      value:
        "Create comprehensive API documentation for:\n\nEndpoint: {endpoint}\nMethod: {method}\nDescription: {description}\n\nInclude request/response examples and error cases.",
      description: "Generates clear API documentation with examples",
      workflow_id: 103,
      current_version_id: 2,
      version_count: 1,
      created_at: "2024-02-01T11:00:00Z",
      updated_at: "2024-02-27T10:00:00Z",
    },
  ],
]);

// Known version IDs per prompt (mirrors [versionId]/route.ts data)
const versionToPromptMap: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id, versionId } = await params;
    const promptId = parseInt(id);
    const versionIdNum = parseInt(versionId);

    const prompt = mockPrompts.get(promptId);
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    const owningPromptId = versionToPromptMap[versionIdNum];
    if (owningPromptId === undefined || owningPromptId !== promptId) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    // Update current_version_id in the mock store
    mockPrompts.set(promptId, {
      ...prompt,
      current_version_id: versionIdNum,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error publishing mock prompt version:", error);
    return NextResponse.json(
      { success: false, error: "Failed to publish version" },
      { status: 500 }
    );
  }
}
