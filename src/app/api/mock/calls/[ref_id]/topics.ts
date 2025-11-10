import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

interface Topic {
  id: string;
  title: string;
  description: string;
  timestamp?: number;
  relevance_score?: number;
}

interface TopicsResponse {
  topics: Topic[];
  total: number;
}

/**
 * Mock endpoint for call summary topics
 * Returns a list of topics discussed in a specific call/episode
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref_id: string }> }) {
  try {
    const { ref_id } = await params;
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    if (!ref_id) {
      return NextResponse.json({ error: "Call ref_id is required" }, { status: 400 });
    }

    // Verify workspace exists
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Mock topics data for the call summary
    const mockTopics: Topic[] = [
      {
        id: "topic-1",
        title: "Project Architecture",
        description: "Discussion about the overall system architecture and design patterns being used in the project.",
        timestamp: 120,
        relevance_score: 0.95,
      },
      {
        id: "topic-2",
        title: "Database Schema",
        description: "Review of database schema changes and migration strategies for the upcoming release.",
        timestamp: 450,
        relevance_score: 0.88,
      },
      {
        id: "topic-3",
        title: "API Endpoints",
        description:
          "Planning and implementation details for new REST API endpoints and their authentication requirements.",
        timestamp: 780,
        relevance_score: 0.92,
      },
      {
        id: "topic-4",
        title: "Testing Strategy",
        description: "Discussion of unit testing, integration testing, and end-to-end testing approaches.",
        timestamp: 1100,
        relevance_score: 0.85,
      },
      {
        id: "topic-5",
        title: "Deployment Pipeline",
        description: "Review of CI/CD pipeline improvements and deployment automation strategies.",
        timestamp: 1450,
        relevance_score: 0.9,
      },
    ];

    const response: TopicsResponse = {
      topics: mockTopics,
      total: mockTopics.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching topics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
