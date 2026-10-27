import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { startCall } from "@/lib/calls/startCall";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug: rawSlug } = await params;
    const swarmName = request.nextUrl.searchParams.get("swarmName");

    // Resolve workspace slug: use URL slug if real, otherwise look up by swarmName
    let slug = rawSlug && rawSlug !== "_" ? rawSlug : null;

    if (!slug && swarmName) {
      const swarm = await db.swarm.findUnique({
        where: { name: swarmName },
        select: { workspace: { select: { slug: true, deleted: true } } },
      });
      if (swarm?.workspace && !swarm.workspace.deleted) {
        slug = swarm.workspace.slug;
      }
    }

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug or swarmName query parameter is required" },
        { status: 400 },
      );
    }

    const result = await startCall({
      userId: userOrResponse.id,
      slug,
      scope: request.nextUrl.searchParams.get("scope") === "workspace" ? "workspace" : "org",
    });
    if ("url" in result) return NextResponse.json({ url: result.url });
    return NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("Error generating call link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
