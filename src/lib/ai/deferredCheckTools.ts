/**
 * Deferred-check AI tool factory.
 *
 * Provides the `schedule_check` tool that persists a `DeferredChatAction`
 * so the cron dispatcher can re-run the original query at the scheduled
 * time and post the result back into the same conversation thread.
 *
 * The tool description encodes the three scheduling intent cases so the
 * LLM handles each correctly without extra routing logic:
 *   - Relative delays  → compute delayMs and call the tool immediately
 *   - Vague/event-based → do NOT call; ask for a concrete delay
 *   - Absolute times   → do NOT call; ask for timezone or relative offset
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

export interface DeferredCheckToolContext {
  conversationId: string;
  orgId: string;
  userId: string;
}

const SCHEDULE_CHECK_DESCRIPTION = `Use this tool when the user wants to check something at a future time.

**Relative delays** (e.g. 'in 5 minutes', 'in an hour'): compute \`delayMs\` directly and call the tool.

**Vague / event-based** (e.g. 'after the next deploy', 'when the build finishes'): do NOT call the tool — ask the user for a concrete delay instead (e.g. 'How long from now should I check? For example, in 10 minutes or in 2 hours.').

**Absolute times** (e.g. 'at 3pm', 'at noon', 'tomorrow morning'): do NOT call the tool — you do not know the user's timezone. Ask: 'What timezone are you in? Or tell me how long from now (e.g. in 2 hours) and I'll schedule it.' Once the user gives a relative delay or a timezone-qualified time, compute \`delayMs\` and call the tool.`;

/**
 * Factory that returns a `schedule_check` Vercel AI SDK tool bound to the
 * supplied conversation / org / user context. All three context values are
 * resolved server-side before the tool is assembled, so the LLM cannot
 * override them (IDOR guard).
 */
export function buildDeferredCheckTools(ctx: DeferredCheckToolContext) {
  return {
    schedule_check: tool({
      description: SCHEDULE_CHECK_DESCRIPTION,
      inputSchema: z.object({
        query: z
          .string()
          .describe("The exact query to run at the scheduled time"),
        delayMs: z
          .number()
          .describe("Delay in milliseconds from now until the check should fire"),
        description: z
          .string()
          .describe(
            "Human-readable description of what will be checked and when (e.g. 'Check PR #42 CI status in 5 minutes')",
          ),
      }),
      execute: async ({
        query,
        delayMs,
        description,
      }: {
        query: string;
        delayMs: number;
        description: string;
      }) => {
        const fireAt = new Date(Date.now() + delayMs);

        const record = await db.deferredChatAction.create({
          data: {
            conversationId: ctx.conversationId,
            orgId: ctx.orgId,
            userId: ctx.userId,
            query,
            description,
            fireAt,
            status: "PENDING",
          },
        });

        return {
          deferredActionId: record.id,
          fireAt: fireAt.toISOString(),
          description,
        };
      },
    }),
  };
}
