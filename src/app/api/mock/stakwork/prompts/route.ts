import { NextRequest, NextResponse } from "next/server";

// Mock prompts data
const mockPrompts = [
  {
    id: 1,
    name: "system-prompt-v1",
    value: "You are a helpful AI assistant. Always be polite and professional.",
    description: "Basic system prompt for general assistance",
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-02-20T15:30:00Z",
    current_version_id: 3,
    version_count: 5,
    versions: [
      {
        id: 1,
        prompt_id: 1,
        value: "You are an AI assistant.",
        created_at: "2024-01-15T10:00:00Z",
      },
      {
        id: 2,
        prompt_id: 1,
        value: "You are a helpful AI assistant.",
        created_at: "2024-01-20T14:00:00Z",
      },
      {
        id: 3,
        prompt_id: 1,
        value: "You are a helpful AI assistant. Always be polite and professional.",
        created_at: "2024-02-20T15:30:00Z",
      },
    ],
  },
  {
    id: 2,
    name: "code-review-prompt",
    value: "Review this code for:\n- Bugs\n- Performance issues\n- Security vulnerabilities\n- Best practices\n\nProvide detailed feedback.",
    description: "Prompt for AI code review tasks",
    created_at: "2024-02-01T09:00:00Z",
    updated_at: "2024-02-25T11:20:00Z",
    current_version_id: 5,
    version_count: 2,
    versions: [
      {
        id: 4,
        prompt_id: 2,
        value: "Review this code and provide feedback.",
        created_at: "2024-02-01T09:00:00Z",
      },
      {
        id: 5,
        prompt_id: 2,
        value: "Review this code for:\n- Bugs\n- Performance issues\n- Security vulnerabilities\n- Best practices\n\nProvide detailed feedback.",
        created_at: "2024-02-25T11:20:00Z",
      },
    ],
  },
  {
    id: 3,
    name: "new-prompt-no-history",
    value: "This is a brand new prompt with no version history yet.",
    description: "Testing empty history state",
    created_at: "2024-02-27T12:00:00Z",
    updated_at: "2024-02-27T12:00:00Z",
    current_version_id: 6,
    version_count: 1,
    versions: [],
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const size = parseInt(searchParams.get("size") || "10");

  return NextResponse.json({
    success: true,
    data: {
      prompts: mockPrompts,
      total: mockPrompts.length,
      size,
      page,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const newPrompt = {
    id: mockPrompts.length + 1,
    name: body.name,
    value: body.value,
    description: body.description || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_version_id: mockPrompts.length + 10,
    versions: [],
  };

  mockPrompts.push(newPrompt);

  return NextResponse.json({
    success: true,
    data: newPrompt,
  });
}
