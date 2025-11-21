import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceLogoService } from "@/services/workspace-logo";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const user = requireAuth(context);
    if (user instanceof NextResponse) return user;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    const logoService = getWorkspaceLogoService();
    await logoService.removeLogo(slug, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing workspace logo:", error);

    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
      }
      if (error.message.includes("Insufficient permissions")) {
        return NextResponse.json({ error: "Only workspace owners and admins can remove logos" }, { status: 403 });
      }
      if (error.message.includes("has no logo")) {
        return NextResponse.json({ error: "Workspace has no logo to remove" }, { status: 404 });
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
