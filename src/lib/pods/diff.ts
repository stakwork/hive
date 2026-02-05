/**
 * Shared diff generation logic for agent workflows
 *
 * Extracts diff fetching and ChatMessage creation from the /api/agent/diff route
 * to be reused by the webhook finish event handler.
 */

import { db } from "@/lib/db";
import { getPodDetails, POD_PORTS, buildPodUrl } from "@/lib/pods";
import { EncryptionService } from "@/lib/encryption";
import { ActionResult } from "@/lib/chat";
import { ChatRole, ChatStatus } from "@prisma/client";
import type { ChatMessage, Artifact } from "@prisma/client";

export interface GenerateDiffResult {
  success: boolean;
  message?: ChatMessage & { artifacts: Artifact[] };
  noDiffs?: boolean;
  error?: string;
}

export interface GenerateDiffOptions {
  taskId: string;
  podId: string;
}

/**
 * Fetches diff from a pod's control port and creates a ChatMessage with DIFF artifact.
 *
 * @param options - The options for generating the diff
 * @returns The created ChatMessage with DIFF artifact, or null if no diffs
 */
export async function generateAndSaveDiff(options: GenerateDiffOptions): Promise<GenerateDiffResult> {
  const { taskId, podId } = options;

  console.log(`[generateAndSaveDiff] Starting for task ${taskId}, pod ${podId}`);

  try {
    // Fetch pod details to get port mappings and password
    const podDetails = await getPodDetails(podId);

    if (!podDetails) {
      console.error(`[generateAndSaveDiff] Pod not found: ${podId}`);
      return {
        success: false,
        error: `Pod not found: ${podId}`,
      };
    }

    const controlPort = parseInt(POD_PORTS.CONTROL, 10);
    const hasControlPort = podDetails.portMappings?.includes(controlPort) ?? false;

    console.log(`[generateAndSaveDiff] Pod details retrieved:`, {
      id: podId,
      hasControlPort,
    });

    if (!hasControlPort) {
      console.error(`[generateAndSaveDiff] Control port (${POD_PORTS.CONTROL}) not found`);
      return {
        success: false,
        error: `Control port (${POD_PORTS.CONTROL}) not found in port mappings`,
      };
    }

    const controlPortUrl = buildPodUrl(podDetails.podId, POD_PORTS.CONTROL);

    // Decrypt password
    const password = podDetails.password;

    // GET /diff from the control port
    const diffUrl = `${controlPortUrl}/diff`;
    console.log(`[generateAndSaveDiff] Fetching diff from: ${diffUrl}`);

    const diffResponse = await fetch(diffUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${password}`,
      },
    });

    if (!diffResponse.ok) {
      const errorText = await diffResponse.text();
      console.error(`[generateAndSaveDiff] Failed to fetch diff: ${diffResponse.status} - ${errorText}`);
      return {
        success: false,
        error: `Failed to fetch diff: ${diffResponse.status}`,
      };
    }

    const diffs: ActionResult[] = await diffResponse.json();
    console.log(`[generateAndSaveDiff] Diff fetched successfully, count: ${diffs.length}`);

    // If there are no diffs, don't create an artifact
    if (!diffs || diffs.length === 0) {
      console.log(`[generateAndSaveDiff] No diffs to display, skipping artifact creation`);
      return {
        success: true,
        noDiffs: true,
      };
    }

    console.log(`[generateAndSaveDiff] Creating chat message with DIFF artifact`);

    // Create a chat message with the DIFF artifact
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message: "Changes have been applied",
        role: ChatRole.ASSISTANT,
        contextTags: JSON.stringify([]),
        status: ChatStatus.SENT,
        artifacts: {
          create: [
            {
              type: "DIFF",
              content: { diffs } as any,
            },
          ],
        },
      },
      include: {
        artifacts: true,
      },
    });

    console.log(`[generateAndSaveDiff] Chat message with DIFF artifact created: ${chatMessage.id}`);

    return {
      success: true,
      message: chatMessage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[generateAndSaveDiff] Error:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
