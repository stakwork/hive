/**
 * Scenario API Endpoints
 *
 * GET /api/mock/db/scenario - List available scenarios
 * POST /api/mock/db/scenario - Run a scenario to seed the database
 *
 * These endpoints are only available when USE_MOCKS=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import {
  listScenariosForAPI,
  runScenarioForAPI,
  getScenario,
} from "@/__tests__/support/scenarios";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Environment guard - only allow when USE_MOCKS=true
 */
function isMockEnabled(): boolean {
  return config.USE_MOCKS || process.env.ALLOW_SCENARIO_API === "true";
}

/**
 * GET /api/mock/db/scenario
 *
 * Lists all available scenarios with their metadata.
 *
 * Query params:
 *   - tag: Filter by tag (optional)
 *
 * Response:
 *   {
 *     schemaVersion: string,
 *     scenarios: [{ name, description, extends?, tags? }]
 *   }
 */
export async function GET(request: NextRequest) {
  if (!isMockEnabled()) {
    return NextResponse.json(
      { error: "Scenario API only available when USE_MOCKS=true" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const tagFilter = searchParams.get("tag");

    const response = await listScenariosForAPI();

    // Filter by tag if provided
    if (tagFilter) {
      response.scenarios = response.scenarios.filter((s) =>
        s.tags?.includes(tagFilter)
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Scenario API] Error listing scenarios:", error);
    return NextResponse.json(
      {
        error: "Failed to list scenarios",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mock/db/scenario
 *
 * Runs a scenario to seed the database with test data.
 *
 * Body:
 *   { name: string }
 *
 * Response:
 *   {
 *     success: boolean,
 *     scenario: { name, description, schemaVersion, ... },
 *     data: { workspaceId, workspaceSlug, ownerId, ownerEmail, ... }
 *   }
 */
export async function POST(request: NextRequest) {
  if (!isMockEnabled()) {
    return NextResponse.json(
      { error: "Scenario API only available when USE_MOCKS=true" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Scenario name is required. Body: { name: string }" },
        { status: 400 }
      );
    }

    // Validate scenario exists before running
    const scenario = getScenario(name);
    if (!scenario) {
      const response = await listScenariosForAPI();
      const available = response.scenarios.map((s) => s.name).join(", ");
      return NextResponse.json(
        {
          error: `Unknown scenario: "${name}"`,
          available,
        },
        { status: 404 }
      );
    }

    const result = await runScenarioForAPI(name);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Scenario API] Error running scenario:", error);
    return NextResponse.json(
      {
        error: "Failed to run scenario",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
