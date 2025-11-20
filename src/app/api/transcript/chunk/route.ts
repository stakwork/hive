import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/env";
import { StakworkWorkflowPayload } from "@/types/stakwork";

async function sendChunkToStakwork(chunk: string) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_TRANSCRIPT_WORKFLOW_ID) {
      throw new Error("STAKWORK_TRANSCRIPT_WORKFLOW_ID is required for this Stakwork integration");
    }

    // stakwork workflow vars
    const vars = {
      chunk,
    };

    const workflowId = config.STAKWORK_TRANSCRIPT_WORKFLOW_ID || "";
    if (!workflowId) {
      throw new Error("STAKWORK_TRANSCRIPT_WORKFLOW_ID is required for this Stakwork integration");
    }

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_transcript",
      workflow_id: parseInt(workflowId),
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to send message to Stakwork: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chunk, wordCount, workspaceSlug } = body;

    console.log("=== Transcript Chunk Received ===");
    console.log(`Workspace: ${workspaceSlug}`);
    console.log(`Word Count: ${wordCount}`);
    console.log(`Chunk: ${chunk}`);
    console.log("================================\n");

    const result = await sendChunkToStakwork(chunk);
    if (!result.success) {
      console.error("Failed to send chunk to Stakwork:", result.error);
      return NextResponse.json({ error: "Failed to send chunk to Stakwork" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      received: wordCount,
    });
  } catch (error) {
    console.error("Error processing transcript chunk:", error);
    return NextResponse.json({ error: "Failed to process chunk" }, { status: 500 });
  }
}
