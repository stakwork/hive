import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceLogoService } from "@/services/workspace-logo";
import { workspaceLogoUploadRequestSchema } from "@/lib/schemas/workspace";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const user = requireAuth(context);
    if (user instanceof NextResponse) return user;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    const body = await request.json();
    const validatedData = workspaceLogoUploadRequestSchema.parse(body);

    const logoService = getWorkspaceLogoService();
    const result = await logoService.requestUploadUrl(slug, user.id, validatedData);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error generating presigned upload URL:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
      }
      if (error.message.includes("Insufficient permissions")) {
        return NextResponse.json({ error: "Only workspace owners and admins can upload logos" }, { status: 403 });
      }
      if (error.message.includes("Invalid file type")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.message.includes("File size exceeds")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
