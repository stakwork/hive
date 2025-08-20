import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { z } from "zod";

const acceptRecommendationSchema = z.object({
  assigneeId: z.string().optional(),
  repositoryId: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = acceptRecommendationSchema.parse(body);

    const recommendation = await db.janitorRecommendation.findUnique({
      where: { id },
      include: {
        janitorRun: {
          include: {
            janitorConfig: {
              include: {
                workspace: {
                  include: {
                    members: {
                      where: { userId },
                      select: { role: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!recommendation) {
      return NextResponse.json(
        { error: "Recommendation not found" },
        { status: 404 }
      );
    }

    const userMembership = recommendation.janitorRun.janitorConfig.workspace.members[0];
    if (!userMembership || !["OWNER", "ADMIN", "PM", "DEVELOPER"].includes(userMembership.role)) {
      return NextResponse.json(
        { error: "Insufficient permissions to accept recommendations" },
        { status: 403 }
      );
    }

    if (recommendation.status !== "PENDING") {
      return NextResponse.json(
        { error: "Recommendation has already been processed" },
        { status: 400 }
      );
    }

    if (validatedData.assigneeId) {
      const assigneeExists = await db.workspaceMember.findFirst({
        where: {
          userId: validatedData.assigneeId,
          workspaceId: recommendation.janitorRun.janitorConfig.workspace.id
        }
      });

      if (!assigneeExists) {
        return NextResponse.json(
          { error: "Assignee is not a member of this workspace" },
          { status: 400 }
        );
      }
    }

    if (validatedData.repositoryId) {
      const repositoryExists = await db.repository.findFirst({
        where: {
          id: validatedData.repositoryId,
          workspaceId: recommendation.janitorRun.janitorConfig.workspace.id
        }
      });

      if (!repositoryExists) {
        return NextResponse.json(
          { error: "Repository not found in this workspace" },
          { status: 400 }
        );
      }
    }

    const [updatedRecommendation, task] = await db.$transaction(async (tx) => {
      const updatedRec = await tx.janitorRecommendation.update({
        where: { id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedById: userId,
        }
      });

      const newTask = await tx.task.create({
        data: {
          title: recommendation.title,
          description: recommendation.description,
          workspaceId: recommendation.janitorRun.janitorConfig.workspace.id,
          assigneeId: validatedData.assigneeId,
          repositoryId: validatedData.repositoryId,
          priority: recommendation.priority,
          sourceType: "JANITOR",
          createdById: userId,
          updatedById: userId,
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          },
          repository: {
            select: {
              id: true,
              name: true,
              repositoryUrl: true,
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      return [updatedRec, newTask];
    });

    return NextResponse.json({
      success: true,
      task,
      recommendation: {
        id: updatedRecommendation.id,
        status: updatedRecommendation.status,
        acceptedAt: updatedRecommendation.acceptedAt,
      }
    });
  } catch (error) {
    console.error("Error accepting recommendation:", error);
    
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}