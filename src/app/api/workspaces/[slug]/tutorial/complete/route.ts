import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = params;

    // Find the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      include: {
        members: {
          where: {
            user: {
              email: session.user.email,
            },
          },
        },
      },
    });

    if (!workspace || workspace.members.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Update the workspace to mark tutorial as completed
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        tutorialCompleted: true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error completing tutorial:", error);
    return NextResponse.json(
      { error: "Failed to complete tutorial" },
      { status: 500 }
    );
  }
}
