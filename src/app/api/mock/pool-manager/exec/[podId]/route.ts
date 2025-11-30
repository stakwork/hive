import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager command execution endpoint
 * POST /api/mock/pool-manager/exec/[podId]
 */

interface RouteContext {
  params: Promise<{
    podId: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { podId } = await context.params;
    const body = await request.json();
    const { command, poolName = "default-pool" } = body;

    if (!command) {
      return NextResponse.json(
        { error: "Command required" },
        { status: 400 }
      );
    }

    const result = mockPoolState.executeCommand(poolName, podId, command);

    return NextResponse.json({
      success: result.success,
      output: result.output,
      exitCode: result.exitCode,
      podId,
      command,
    });
  } catch (error) {
    console.error("Mock Pool Manager exec error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
