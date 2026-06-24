/**
 * Read-only "what happened in this org-canvas conversation" summarizer.
 *
 * Powers the `read_conversation` MCP tool: given a `SharedConversation.id`,
 * it reconstructs the conversation the way the canvas chat UI presents it —
 * the meaningful elements a human reads, NOT the raw tool-call trace. An
 * external MCP client (call/voice agent) uses it to answer "did they approve
 * my proposal?", "is the plan built yet?", "are there PRs?" without spending
 * a full `org_agent` LLM turn.
 *
 * Two data sources, mirroring the frontend:
 *
 *   1. The stored `messages` array (the `CanvasChatMessage[]` the whole UI
 *      derives from): user/assistant text, proposals + their approve/reject
 *      decision, research runs, scheduled checks. Derived with the same
 *      pure helpers the UI uses (`getProposalStatus` + the `propose_*` tool
 *      constants) so the summary can't drift from what the card shows.
 *
 *   2. A targeted DB read for the parts that are NOT in the chat JSON —
 *      tasks and PR artifacts. Approving a feature proposal stamps
 *      `Feature.parentCanvasConversationId`, so every feature/plan tied to
 *      this conversation is one indexed query away; tasks + their PR
 *      artifacts hang off that (`Task.chatMessages[].artifacts` where
 *      type === PULL_REQUEST). Read-only: no GitHub refresh, no writes.
 */

import { db } from "@/lib/db";
import {
  getProposalStatus,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  type ProposalOutput,
} from "@/lib/proposals/types";
import { fetchOrgCanvasConversationMessages } from "@/services/org-canvas-conversation";
import type {
  StoredMessage,
  StoredToolCall,
} from "@/services/canvas-turn-persistence";

const PROPOSE_TOOL_NAMES = new Set<string>([
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
]);

const END_MARKER = /\[END_OF_ANSWER\]/g;

/** Richer view of the loosely-typed `StoredMessage.source` JSON. */
type MessageSource = {
  kind?: string;
  // research variant
  researchId?: string;
  topic?: string;
  title?: string;
  status?: string;
};

/** Title shown on a proposal card: `title` for features, `name` otherwise. */
function proposalTitle(output: ProposalOutput): string {
  const payload = output.payload as { title?: string; name?: string };
  return payload.title ?? payload.name ?? "(untitled)";
}

/** The propose_* tool calls on one message, as typed proposal outputs. */
function proposalsOnMessage(message: StoredMessage): ProposalOutput[] {
  const calls: StoredToolCall[] = message.toolCalls ?? [];
  const out: ProposalOutput[] = [];
  for (const tc of calls) {
    if (!PROPOSE_TOOL_NAMES.has(tc.toolName)) continue;
    const output = tc.output;
    if (!output || typeof output !== "object") continue;
    // A failed propose call carries `{ error }` — not a real card.
    if ("error" in (output as Record<string, unknown>)) continue;
    out.push(output as ProposalOutput);
  }
  return out;
}

function proposalStatusLabel(
  messages: StoredMessage[],
  proposalId: string,
): string {
  // `getProposalStatus` only reads role + approval/rejection/approvalResult,
  // all of which live on the stored JSON (typed loosely here).
  const status = getProposalStatus(
    messages as unknown as Parameters<typeof getProposalStatus>[0],
    proposalId,
  );
  switch (status.status) {
    case "approved": {
      const where = status.result.landedOnName
        ? ` on "${status.result.landedOnName}"`
        : "";
      return `APPROVED${where}`;
    }
    case "rejected":
      return "rejected";
    case "pending-in-flight":
      return "approval in progress";
    default:
      return "awaiting approval";
  }
}

/** Collect research runs across the whole transcript, deduped by id. */
function collectResearch(
  messages: StoredMessage[],
): Array<{ topic: string; status: string }> {
  const byId = new Map<string, { topic: string; status: string }>();
  for (const m of messages) {
    const src = (m.source ?? {}) as MessageSource;
    if (src.kind === "research" && src.researchId) {
      byId.set(src.researchId, {
        topic: src.topic || src.title || "research",
        status: src.status || "ready",
      });
    }
    for (const tc of m.toolCalls ?? []) {
      if (tc.toolName !== "dispatch_research") continue;
      const input = (tc.input ?? {}) as { topic?: string };
      const output = (tc.output ?? {}) as { researchId?: string };
      const id = output.researchId;
      // Only seed a "dispatched" entry if no completion row exists yet.
      if (id && !byId.has(id)) {
        byId.set(id, { topic: input.topic || "research", status: "dispatched" });
      }
    }
  }
  return [...byId.values()];
}

interface PrInfo {
  url: string;
  status: string;
}

/** First PR artifact on a task's chat messages, read-only. */
function firstPrArtifact(task: {
  chatMessages: Array<{ artifacts: Array<{ content: unknown }> }>;
}): PrInfo | null {
  for (const cm of task.chatMessages) {
    for (const art of cm.artifacts) {
      const content = art.content as { url?: string; status?: string } | null;
      if (content?.url) {
        return { url: content.url, status: content.status ?? "IN_PROGRESS" };
      }
    }
  }
  return null;
}

/**
 * Build a human/LLM-readable readout of an org-canvas conversation, or
 * `null` if the conversation doesn't exist or the caller can't see it
 * (IDOR-safe: a mismatched id is indistinguishable from missing).
 */
export async function buildOrgConversationReadout(args: {
  conversationId: string;
  userId: string;
  orgId: string;
}): Promise<string | null> {
  const { conversationId, userId, orgId } = args;

  // Validates org + (owner | isShared) and returns the stored transcript.
  const messages = await fetchOrgCanvasConversationMessages({
    conversationId,
    userId,
    orgId,
  });
  if (messages === null) return null;

  const convo = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { title: true },
  });

  const lines: string[] = [];
  lines.push(`Conversation: ${convo?.title ?? "(untitled)"}`);
  lines.push("");

  // ── Transcript ────────────────────────────────────────────────────
  for (const m of messages) {
    const text = (m.content ?? "").replace(END_MARKER, "").trim();

    if (m.role === "user") {
      // Approve/Reject intents render no bubble in the UI — the card's
      // status transition is the feedback. Skip them here too.
      const isIntentOnly =
        !text &&
        ((m as { approval?: unknown }).approval !== undefined ||
          (m as { rejection?: unknown }).rejection !== undefined);
      if (text && !isIntentOnly) lines.push(`User: ${text}`);
    } else {
      if (text) lines.push(`Jamie: ${text}`);
      // Proposals + their decision, inline where they were made.
      for (const p of proposalsOnMessage(m)) {
        lines.push(
          `  • Proposed ${p.kind} "${proposalTitle(p)}" — ${proposalStatusLabel(
            messages,
            p.proposalId,
          )}`,
        );
      }
    }

    if (m.deferredCheck) {
      lines.push(
        `  • Scheduled check: ${m.deferredCheck.description} (${m.deferredCheck.status})`,
      );
    }
  }

  // ── Research ──────────────────────────────────────────────────────
  const research = collectResearch(messages);
  if (research.length > 0) {
    lines.push("");
    lines.push("Research:");
    for (const r of research) {
      lines.push(`  • "${r.topic}" — ${r.status}`);
    }
  }

  // ── Plans (features) + tasks + PRs (DB) ───────────────────────────
  const features = await db.feature.findMany({
    where: { parentCanvasConversationId: conversationId, deleted: false },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      status: true,
      workflowStatus: true,
      tasks: {
        where: { deleted: false },
        orderBy: { order: "asc" },
        select: {
          title: true,
          status: true,
          chatMessages: {
            select: {
              artifacts: {
                where: { type: "PULL_REQUEST" },
                select: { content: true },
              },
            },
          },
        },
      },
    },
  });

  lines.push("");
  if (features.length === 0) {
    lines.push("Plans: none created yet.");
  } else {
    lines.push("Plans (features) created in this conversation:");
    for (const f of features) {
      const planState = f.workflowStatus ?? f.status;
      lines.push(`  • "${f.title}" [${planState}]`);
      if (f.tasks.length === 0) {
        lines.push("      (no tasks yet)");
      }
      for (const t of f.tasks) {
        const pr = firstPrArtifact(t);
        const prSuffix = pr ? ` — PR: ${pr.url} (${pr.status})` : "";
        lines.push(`      - ${t.title} [${t.status}]${prSuffix}`);
      }
    }
  }

  return lines.join("\n");
}
