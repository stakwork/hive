import { NextRequest, NextResponse } from "next/server";

// Mock prompt database
const mockPrompts = new Map([
  [
    1,
    {
      id: 1,
      name: "User Story Generator",
      value: "Generate a detailed user story for the following feature:\n\n{feature_description}\n\nInclude acceptance criteria and technical considerations.",
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
      value: "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Performance issues\n4. Security concerns\n\nCode:\n{code}",
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
      value: "Create comprehensive API documentation for:\n\nEndpoint: {endpoint}\nMethod: {method}\nDescription: {description}\n\nInclude request/response examples and error cases.",
      description: "Generates clear API documentation with examples",
      workflow_id: 103,
      current_version_id: 2,
      version_count: 1,
      created_at: "2024-02-01T11:00:00Z",
      updated_at: "2024-02-27T10:00:00Z",
    },
  ],
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id);

    const prompt = mockPrompts.get(promptId);

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: prompt,
    });
  } catch (error) {
    console.error("Error fetching mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch prompt" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id);
    const body = await request.json();

    const existingPrompt = mockPrompts.get(promptId);

    if (!existingPrompt) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    const updatedPrompt = {
      ...existingPrompt,
      name: body.name ?? existingPrompt.name,
      value: body.value ?? existingPrompt.value,
      description: body.description ?? existingPrompt.description,
      current_version_id: existingPrompt.current_version_id + 1,
      updated_at: new Date().toISOString(),
    };

    mockPrompts.set(promptId, updatedPrompt);

    return NextResponse.json({
      success: true,
      data: updatedPrompt,
    });
  } catch (error) {
    console.error("Error updating mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update prompt" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id);

    if (!mockPrompts.has(promptId)) {
      return NextResponse.json(
        { success: false, error: "Prompt not found" },
        { status: 404 }
      );
    }

    mockPrompts.delete(promptId);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error deleting mock prompt:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
