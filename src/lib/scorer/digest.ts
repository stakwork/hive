/**
 * Layer 3: Session Digest Generation
 *
 * Compresses a full session (Layer 2) into a ~50-100 line summary
 * using an LLM call. Stored in ScorerDigest.content.
 *
 * The same ScorerDigest row also holds cached metrics in its metadata
 * field (written by computeAndCacheMetrics). This module only touches
 * the `content` field so it doesn't clobber cached metrics.
 */

import { generateText } from "ai";
import { db } from "@/lib/db";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { assembleFullSession, sessionToText } from "./session";
import { DIGEST_COMPRESSION_PROMPT } from "./prompts";

/**
 * Generate (or regenerate) a digest for a feature.
 * Only writes the `content` field — preserves existing metadata.
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

  const feature = await db.feature.findUniqueOrThrow({
    where: { id: featureId },
    select: { workspaceId: true },
  });

  // Upsert: only set content. On create, metadata starts null
  // (will be filled by computeAndCacheMetrics separately).
  await db.scorerDigest.upsert({
    where: { featureId },
    create: {
      featureId,
      workspaceId: feature.workspaceId,
      content: digestContent,
    },
    update: {
      content: digestContent,
    },
  });

  return digestContent;
}

/**
 * Get an existing digest from the cache, or null if not generated yet.
 */
export async function getDigest(
  featureId: string
): Promise<{ content: string | null; metadata: unknown; updatedAt: Date } | null> {
  return db.scorerDigest.findUnique({
    where: { featureId },
    select: { content: true, metadata: true, updatedAt: true },
  });
}
