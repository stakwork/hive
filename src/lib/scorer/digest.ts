/**
 * Layer 3: Session Digest Generation
 *
 * Compresses a full session (Layer 2) into a ~50-100 line summary
 * using an LLM call. Cached in ScorerDigest table.
 */

import { generateText } from "ai";
import { db } from "@/lib/db";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { assembleFullSession, sessionToText } from "./session";
import { DIGEST_COMPRESSION_PROMPT } from "./prompts";

/**
 * Generate (or regenerate) a digest for a feature.
 * Returns the digest content string.
 */
export async function generateDigest(featureId: string): Promise<string> {
  const session = await assembleFullSession(featureId);
  const sessionText = sessionToText(session);

  const prompt = DIGEST_COMPRESSION_PROMPT.replace("{session}", sessionText);

  const apiKey = getApiKeyForProvider("anthropic");
  const model = getModel("anthropic", apiKey, undefined, "sonnet");

  const result = await generateText({
    model,
    prompt,
    temperature: 0.2,
  });

  const digestContent = result.text.trim();

  // Upsert into DB
  await db.scorerDigest.upsert({
    where: { featureId },
    create: {
      featureId,
      workspaceId: session.workspaceName
        ? (
            await db.feature.findUniqueOrThrow({
              where: { id: featureId },
              select: { workspaceId: true },
            })
          ).workspaceId
        : "",
      content: digestContent,
      metadata: {
        taskCount: session.execution.flatMap((p) => p.tasks).length,
        totalMessages: session.metrics.totalMessages,
        totalCorrections: session.metrics.totalCorrections,
        planPrecision: session.metrics.planPrecision,
        planRecall: session.metrics.planRecall,
      },
    },
    update: {
      content: digestContent,
      metadata: {
        taskCount: session.execution.flatMap((p) => p.tasks).length,
        totalMessages: session.metrics.totalMessages,
        totalCorrections: session.metrics.totalCorrections,
        planPrecision: session.metrics.planPrecision,
        planRecall: session.metrics.planRecall,
      },
    },
  });

  return digestContent;
}

/**
 * Get an existing digest from the cache, or null if not generated yet.
 */
export async function getDigest(
  featureId: string
): Promise<{ content: string; metadata: unknown; updatedAt: Date } | null> {
  return db.scorerDigest.findUnique({
    where: { featureId },
    select: { content: true, metadata: true, updatedAt: true },
  });
}
