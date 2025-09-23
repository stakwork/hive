import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { stakworkService } from "@/lib/service-factory";
import { config as envConfig } from "@/lib/env";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing required field: workspaceId" },
        { status: 400 }
      );
    }

    // Check if workflow ID is configured
    if (!envConfig.STAKWORK_TESTING_FRAMEWORK_WORKFLOW_ID) {
      console.warn("STAKWORK_TESTING_FRAMEWORK_WORKFLOW_ID not configured, skipping analysis");
      return NextResponse.json(
        { message: "Testing framework analysis not configured" },
        { status: 200 }
      );
    }

    // Get the repository and swarm data
    const repository = await db.repository.findFirst({
      where: {
        workspaceId
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!repository) {
      return NextResponse.json(
        { error: "No repository found for workspace" },
        { status: 404 }
      );
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId }
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "No swarm found for workspace" },
        { status: 404 }
      );
    }

    // Prepare the workflow payload
    const workflowId = envConfig.STAKWORK_TESTING_FRAMEWORK_WORKFLOW_ID;

    const vars = {
      repositoryUrl: repository.repositoryUrl,
      swarmUrl: swarm.swarmUrl || "",
      swarmSecretAlias: swarm.swarmSecretAlias || "",
    };

    const stakworkPayload = {
      name: `testing-framework-analysis-${Date.now()}`,
      workflow_id: parseInt(workflowId),
      workflow_params: {
        set_var: {
          attributes: {
            vars
          }
        }
      }
    };

    // Call Stakwork API to trigger the workflow
    const stakworkProject = await stakworkService().stakworkRequest(
      "/projects",
      stakworkPayload
    );

    console.log("Testing framework analysis triggered:", stakworkProject);

    return NextResponse.json(
      {
        success: true,
        message: "Testing framework analysis triggered successfully",
        data: stakworkProject
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error triggering testing framework analysis:", error);

    // Don't fail the onboarding if this fails
    return NextResponse.json(
      {
        success: false,
        error: "Failed to trigger testing framework analysis",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}