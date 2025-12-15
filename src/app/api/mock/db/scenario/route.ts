/**
 * Mock DB Scenario API Endpoint
 * 
 * Provides scenario listing and execution capabilities in mock mode only.
 * Safety: All operations guarded by USE_MOCKS flag - returns 403 in production.
 */

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import {
  scenarioRegistry,
  SCHEMA_VERSION,
  ScenarioNotFoundError,
} from "@/__tests__/support/scenarios";

/**
 * GET /api/mock/db/scenario
 * 
 * List all available scenarios with metadata.
 * Only accessible when USE_MOCKS=true.
 */
export async function GET() {
  // Safety guard - only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      {
        error: "Mock endpoints only available when USE_MOCKS=true",
        message: "This endpoint is only available in development/test environments with mock mode enabled",
      },
      { status: 403 }
    );
  }

  try {
    const scenarios = scenarioRegistry.list();

    return NextResponse.json({
      scenarios: scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        metadata: s.metadata,
      })),
      schemaVersion: SCHEMA_VERSION,
      mockMode: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to list scenarios",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mock/db/scenario
 * 
 * Execute a scenario by name.
 * Only accessible when USE_MOCKS=true.
 * 
 * Request body: { scenarioName: string }
 */
export async function POST(request: NextRequest) {
  // Safety guard - only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      {
        error: "Mock endpoints only available when USE_MOCKS=true",
        message: "This endpoint is only available in development/test environments with mock mode enabled",
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { scenarioName } = body;

    if (!scenarioName || typeof scenarioName !== "string") {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "scenarioName is required and must be a string",
        },
        { status: 400 }
      );
    }

    // Execute scenario
    const result = await scenarioRegistry.execute(scenarioName);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Scenario execution failed",
          message: result.message,
          details: result.error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      result,
      schemaVersion: SCHEMA_VERSION,
      mockMode: true,
    });
  } catch (error) {
    if (error instanceof ScenarioNotFoundError) {
      return NextResponse.json(
        {
          error: "Scenario not found",
          message: error.message,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to execute scenario",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
