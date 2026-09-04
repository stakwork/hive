import crypto from "node:crypto";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { claimPodAndGetFrontend, updatePodRepositories, POD_PORTS } from "@/lib/pods";
import { WorkflowStatus } from "@prisma/client";
import { buildDeck } from "./deck";
import { getDefaultModel, getApiKeyForModel } from "@/lib/ai/models";
import type { AuditModel, AuditJobBody, StartAuditResult } from "./types";

const encryptionService = EncryptionService.getInstance();

async function buildModel(): Promise<AuditModel> {
  const registryModel = process.env.AUDIT_MODEL || (await getDefaultModel("task"));
  if (registryModel) {
    const apiKey = getApiKeyForModel(registryModel);
    if (apiKey) {
      const provider = registryModel.includes("/") ? registryModel.split("/")[0] : undefined;
      return { apiKey, provider, model: registryModel };
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      provider: "anthropic",
      model: "anthropic/claude-opus-5",
    };
  }

  return {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    provider: "openrouter",
    model: "openrouter/anthropic/claude-opus-4.8",
  };
}

export async function startAudit(taskId: string, userId: string): Promise<StartAuditResult> {
  const task = await db.task.findUnique({
    where: { id: taskId, deleted: false },
    include: {
      workspace: {
        include: {
          repositories: true,
          swarm: true,
        },
      },
    },
  });

  if (!task) {
    return { success: false, taskId, error: "Task not found" };
  }

  const customStakLinkUrl = process.env.CUSTOM_STAKLINK_URL;

  let controlUrl: string;
  let podPassword = "";
  let podId: string | undefined;
  let frontendUrl: string | undefined;

  if (customStakLinkUrl) {
    controlUrl = customStakLinkUrl;
  } else {
    const swarm = task.workspace.swarm;
    if (!swarm?.id || !swarm.poolApiKey) {
      return { success: false, taskId, error: "Swarm not configured for pods" };
    }

    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", swarm.poolApiKey);
    const services = swarm.services as Array<{ name: string; port: number }> | null | undefined;

    const podResult = await claimPodAndGetFrontend(swarm.id, poolApiKeyPlain, services || undefined);

    controlUrl = podResult.workspace.portMappings[POD_PORTS.CONTROL];
    podPassword = podResult.workspace.password;
    podId = podResult.workspace.id;
    frontendUrl = podResult.frontend;

    if (!controlUrl) {
      return { success: false, taskId, error: "Control port not available on claimed pod" };
    }

    const repositories = task.workspace.repositories.map((r) => ({ url: r.repositoryUrl }));
    if (repositories.length > 0) {
      try {
        await updatePodRepositories(controlUrl, podPassword, repositories);
      } catch (error) {
        console.error("[auditor:trigger] Failed to update pod repositories (non-fatal):", error);
      }
    }
  }

  const deck = await buildDeck(taskId, {
    controlUrl,
    password: podPassword,
    appUrl: frontendUrl,
  });

  const model = await buildModel();

  const callbackApiKey = crypto.randomBytes(32).toString("hex");
  const encryptedCallbackKey = encryptionService.encryptField("auditCallbackKey", callbackApiKey);

  await db.task.update({
    where: { id: taskId },
    data: {
      auditCallbackKey: JSON.stringify(encryptedCallbackKey),
      ...(podId ? { podId } : {}),
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const responseUrl = `${baseUrl}/api/tasks/${taskId}/audit/callback`;

  const body: AuditJobBody = {
    taskId,
    deck,
    model,
    responseUrl,
    callbackApiKey,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (podPassword) headers.Authorization = `Bearer ${podPassword}`;

  try {
    const response = await fetch(`${controlUrl}/audit`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pod returned ${response.status}: ${errorText}`);
    }
  } catch (error) {
    console.error("[auditor:trigger] Failed to dispatch audit:", error);
    await db.task.update({
      where: { id: taskId },
      data: { auditCallbackKey: null },
    });
    return {
      success: false,
      taskId,
      error: error instanceof Error ? error.message : "Failed to dispatch audit",
    };
  }

  await db.task.update({
    where: { id: taskId },
    data: { workflowStatus: WorkflowStatus.IN_PROGRESS, workflowStartedAt: new Date() },
  });

  console.log(`[auditor:trigger] Audit dispatched for task ${taskId} by user ${userId}`);

  return { success: true, taskId, podId, appUrl: deck.map.appUrl };
}
