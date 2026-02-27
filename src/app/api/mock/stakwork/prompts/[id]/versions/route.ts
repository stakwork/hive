import { NextRequest, NextResponse } from "next/server";

// Mock version history for prompts
const mockVersions: Record<number, any[]> = {
  1: [
    {
      id: 3,
      prompt_id: 1,
      value: "Generate a detailed user story for the following feature:\n\n{feature_description}\n\nInclude acceptance criteria and technical considerations.",
      created_at: "2024-02-20T14:30:00Z",
      created_by: "Alice Developer",
    },
    {
      id: 2,
      prompt_id: 1,
      value: "Generate a user story for:\n\n{feature_description}\n\nInclude acceptance criteria.",
      created_at: "2024-02-10T10:15:00Z",
      created_by: "Bob PM",
    },
    {
      id: 1,
      prompt_id: 1,
      value: "Create a user story for: {feature_description}",
      created_at: "2024-01-15T10:00:00Z",
      created_by: "Alice Developer",
    },
  ],
  2: [
    {
      id: 5,
      prompt_id: 2,
      value: "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Performance issues\n4. Security concerns\n\nCode:\n{code}",
      created_at: "2024-02-25T16:45:00Z",
      created_by: "Charlie Tech Lead",
    },
    {
      id: 4,
      prompt_id: 2,
      value: "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Security concerns\n\nCode:\n{code}",
      created_at: "2024-02-15T12:00:00Z",
      created_by: "Charlie Tech Lead",
    },
    {
      id: 3,
      prompt_id: 2,
      value: "Review this code for best practices and bugs:\n{code}",
      created_at: "2024-02-05T09:30:00Z",
      created_by: "David Dev",
    },
    {
      id: 2,
      prompt_id: 2,
      value: "Review this code:\n{code}",
      created_at: "2024-01-25T14:00:00Z",
      created_by: "Charlie Tech Lead",
    },
    {
      id: 1,
      prompt_id: 2,
      value: "Check code quality: {code}",
      created_at: "2024-01-20T09:00:00Z",
      created_by: "David Dev",
    },
  ],
  3: [
    {
      id: 2,
      prompt_id: 3,
      value: "Create comprehensive API documentation for:\n\nEndpoint: {endpoint}\nMethod: {method}\nDescription: {description}\n\nInclude request/response examples and error cases.",
      created_at: "2024-02-27T10:00:00Z",
      created_by: "Emma API Specialist",
    },
    {
      id: 1,
      prompt_id: 3,
      value: "Document this API:\nEndpoint: {endpoint}\nMethod: {method}\nDescription: {description}",
      created_at: "2024-02-01T11:00:00Z",
      created_by: "Emma API Specialist",
    },
  ],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const promptId = parseInt(id);

    const versions = mockVersions[promptId] || [];

    return NextResponse.json({
      success: true,
      data: {
        versions,
        total: versions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching mock versions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
