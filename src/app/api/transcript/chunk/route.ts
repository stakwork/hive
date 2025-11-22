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

async function triggerFeatureExtraction(
  accumulatedTranscript: string,
  workspaceSlug: string
) {
  try {
    // Validate feature extraction workflow ID is configured
    if (!config.STAKWORK_FEATURE_WORKFLOW_ID) {
      console.warn("STAKWORK_FEATURE_WORKFLOW_ID not configured, skipping feature extraction");
      return { success: false, error: "Feature extraction not configured" };
    }

    // Build workflow payload with accumulated transcript context
    const vars = {
      transcript: accumulatedTranscript,
      workspaceSlug,
      timestamp: new Date().toISOString(),
    };

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_feature_extraction",
      workflow_id: parseInt(config.STAKWORK_FEATURE_WORKFLOW_ID),
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
      console.error(`Failed to trigger feature extraction: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: true, data: result.data };
  } catch (error) {
    console.error("Error triggering feature extraction:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chunk, wordCount, workspaceSlug, containsKeyword, accumulatedTranscript } = body;

    console.log("=== Transcript Chunk Received ===");
    console.log(`Workspace: ${workspaceSlug}`);
    console.log(`Word Count: ${wordCount}`);
    console.log(`Chunk: ${chunk}`);
    console.log(`Contains Keyword: ${containsKeyword || false}`);
    console.log("================================\n");

    const result = await sendChunkToStakwork(chunk);
    if (!result.success) {
      console.error("Failed to send chunk to Stakwork:", result.error);
      return NextResponse.json({ error: "Failed to send chunk to Stakwork" }, { status: 500 });
    }

    // Trigger feature extraction workflow if keyword detected
    let featureCreationTriggered = false;
    if (containsKeyword && accumulatedTranscript) {
      try {
        const featureExtractionResult = await triggerFeatureExtraction(
          accumulatedTranscript,
          workspaceSlug
        );
        featureCreationTriggered = featureExtractionResult.success;
        
        if (featureCreationTriggered) {
          console.log("✅ Feature extraction workflow triggered successfully");
        }
      } catch (error) {
        console.error("Error triggering feature extraction:", error);
        // Don't fail the entire request if feature extraction fails
      }
    }

    return NextResponse.json({
      success: true,
      received: wordCount,
      featureCreationTriggered,
    });
  } catch (error) {
    console.error("Error processing transcript chunk:", error);
    return NextResponse.json({ error: "Failed to process chunk" }, { status: 500 });
  }
}
