import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { SearchResponse, SearchResult } from "@/types/search";

const RESULTS_PER_TYPE = 5;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ error: "Search query must be at least 2 characters" }, { status: 400 });
    }

    const searchQuery = query.trim();

    // Verify workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: {
            userId: userOrResponse.id,
            leftAt: null,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (workspace.ownerId !== userOrResponse.id && workspace.members.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Search across all entity types in parallel
    const [tasks, features, phases] = await Promise.all([
      // Search Tasks (both standalone and roadmap tasks)
      db.task.findMany({
        where: {
          workspaceId: workspace.id,
          deleted: false,
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          featureId: true,
          stakworkProjectId: true,
          createdAt: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          feature: {
            select: {
              title: true,
            },
          },
        },
        take: RESULTS_PER_TYPE,
        orderBy: {
          updatedAt: "desc",
        },
      }),

      // Search Features
      db.feature.findMany({
        where: {
          workspaceId: workspace.id,
          deleted: false,
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { brief: { contains: searchQuery, mode: "insensitive" } },
            { requirements: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          brief: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
        take: RESULTS_PER_TYPE,
        orderBy: {
          updatedAt: "desc",
        },
      }),

      // Search Phases
      db.phase.findMany({
        where: {
          deleted: false,
          feature: {
            workspaceId: workspace.id,
            deleted: false,
          },
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          feature: {
            select: {
              title: true,
            },
          },
        },
        take: RESULTS_PER_TYPE,
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    // Transform results into unified format
    const taskResults: SearchResult[] = tasks.map((task) => {
      // Determine the correct URL based on task type and status
      let url: string;
      if (task.featureId) {
        // Roadmap task
        if (task.status === "TODO" && !task.stakworkProjectId) {
          // Not being worked on yet - use legacy ticket page
          url = `/w/${slug}/tickets/${task.id}`;
        } else {
          // In progress, done, or has stakwork project - use task detail page
          url = `/w/${slug}/task/${task.id}`;
        }
      } else {
        // Standalone task - use task detail page
        url = `/w/${slug}/task/${task.id}`;
      }

      return {
        id: task.id,
        type: "task" as const,
        title: task.title,
        description: task.description,
        url,
        metadata: {
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          featureTitle: task.feature?.title,
          stakworkProjectId: task.stakworkProjectId,
          createdAt: task.createdAt.toISOString(),
          updatedAt: task.updatedAt.toISOString(),
        },
      };
    });

    const featureResults: SearchResult[] = features.map((feature) => ({
      id: feature.id,
      type: "feature" as const,
      title: feature.title,
      description: feature.brief,
      url: `/w/${slug}/roadmap/${feature.id}`,
      metadata: {
        status: feature.status,
        priority: feature.priority,
        assignee: feature.assignee,
        createdAt: feature.createdAt.toISOString(),
        updatedAt: feature.updatedAt.toISOString(),
      },
    }));

    const phaseResults: SearchResult[] = phases.map((phase) => ({
      id: phase.id,
      type: "phase" as const,
      title: phase.name,
      description: phase.description,
      url: `/w/${slug}/phases/${phase.id}`,
      metadata: {
        status: phase.status,
        featureTitle: phase.feature.title,
        createdAt: phase.createdAt.toISOString(),
        updatedAt: phase.updatedAt.toISOString(),
      },
    }));

    const total = taskResults.length + featureResults.length + phaseResults.length;

    const response: SearchResponse = {
      success: true,
      data: {
        tasks: taskResults,
        features: featureResults,
        phases: phaseResults,
        total,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error performing search:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
