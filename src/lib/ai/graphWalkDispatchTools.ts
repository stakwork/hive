/**
 * Canvas graph-walk dispatch tools.
 *
 * Provides two tools wired into the `graph_walker` capability:
 *
 *   - `dispatch_graph_walk` — fires a background intent (no DB row,
 *     no inline spawn). Pushes a `DispatchedGraphWalkIntent` onto
 *     `ctx.dispatchedGraphWalks` so the route's `after()` block can
 *     schedule the worker after the stream is consumed.
 *
 *   - `finalize_graph_walk` — writes the synthesized answer into
 *     `ctx.graphWalkAnswerSink`. Used ONLY by the sub-agent; in the
 *     parent context the sink is absent, so the call is a documented
 *     no-op (guidance returned instead of error) — the parent can
 *     never accidentally finalize itself.
 *
 * Mirror of `researchTools.ts` dispatch/finalize pattern, but lighter:
 * no DB row is created or read for a graph walk.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { CapabilityContext } from "@/lib/ai/capabilities";

/**
 * A graph-walk dispatch intent captured when `dispatch_graph_walk`
 * fires. Pushed into a mutable collector array so the route's
 * `after()` block can schedule the sub-agent after the stream.
 */
export interface DispatchedGraphWalkIntent {
  graphWalkId: string;
  title: string;
  prompt: string;
  conversationId: string;
  orgId: string;
  userId: string;
}

/**
 * Build the `dispatch_graph_walk` and `finalize_graph_walk` tools.
 * Returned as a `ToolSet` fragment spread into the `graph_walker`
 * capability's `buildTools` output.
 *
 * **dispatch_graph_walk** — parent-context only.
 *   Pushes an intent onto `ctx.dispatchedGraphWalks` (when the
 *   collector AND `ctx.currentCanvasConversationId` are present);
 *   returns `{ status: "dispatched" }` immediately. Does NOT spawn
 *   any inline work; the `after()` block schedules the worker.
 *
 * **finalize_graph_walk** — sub-agent context only.
 *   Writes `answer` into `ctx.graphWalkAnswerSink.answer` and returns
 *   `{ status: "finalized" }`. When the sink is absent (parent
 *   context) it is a no-op returning guidance — the parent never
 *   mis-fires this.
 */
export function buildGraphWalkDispatchTools(ctx: CapabilityContext): ToolSet {
  const tools: ToolSet = {};

  tools.dispatch_graph_walk = tool({
    description:
      "Dispatch a knowledge-graph query to a background sub-agent and return immediately. " +
      "Use this when a graph-walk task is complex (multi-hop, slow, or best run off the critical path) " +
      "and you want to continue the current turn. The sub-agent will run the query with full " +
      "`graph_walker` access and fan its synthesized text answer back into this conversation as " +
      "an assistant bubble. Returns { status: 'dispatched' } immediately — do NOT wait for the result.\n\n" +
      "Use `dispatch_graph_walk` for: multi-hop traversals, large ontology scans, or any graph work " +
      "that might take more than a few seconds.\n" +
      "Use `learn_capability('graph_walker')` + inline tools for: quick single-node lookups, " +
      "a single `graph_search` call, or when you need the answer synchronously in this turn.",
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .describe(
          "Short human-readable label for this graph-walk task (e.g. 'Find all Files linked to AuthFeature'). " +
          "Shown in the result card.",
        ),
      prompt: z
        .string()
        .min(1)
        .describe(
          "Full instructions for the sub-agent: what to search, which nodes/edges to traverse, " +
          "what question to answer, and what to include in the synthesized response.",
        ),
    }),
    execute: async ({
      title,
      prompt,
    }: {
      title: string;
      prompt: string;
    }) => {
      if (!ctx.dispatchedGraphWalks || !ctx.currentCanvasConversationId) {
        return {
          status: "no-op",
          reason:
            "dispatch_graph_walk is only available in the canvas conversation context. " +
            "Use the inline graph_walker tools instead.",
        };
      }

      const graphWalkId = crypto.randomUUID();

      const intent: DispatchedGraphWalkIntent = {
        graphWalkId,
        title,
        prompt,
        conversationId: ctx.currentCanvasConversationId,
        orgId: ctx.orgId,
        userId: ctx.userId,
      };

      ctx.dispatchedGraphWalks.push(intent);

      return { status: "dispatched", graphWalkId };
    },
  });

  tools.finalize_graph_walk = tool({
    description:
      "Write the synthesized answer for a dispatched graph-walk task. " +
      "Call this ONCE with the complete text answer after you have gathered all the information " +
      "from the knowledge graph. This is the sub-agent's only write tool — the result is fanned " +
      "back into the parent conversation as an assistant bubble.",
    inputSchema: z.object({
      answer: z
        .string()
        .min(1)
        .describe(
          "The complete synthesized text answer to the graph-walk query. " +
          "Write a clear, well-structured response covering what was found in the knowledge graph.",
        ),
    }),
    execute: async ({ answer }: { answer: string }) => {
      if (!ctx.graphWalkAnswerSink) {
        // Parent context: no sink present — this is a no-op with guidance.
        return {
          status: "no-op",
          reason:
            "finalize_graph_walk is only callable by a graph-walk sub-agent. " +
            "In the parent context, use dispatch_graph_walk to spawn the sub-agent instead.",
        };
      }

      ctx.graphWalkAnswerSink.answer = answer;
      return { status: "finalized" };
    },
  });

  return tools;
}
