/**
 * Org-scope MCP propose tools.
 *
 * Exposes the canvas agent's nine approvable proposal tools (concepts +
 * graph writes) to external agents over MCP. The builders' `execute` is
 * pure — it validates and returns a `ProposalOutput`, writing nothing. We
 * run it, then append the same `toolCalls` row `messagesFromSteps` would
 * have stored for a Jamie turn into the target org canvas conversation, so
 * the existing ProposalCard + approval flow pick it up unchanged.
 *
 * Input schemas are taken from the builders' own tools (no hand-copied
 * fields) plus a required `conversationId`.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolSet } from "ai";
import { db } from "@/lib/db";
import { buildConceptTools } from "@/lib/ai/conceptTools";
import { buildGraphWriteTools } from "@/lib/ai/graphWriteTools";
import { isGraphWriteCapabilityEnabledForOrg } from "@/lib/ai/capabilityGates";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";
import { appendTurnMessages } from "@/services/canvas-turn-persistence";
import {
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
} from "@/lib/proposals/types";
import type { OrgMcpAuthExtra } from "@/lib/mcp/orgMcpTools";

type Family = "concept" | "graph";

const PROPOSE_TOOLS: ReadonlyArray<{ name: string; family: Family }> = [
  { name: PROPOSE_NEW_CONCEPT_TOOL, family: "concept" },
  { name: PROPOSE_CONCEPT_UPDATE_TOOL, family: "concept" },
  { name: PROPOSE_CREATE_NODE_TOOL, family: "graph" },
  { name: PROPOSE_NODE_EDIT_TOOL, family: "graph" },
  { name: PROPOSE_CREATE_TRIPLET_TOOL, family: "graph" },
  { name: PROPOSE_CREATE_BATCH_TRIPLET_TOOL, family: "graph" },
  { name: PROPOSE_DELETE_EDGE_TOOL, family: "graph" },
  { name: PROPOSE_MOVE_NODE_TOOL, family: "graph" },
  { name: PROPOSE_DELETE_NODE_TOOL, family: "graph" },
];

function buildFamily(family: Family, orgId: string, userId: string): ToolSet {
  return family === "concept"
    ? buildConceptTools(orgId, userId)
    : buildGraphWriteTools(orgId, userId);
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function registerOrgProposeTools(server: McpServer): void {
  for (const { name, family } of PROPOSE_TOOLS) {
    // Builders are pure at construction; build once to read schema/description.
    const template = buildFamily(family, "", "")[name] as unknown as {
      description?: string;
      inputSchema: z.ZodObject<z.ZodRawShape>;
    };

    server.registerTool(
      name,
      {
        title: name,
        description:
          `${template.description ?? ""}\n\n` +
          "Via MCP, the proposal is posted as a card into the given org canvas " +
          "conversation for the user to approve; nothing is written until they approve.",
        inputSchema: {
          ...template.inputSchema.shape,
          conversationId: z
            .string()
            .describe(
              "the org canvas conversation (?chat=<id>) the proposal card is posted into",
            ),
        },
      },
      async (args: Record<string, unknown>, extra) => {
        const authExtra = extra.authInfo?.extra as OrgMcpAuthExtra | undefined;
        if (!authExtra || authExtra.scope !== "org") {
          return fail("Error: Org auth context missing");
        }
        if (!authExtra.permissions.includes("write")) {
          return fail("Error: write permission required");
        }
        const { orgId, userId } = authExtra;
        const { conversationId, ...toolArgs } = args;

        const rowId = await resolveOrgConversationRowId({
          conversationId,
          userId,
          orgId,
        });
        if (!rowId) return fail("Error: conversation not found");

        if (family === "graph") {
          const enabled = await isGraphWriteCapabilityEnabledForOrg(orgId);
          if (!enabled) {
            return fail("Error: graph write proposals are not enabled for this org");
          }
        }

        try {
          const live = buildFamily(family, orgId, userId)[name] as unknown as {
            execute: (a: unknown, o: unknown) => Promise<unknown>;
          };
          const proposal = (await live.execute(toolArgs, {
            toolCallId: "mcp",
            messages: [],
          })) as Record<string, unknown>;

          if (proposal && typeof proposal === "object" && "error" in proposal) {
            return fail(`Error: ${String(proposal.error)}`);
          }

          const callId = `mcp-${randomUUID()}`;
          const appended = await appendTurnMessages({
            conversationId: rowId,
            idPrefix: `${callId}-`,
            // "mcp": an external agent posted a proposal card over MCP.
            reason: "mcp",
            rows: [
              {
                id: `${callId}-a0`,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                toolCalls: [
                  {
                    id: callId,
                    toolName: name,
                    input: toolArgs,
                    output: proposal,
                    status: "output-available",
                  },
                ],
              } as Parameters<typeof appendTurnMessages>[0]["rows"][number],
            ],
          });

          // false => nothing written (e.g. conversation deleted mid-call).
          if (!appended) return fail("Error: conversation not found");

          let link: string | undefined;
          const org = await db.sourceControlOrg.findUnique({
            where: { id: orgId },
            select: { githubLogin: true },
          });
          if (org) {
            const path = `/org/${org.githubLogin}?chat=${rowId}`;
            const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
            link = base ? `${base}${path}` : path;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    proposalId: proposal.proposalId,
                    kind: proposal.kind,
                    conversationId: rowId,
                    ...(link ? { link } : {}),
                    status:
                      "Proposal card posted; awaiting the user's approval in the conversation. Nothing is written until they approve.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          console.error(`[orgProposeTools.${name}] failed:`, err);
          return fail("Error: failed to post proposal");
        }
      },
    );
  }
}
