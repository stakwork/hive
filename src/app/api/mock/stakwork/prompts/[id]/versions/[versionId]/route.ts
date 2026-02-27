import { NextRequest, NextResponse } from "next/server";

// Mock version data - same as in versions/route.ts but accessible by version ID
const mockVersionData: Record<number, any> = {
  1: {
    id: 1,
    prompt_id: 1,
    value: "Create a user story for: {feature_description}",
    created_at: "2024-01-15T10:00:00Z",
    created_by: "Alice Developer",
  },
  2: {
    id: 2,
    prompt_id: 1,
    value: "Generate a user story for:\n\n{feature_description}\n\nInclude acceptance criteria.",
    created_at: "2024-02-10T10:15:00Z",
    created_by: "Bob PM",
  },
  3: {
    id: 3,
    prompt_id: 1,
    value: "Generate a detailed user story for the following feature:\n\n{feature_description}\n\nInclude acceptance criteria and technical considerations.",
    created_at: "2024-02-20T14:30:00Z",
    created_by: "Alice Developer",
  },
  4: {
    id: 4,
    prompt_id: 2,
    value: "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Security concerns\n\nCode:\n{code}",
    created_at: "2024-02-15T12:00:00Z",
    created_by: "Charlie Tech Lead",
  },
  5: {
    id: 5,
    prompt_id: 2,
    value: "Review the following code for:\n1. Best practices\n2. Potential bugs\n3. Performance issues\n4. Security concerns\n\nCode:\n{code}",
    created_at: "2024-02-25T16:45:00Z",
    created_by: "Charlie Tech Lead",
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { versionId } = await params;
    const versionIdNum = parseInt(versionId);

    const version = mockVersionData[versionIdNum];

    if (!version) {
      return NextResponse.json(
        { success: false, error: "Version not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: version,
    });
  } catch (error) {
    console.error("Error fetching mock version:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}
