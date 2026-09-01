import crypto from "crypto";
import { db } from "@/lib/db";
import { claimPodAndGetFrontend, POD_PORTS } from "@/lib/pods";
import { updatePodRepositories } from "@/lib/pods/utils";
import { EncryptionService } from "@/lib/encryption";
import { getBifrostForLLM } from "@/services/bifrost";
import { deriveCriteria } from "./derive";
import type { StartVerificationResult, VerifyHints, VerifyModel, VerifyRequest } from "./types";

const encryptionService = EncryptionService.getInstance();

const DEFAULT_LOGIN_HINT =
  "Open the app; if a login screen appears use the dev/mock login (any username) to get in.";

export async function startVerification(featureId: string, userId: string): Promise<StartVerificationResult> {
  const feature = await db.feature.findUnique({
    where: { id: featureId, deleted: false },
    include: {
      userStories: { orderBy: { order: "asc" }, select: { title: true } },
      workspace: {
        include: {
          repositories: true,
          swarm: true,
        },
      },
    },
  });

  if (!feature) {
    throw new Error("Feature not found");
  }

  const repository = feature.workspace.repositories[0];
  if (!repository) {
    throw new Error("No repository configured for workspace");
  }

  const customStakLinkUrl = process.env.CUSTOM_STAKLINK_URL;
  let controlUrl: string;
  let podPassword = "";
  let frontendUrl: string | null = null;
  let podStatus: "claimed" | "local";

  if (customStakLinkUrl) {
    controlUrl = customStakLinkUrl;
    frontendUrl = customStakLinkUrl;
    podStatus = "local";
  } else {
    if (!feature.workspace.swarm) {
      throw new Error("No swarm found for this workspace");
    }
    if (!feature.workspace.swarm.id || !feature.workspace.swarm.poolApiKey) {
      throw new Error("Swarm not properly configured with pool information");
    }

    const poolId = feature.workspace.swarm.id || feature.workspace.swarm.poolName;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", feature.workspace.swarm.poolApiKey);

    const services = feature.workspace.swarm.services as
      | Array<{ name: string; port: number; scripts?: Record<string, string> }>
      | null
      | undefined;

    const podResult = await claimPodAndGetFrontend(poolId as string, poolApiKeyPlain, services || undefined);

    controlUrl = podResult.workspace.portMappings[POD_PORTS.CONTROL];
    podPassword = podResult.workspace.password;
    frontendUrl = podResult.frontend;
    podStatus = "claimed";

    if (!controlUrl) {
      throw new Error("Control port not available on claimed pod");
    }

    const repositories = feature.workspace.repositories.map((r) => ({ url: r.repositoryUrl }));
    try {
      await updatePodRepositories(controlUrl, podPassword, repositories);
    } catch (error) {
      console.error("[attestor] Failed to update pod repositories (non-fatal):", error);
    }
  }

  const criteria = await deriveCriteria({
    title: feature.title,
    brief: feature.brief,
    requirements: feature.requirements,
    architecture: feature.architecture,
    personas: feature.personas,
    userStories: feature.userStories,
    workspaceSlug: feature.workspace.slug,
  });

  const hints: VerifyHints = {
    login: DEFAULT_LOGIN_HINT,
    startPath: "/",
  };

  const callbackApiKey = crypto.randomBytes(32).toString("hex");
  const encryptedApiKey = encryptionService.encryptField("agentPassword", callbackApiKey);

  await db.feature.update({
    where: { id: featureId },
    data: { verifyCallbackKey: JSON.stringify(encryptedApiKey) },
  });

  let bifrost: Awaited<ReturnType<typeof getBifrostForLLM>> = undefined;
  try {
    bifrost = await getBifrostForLLM(
      {
        workspaceId: feature.workspaceId,
        workspaceSlug: feature.workspace.slug,
        userId,
      },
      { agentName: "browser-agent" },
    );
  } catch (error) {
    console.error("[attestor] Failed to resolve Bifrost credentials (non-fatal):", error);
  }

  const model: VerifyModel = {
    apiKey: bifrost?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
    provider: "anthropic",
    model: "claude-3-7-sonnet-latest",
    ...(bifrost?.baseUrl ? { host: bifrost.baseUrl } : {}),
  };

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const responseUrl = `${baseUrl}/api/features/${featureId}/verify/callback`;

  const verifyPayload: VerifyRequest = {
    featureId,
    frontendUrl: frontendUrl ?? "",
    criteria,
    hints,
    model,
    responseUrl,
    callbackApiKey,
  };

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (podPassword) {
      headers.Authorization = `Bearer ${podPassword}`;
    }

    const verifyResponse = await fetch(`${controlUrl}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      throw new Error(`Pod returned ${verifyResponse.status}: ${errorText}`);
    }
  } catch (error) {
    try {
      await db.feature.update({
        where: { id: featureId },
        data: { workflowStatus: "ERROR", verifyCallbackKey: null },
      });
    } catch (dbError) {
      console.error("[attestor] Failed to update feature status to ERROR:", dbError);
    }
    throw error;
  }

  await db.feature.update({
    where: { id: featureId },
    data: { workflowStatus: "IN_PROGRESS", workflowStartedAt: new Date() },
  });

  return {
    featureId,
    status: "running",
    criteriaCount: criteria.length,
    frontendUrl,
    podStatus,
  };
}
