/**
 * Canvas Janitor — Scanning Service
 *
 * Scans authored canvas nodes (notes, decisions, research) for a given org,
 * cross-references them against live DB state via an LLM, and creates
 * CanvasReviewCard rows for stale/dangling items.
 */

import { generateText } from "ai";
import { db } from "@/lib/db";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { pusherServer, getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { JanitorTrigger, JanitorStatus, CanvasReviewReason } from "@prisma/client";
import type { CanvasBlob } from "@/lib/canvas/types";
import type { CanvasNode, CanvasEdge } from "system-canvas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LinkedEntity {
  type: "feature" | "initiative";
  name: string;
  status: string;
}

interface LlmItem {
  id: string;
  category: string;
  text: string;
  createdAt: string | null;
  linkedEntities: LinkedEntity[];
}

interface LlmResponseItem {
  id: string;
  flagged: boolean;
  reason: string | null;
  reasonCategory: CanvasReviewReason | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asBlob(raw: unknown): CanvasBlob {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { nodes: [], edges: [] };
  }
  const v = raw as Record<string, unknown>;
  return {
    nodes: Array.isArray(v.nodes) ? (v.nodes as CanvasNode[]) : [],
    edges: Array.isArray(v.edges) ? (v.edges as CanvasEdge[]) : [],
  };
}

/** Extract the text content from a node's customData or label fields. */
function nodeText(node: CanvasNode): string {
  const cd = node.customData as Record<string, unknown> | undefined;
  if (cd?.text && typeof cd.text === "string") return cd.text;
  if (cd?.content && typeof cd.content === "string") return cd.content;
  if (node.label && typeof node.label === "string") return node.label;
  return "";
}

/** Return true for authored category nodes we want to scan. */
function isAuthoredCategory(category: string | undefined): boolean {
  return category === "note" || category === "decision";
}

/**
 * Extract live entity IDs referenced in edges where the other endpoint
 * matches one of the provided authored node ids.
 */
function extractLinkedIds(
  edges: CanvasEdge[],
  authoredNodeIds: Set<string>,
): { featureIds: Set<string>; initiativeIds: Set<string> } {
  const featureIds = new Set<string>();
  const initiativeIds = new Set<string>();

  for (const edge of edges) {
    const from = edge.fromNode;
    const to = edge.toNode;
    if (!from || !to) continue;

    const linkedId = authoredNodeIds.has(from)
      ? to
      : authoredNodeIds.has(to)
        ? from
        : null;
    if (!linkedId) continue;

    if (linkedId.startsWith("feature:")) {
      featureIds.add(linkedId.replace("feature:", ""));
    } else if (linkedId.startsWith("initiative:")) {
      initiativeIds.add(linkedId.replace("initiative:", ""));
    }
  }

  return { featureIds, initiativeIds };
}

// ---------------------------------------------------------------------------
// LLM prompt assembly
// ---------------------------------------------------------------------------

function buildPrompt(items: LlmItem[]): string {
  return `Today is ${new Date().toISOString().split("T")[0]}.

You are reviewing canvas items for a user. Flag any item that appears stale, outdated, or no longer relevant based on its content and any linked entity state.

Items:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON array (no markdown):
[{"id": "...", "flagged": true|false, "reason": "one sentence or null", "reasonCategory": "STALE_CONTENT"|"DANGLING_ENTITY_LINK"|"ARCHIVED_INITIATIVE_LINK"|"STALE_INITIATIVE"|null}]`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runCanvasJanitorForOrg(
  orgId: string,
  configId: string,
  triggeredByUserId?: string,
  trigger: JanitorTrigger = JanitorTrigger.SCHEDULED,
): Promise<{ cardsCreated: number }> {
  // Step 1: Create run record
  const run = await db.canvasJanitorRun.create({
    data: {
      configId,
      triggeredBy: trigger,
      triggeredByUserId,
      status: JanitorStatus.PENDING,
    },
  });

  await db.canvasJanitorRun.update({
    where: { id: run.id },
    data: { status: JanitorStatus.RUNNING, startedAt: new Date() },
  });

  let totalCardsCreated = 0;

  try {
    // Step 2: Load all canvases for the org
    const canvases = await db.canvas.findMany({
      where: { orgId },
      select: { id: true, ref: true, data: true },
    });

    // Step 3: Collect authored nodes grouped by userId
    const nodesByUser = new Map<
      string,
      Array<{ node: CanvasNode; canvasRef: string; edges: CanvasEdge[] }>
    >();

    for (const canvas of canvases) {
      const blob = asBlob(canvas.data);
      for (const node of blob.nodes) {
        const cd = node.customData as Record<string, unknown> | undefined;
        const createdBy = cd?.createdBy;
        if (!createdBy || typeof createdBy !== "string") continue;
        if (!isAuthoredCategory(node.category)) continue;

        if (!nodesByUser.has(createdBy)) {
          nodesByUser.set(createdBy, []);
        }
        nodesByUser.get(createdBy)!.push({
          node,
          canvasRef: canvas.ref,
          edges: blob.edges,
        });
      }
    }

    console.log(
      `[CanvasJanitor] org=${orgId} canvases=${canvases.length} users=${nodesByUser.size}`,
    );

    // Step 4+: Process each user
    const usersWithNewCards: string[] = [];

    for (const [userId, entries] of nodesByUser.entries()) {
      try {
        const authoredNodeIds = new Set(entries.map((e) => e.node.id as string));

        // Gather all edge-referenced live IDs across all canvases for this user
        const allFeatureIds = new Set<string>();
        const allInitiativeIds = new Set<string>();
        for (const { edges } of entries) {
          const { featureIds, initiativeIds } = extractLinkedIds(edges, authoredNodeIds);
          featureIds.forEach((id) => allFeatureIds.add(id));
          initiativeIds.forEach((id) => allInitiativeIds.add(id));
        }

        // Batch-fetch DB states
        const [features, initiatives, researches] = await Promise.all([
          allFeatureIds.size > 0
            ? db.feature.findMany({
                where: { id: { in: [...allFeatureIds] } },
                select: { id: true, title: true, deleted: true, status: true },
              })
            : [],
          allInitiativeIds.size > 0
            ? db.initiative.findMany({
                where: { id: { in: [...allInitiativeIds] } },
                select: {
                  id: true,
                  name: true,
                  status: true,
                  updatedAt: true,
                  milestones: { select: { id: true } },
                },
              })
            : [],
          db.research.findMany({
            where: { orgId, createdBy: userId },
            select: {
              id: true,
              topic: true,
              initiativeId: true,
              initiative: { select: { id: true, name: true, status: true } },
            },
          }),
        ]);

        const featureMap = new Map(features.map((f) => [f.id, f]));
        const initiativeMap = new Map(initiatives.map((i) => [i.id, i]));

        // Build LLM items
        const llmItems: LlmItem[] = [];

        for (const { node, edges } of entries) {
          const cd = node.customData as Record<string, unknown> | undefined;
          const { featureIds, initiativeIds } = extractLinkedIds(
            edges,
            new Set([node.id as string]),
          );

          const linkedEntities: LinkedEntity[] = [];
          for (const fid of featureIds) {
            const f = featureMap.get(fid);
            if (f) {
              linkedEntities.push({
                type: "feature",
                name: f.title,
                status: f.deleted ? "DELETED" : f.status,
              });
            }
          }
          for (const iid of initiativeIds) {
            const ini = initiativeMap.get(iid);
            if (ini) {
              linkedEntities.push({
                type: "initiative",
                name: ini.name,
                status: ini.status,
              });
            }
          }

          llmItems.push({
            id: node.id as string,
            category: node.category ?? "note",
            text: nodeText(node),
            createdAt: (cd?.createdAt as string | null) ?? null,
            linkedEntities,
          });
        }

        // Add research items
        for (const research of researches) {
          if (research.initiativeId && research.initiative) {
            llmItems.push({
              id: `research:${research.id}`,
              category: "research",
              text: research.topic,
              createdAt: null,
              linkedEntities: [
                {
                  type: "initiative",
                  name: research.initiative.name,
                  status: research.initiative.status,
                },
              ],
            });
          }
        }

        if (llmItems.length === 0) continue;

        // Call LLM
        let llmResponse: LlmResponseItem[] = [];
        try {
          const apiKey = getApiKeyForProvider("anthropic");
          const model = getModel("anthropic", apiKey, undefined, "haiku");
          const result = await generateText({ model, prompt: buildPrompt(llmItems), temperature: 0.1 });
          llmResponse = JSON.parse(result.text) as LlmResponseItem[];
        } catch (err) {
          console.error(`[CanvasJanitor] LLM call/parse failed for userId=${userId}:`, err);
          continue;
        }

        const flagged = llmResponse.filter((r) => r.flagged && r.reasonCategory);
        if (flagged.length === 0) continue;

        // Deduplication: skip existing DISMISSED/ACTIONED cards
        const existingNodeIds = flagged
          .map((r) => r.id)
          .filter((id) => !id.startsWith("research:"));

        const existingCards = await db.canvasReviewCard.findMany({
          where: {
            orgId,
            userId,
            status: { in: ["DISMISSED", "ACTIONED"] },
            nodeId: { in: existingNodeIds },
          },
          select: { nodeId: true, reason: true },
        });
        const skipSet = new Set(existingCards.map((c) => `${c.nodeId}:${c.reason}`));

        const toCreate: import("@prisma/client").Prisma.CanvasReviewCardCreateManyInput[] = [];

        for (const item of flagged) {
          if (!item.reasonCategory) continue;

          const isResearch = item.id.startsWith("research:");
          const nodeId = isResearch ? null : item.id;
          const skipKey = `${nodeId}:${item.reasonCategory}`;
          if (!isResearch && skipSet.has(skipKey)) continue;

          if (isResearch) {
            // For research items, use entityId for dedup
            const researchId = item.id.replace("research:", "");
            const existing = await db.canvasReviewCard.findFirst({
              where: {
                orgId,
                userId,
                entityId: researchId,
                reason: item.reasonCategory,
                status: { in: ["DISMISSED", "ACTIONED"] },
              },
            });
            if (existing) continue;

            const research = researches.find((r) => r.id === researchId);
            toCreate.push({
              orgId,
              userId,
              runId: run.id,
              reason: item.reasonCategory,
              status: "PENDING",
              nodeCategory: "research",
              entityId: researchId,
              entityName: research?.topic ?? null,
              nodeText: research?.topic ?? null,
              reasonDetail: item.reason ?? null,
              canvasRef: null,
            });
          } else {
            // Find the original entry to get canvasRef
            const entry = entries.find((e) => (e.node.id as string) === nodeId);
            toCreate.push({
              orgId,
              userId,
              runId: run.id,
              reason: item.reasonCategory,
              status: "PENDING",
              nodeId: nodeId ?? undefined,
              canvasRef: entry?.canvasRef ?? null,
              nodeText: entry ? nodeText(entry.node) : null,
              nodeCategory: entry?.node.category ?? null,
              reasonDetail: item.reason ?? null,
            });
          }
        }

        if (toCreate.length > 0) {
          await db.canvasReviewCard.createMany({ data: toCreate });
          totalCardsCreated += toCreate.length;
          usersWithNewCards.push(userId);
          console.log(
            `[CanvasJanitor] userId=${userId} cards_created=${toCreate.length}`,
          );
        }
      } catch (err) {
        console.error(`[CanvasJanitor] Error processing userId=${userId}:`, err);
      }
    }

    // Step 8: Mark run completed
    await db.canvasJanitorRun.update({
      where: { id: run.id },
      data: {
        status: JanitorStatus.COMPLETED,
        completedAt: new Date(),
        cardsCreated: totalCardsCreated,
      },
    });

    await db.canvasJanitorConfig.update({
      where: { id: configId },
      data: { lastRunAt: new Date() },
    });

    // Step 9: Pusher notifications
    if (usersWithNewCards.length > 0) {
      const org = await db.sourceControlOrg.findUnique({
        where: { id: orgId },
        select: { githubLogin: true },
      });
      if (org) {
        const channel = getOrgChannelName(org.githubLogin);
        for (const userId of usersWithNewCards) {
          try {
            await pusherServer.trigger(channel, PUSHER_EVENTS.CANVAS_REVIEW_UPDATED, { userId });
          } catch (err) {
            console.error(`[CanvasJanitor] Pusher notify failed for userId=${userId}:`, err);
          }
        }
      }
    }

    console.log(
      `[CanvasJanitor] org=${orgId} completed cards_created=${totalCardsCreated}`,
    );
    return { cardsCreated: totalCardsCreated };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[CanvasJanitor] Fatal error for org=${orgId}:`, err);
    await db.canvasJanitorRun.update({
      where: { id: run.id },
      data: { status: JanitorStatus.FAILED, error: errorMessage, completedAt: new Date() },
    });
    throw err;
  }
}
