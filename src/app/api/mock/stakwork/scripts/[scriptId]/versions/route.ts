import { NextRequest, NextResponse } from "next/server";

const mockVersions: Record<number, { id: number; script_id: number; version_number: number; created_at: string; whodunnit: string | null; event: string | null }[]> = {
  1: [
    {
      id: 3,
      script_id: 1,
      version_number: 3,
      created_at: "2024-03-05T11:00:00Z",
      whodunnit: "Alice Developer",
      event: "update",
    },
    {
      id: 2,
      script_id: 1,
      version_number: 2,
      created_at: "2024-02-10T14:00:00Z",
      whodunnit: "Bob Engineer",
      event: "update",
    },
    {
      id: 1,
      script_id: 1,
      version_number: 1,
      created_at: "2024-01-10T08:00:00Z",
      whodunnit: "Alice Developer",
      event: "create",
    },
  ],
  2: [
    {
      id: 5,
      script_id: 2,
      version_number: 2,
      created_at: "2024-02-28T16:00:00Z",
      whodunnit: "Charlie Tech Lead",
      event: "update",
    },
    {
      id: 4,
      script_id: 2,
      version_number: 1,
      created_at: "2024-01-20T09:30:00Z",
      whodunnit: "Charlie Tech Lead",
      event: "create",
    },
  ],
  3: [
    {
      id: 7,
      script_id: 3,
      version_number: 2,
      created_at: "2024-03-01T09:15:00Z",
      whodunnit: "Dana Security",
      event: "update",
    },
    {
      id: 6,
      script_id: 3,
      version_number: 1,
      created_at: "2024-02-05T12:00:00Z",
      whodunnit: "Dana Security",
      event: "create",
    },
  ],
  4: [
    {
      id: 9,
      script_id: 4,
      version_number: 1,
      created_at: "2024-03-01T10:00:00Z",
      whodunnit: "Eve PM",
      event: "create",
    },
  ],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const { scriptId } = await params;
    const id = parseInt(scriptId);

    const versions = mockVersions[id] || [];

    return NextResponse.json({
      success: true,
      data: {
        versions,
        total: versions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching mock script versions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
