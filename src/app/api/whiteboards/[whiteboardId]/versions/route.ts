import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

const MAX_VERSIONS = 10;

async function checkWhiteboardAccess(whiteboardId: string, userId: string) {
  const whiteboard = await db.whiteboards.findUnique({
    where: { id: whiteboardId },
    include: {
      workspace: {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!whiteboard) return null;

  const isOwner = whiteboard.workspace.ownerId === userId;
  const isMember = whiteboard.workspace.members.length > 0;

  if (!isOwner && !isMember) return "forbidden" as const;

  return whiteboard;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const access = await checkWhiteboardAccess(whiteboardId, userOrResponse.id);
    if (!access) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const versions = await db.whiteboard_versions.findMany({
      where: { whiteboardId },
      orderBy: { createdAt: "desc" },
      take: MAX_VERSIONS,
      select: { id: true, label: true, createdAt: true, elements: true, appState: true, files: true },
    });

    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    console.error("Error fetching whiteboard versions:", error);
    return NextResponse.json({ error: "Failed to fetch versions" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const access = await checkWhiteboardAccess(whiteboardId, userOrResponse.id);
    if (!access) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();
    const { elements, appState, files, label } = body;

    const newVersion = await db.$transaction(async (tx) => {
      const created = await tx.whiteboard_versions.create({
        data: {
          whiteboardId,
          elements: elements ?? [],
          appState: appState ?? {},
          files: files ?? {},
          label: label ?? new Date().toLocaleString(),
        },
      });

      // Prune: keep only the MAX_VERSIONS newest
      const allVersions = await tx.whiteboard_versions.findMany({
        where: { whiteboardId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (allVersions.length > MAX_VERSIONS) {
        const toDelete = allVersions.slice(0, allVersions.length - MAX_VERSIONS);
        await tx.whiteboard_versions.deleteMany({
          where: { id: { in: toDelete.map((v) => v.id) } },
        });
      }

      return created;
    });

    return NextResponse.json({ success: true, data: newVersion }, { status: 201 });
  } catch (error) {
    console.error("Error creating whiteboard version:", error);
    return NextResponse.json({ error: "Failed to create version" }, { status: 500 });
  }
}
