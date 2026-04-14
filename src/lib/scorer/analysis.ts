/**
 * Layer 4: Analysis Engine
 *
 * LLM-powered analysis that produces ScorerInsight records.
 * Two modes: single-session and pattern detection.
 */

import { generateText } from "ai";
import { db } from "@/lib/db";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { assembleFullSession, sessionToText } from "./session";
import { resolvePrompt } from "./prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawInsight {
  severity: string;
  pattern: string;
  description: string;
  featureIds: string[];
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Single-session analysis (Mode A)
// ---------------------------------------------------------------------------

export async function analyzeSingleSession(
  featureId: string,
  workspaceId: string
): Promise<{ insightCount: number; error?: string }> {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { scorerSinglePrompt: true },
  });

  const session = await assembleFullSession(featureId);
  const sessionText = sessionToText(session);

  const promptTemplate = resolvePrompt("single", workspace.scorerSinglePrompt);
  const prompt = promptTemplate.replace("{session}", sessionText);

  const apiKey = getApiKeyForProvider("anthropic");
  const model = getModel("anthropic", apiKey, undefined, "sonnet");

  const result = await generateText({
    model,
    prompt,
    temperature: 0.3,
  });

  const rawText = result.text.trim();

  return saveInsights(rawText, {
    workspaceId,
    mode: "single",
    promptSnapshot: promptTemplate,
    featureIds: [featureId],
    digestIds: [],
  });
}

// ---------------------------------------------------------------------------
// Pattern detection (Mode B)
// ---------------------------------------------------------------------------

export async function analyzePatterns(
  workspaceId: string,
  digestIds?: string[]
): Promise<{ insightCount: number; error?: string }> {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { scorerPatternPrompt: true },
  });

  // Get digests to analyze
  const whereClause = digestIds
    ? { id: { in: digestIds } }
    : { workspaceId };

  const digests = await db.scorerDigest.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, featureId: true, content: true },
  });

  if (digests.length === 0) {
    return { insightCount: 0, error: "No digests found" };
  }

  const digestsText = digests
    .map(
      (d, i) =>
        `--- Session ${i + 1} (feature: ${d.featureId}) ---\n${d.content}`
    )
    .join("\n\n");

  const promptTemplate = resolvePrompt(
    "pattern",
    workspace.scorerPatternPrompt
  );
  const prompt = promptTemplate
    .replace("{N}", String(digests.length))
    .replace("{digests}", digestsText);

  const apiKey = getApiKeyForProvider("anthropic");
  const model = getModel("anthropic", apiKey, undefined, "sonnet");

  const result = await generateText({
    model,
    prompt,
    temperature: 0.3,
  });

  const rawText = result.text.trim();

  return saveInsights(rawText, {
    workspaceId,
    mode: "pattern",
    promptSnapshot: promptTemplate,
    featureIds: digests.map((d) => d.featureId),
    digestIds: digests.map((d) => d.id),
  });
}

// ---------------------------------------------------------------------------
// Parse LLM output and save insights
// ---------------------------------------------------------------------------

interface InsightContext {
  workspaceId: string;
  mode: "single" | "pattern";
  promptSnapshot: string;
  featureIds: string[];
  digestIds: string[];
}

async function saveInsights(
  rawText: string,
  ctx: InsightContext
): Promise<{ insightCount: number; error?: string }> {
  let insights: RawInsight[];

  try {
    // Try to parse JSON — handle markdown fences if present
    let cleaned = rawText;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    insights = JSON.parse(cleaned);
    if (!Array.isArray(insights)) {
      throw new Error("Expected JSON array");
    }
  } catch {
    // Malformed JSON — store raw response as a failed insight
    await db.scorerInsight.create({
      data: {
        workspaceId: ctx.workspaceId,
        mode: ctx.mode,
        promptSnapshot: ctx.promptSnapshot,
        severity: "MEDIUM",
        pattern: "Analysis parse failure",
        description: `LLM returned non-JSON response:\n\n${rawText.slice(0, 2000)}`,
        featureIds: ctx.featureIds,
        suggestion: "Re-run analysis or check prompt formatting",
        digestIds: ctx.digestIds,
      },
    });
    return { insightCount: 0, error: "Failed to parse LLM output as JSON" };
  }

  // Validate and save each insight
  const validSeverities = new Set(["HIGH", "MEDIUM", "LOW"]);
  let savedCount = 0;

  for (const raw of insights) {
    const severity = validSeverities.has(raw.severity?.toUpperCase())
      ? raw.severity.toUpperCase()
      : "MEDIUM";

    await db.scorerInsight.create({
      data: {
        workspaceId: ctx.workspaceId,
        mode: ctx.mode,
        promptSnapshot: ctx.promptSnapshot,
        severity,
        pattern: raw.pattern || "Unnamed pattern",
        description: raw.description || "",
        featureIds: Array.isArray(raw.featureIds) ? raw.featureIds : ctx.featureIds,
        suggestion: raw.suggestion || "",
        digestIds: ctx.digestIds,
      },
    });
    savedCount++;
  }

  return { insightCount: savedCount };
}
