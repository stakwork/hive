import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspaceById } from "@/services/workspace";
import { getErrorMessage } from "@/lib/utils/error";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey || apiKey !== process.env.API_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workspaceId } = await params;

  try {
    await deleteWorkspaceById(workspaceId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to delete workspace");
    if (message === "Workspace not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
