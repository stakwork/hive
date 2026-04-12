import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

/**
 * Build connection tools for creating/updating Connection documents.
 * These are merged into the multi-workspace toolset when an orgId is provided.
 */
export function buildConnectionTools(orgId: string, userId: string): ToolSet {
  return {
    save_connection: tool({
      description:
        "Create a new Connection document that describes how two or more systems/workspaces integrate. " +
        "Call this after you have researched the relevant concepts and written a summary. " +
        "Returns the connectionId needed for subsequent update_connection calls.",
      inputSchema: z.object({
        name: z.string().describe("Short name for the connection, e.g. 'Checkout ↔ Payments API'"),
        summary: z.string().describe("Detailed markdown summary of how the systems connect"),
      }),
      execute: async ({ name, summary }: { name: string; summary: string }) => {
        try {
          const connection = await db.connection.create({
            data: {
              name,
              summary,
              createdBy: userId,
              orgId,
            },
          });

          // Notify sidebar to refresh
          const org = await db.sourceControlOrg.findUnique({
            where: { id: orgId },
            select: { githubLogin: true },
          });
          if (org) {
            const channelName = getOrgChannelName(org.githubLogin);
            await pusherServer.trigger(channelName, PUSHER_EVENTS.CONNECTION_UPDATED, {
              connectionId: connection.id,
              action: "created",
              timestamp: Date.now(),
            });
          }

          return { connectionId: connection.id, status: "created" };
        } catch (e) {
          console.error("Error saving connection:", e);
          return { error: "Failed to save connection" };
        }
      },
    }),

    update_connection: tool({
      description:
        "Update an existing Connection with a mermaid diagram and/or OpenAPI spec. " +
        "Call this after save_connection, using the connectionId it returned. " +
        "You can call this multiple times — once for the diagram, once for the OpenAPI spec.",
      inputSchema: z.object({
        connectionId: z.string().describe("The ID returned by save_connection"),
        diagram: z
          .string()
          .optional()
          .describe("Mermaid diagram source code (without ```mermaid fences)"),
        openApiSpec: z
          .string()
          .optional()
          .describe("OpenAPI 3.x specification in YAML format"),
      }),
      execute: async ({
        connectionId,
        diagram,
        openApiSpec,
      }: {
        connectionId: string;
        diagram?: string;
        openApiSpec?: string;
      }) => {
        try {
          const data: Record<string, string> = {};
          if (diagram !== undefined) data.diagram = diagram;
          if (openApiSpec !== undefined) data.openApiSpec = openApiSpec;

          if (Object.keys(data).length === 0) {
            return { error: "Provide at least one of: diagram, openApiSpec" };
          }

          await db.connection.update({
            where: { id: connectionId },
            data,
          });

          // Notify sidebar to refresh
          const connection = await db.connection.findUnique({
            where: { id: connectionId },
            select: { orgId: true },
          });
          if (connection) {
            const org = await db.sourceControlOrg.findUnique({
              where: { id: connection.orgId },
              select: { githubLogin: true },
            });
            if (org) {
              const channelName = getOrgChannelName(org.githubLogin);
              await pusherServer.trigger(channelName, PUSHER_EVENTS.CONNECTION_UPDATED, {
                connectionId,
                action: "updated",
                fields: Object.keys(data),
                timestamp: Date.now(),
              });
            }
          }

          return { connectionId, status: "updated", fields: Object.keys(data) };
        } catch (e) {
          console.error("Error updating connection:", e);
          return { error: "Failed to update connection" };
        }
      },
    }),
  };
}
