import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  getTaskAgentStats,
  getFeatureAgentStats,
  cacheFeatureAgentStats,
  extractAgentType,
  type AgentLogStatsJson,
} from "@/lib/scorer/agent-stats";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const featureId = searchParams.get("featureId");

    if (!taskId && !featureId) {
      return NextResponse.json(
        { error: "taskId or featureId is required" },
        { status: 400 }
      );
    }

    let logs;
    if (featureId) {
      // Trigger caching for any uncached logs in this feature
      await cacheFeatureAgentStats(featureId);
      logs = await getFeatureAgentStats(featureId);
    } else {
      logs = await getTaskAgentStats(taskId!);
    }

    const result = logs.map((log) => ({
      id: log.id,
      agent: log.agent,
      agentType: extractAgentType(log.agent),
      taskId: log.taskId,
      featureId: log.featureId,
      createdAt: log.createdAt,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      stats: log.stats as AgentLogStatsJson | null,
    }));

    return NextResponse.json({ logs: result });
  } catch (error) {
    console.error("Error fetching agent stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent stats" },
      { status: 500 }
    );
  }
}
