import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

async function notifyConnectionUpdate(orgId: string, slug: string, action: string, fields?: string[]) {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    if (org) {
      const channelName = getOrgChannelName(org.githubLogin);
      await pusherServer.trigger(channelName, PUSHER_EVENTS.CONNECTION_UPDATED, {
        slug,
        action,
        ...(fields ? { fields } : {}),
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.error("Error sending connection update notification:", e);
  }
}

/**
 * Build connection tools for creating/updating Connection documents.
 * These are merged into the multi-workspace toolset when an orgId is provided.
 */
export function buildConnectionTools(orgId: string, userId: string): ToolSet {
  return {
    save_connection: tool({
      description:
        "Create a new Connection document that describes how two or more systems/workspaces integrate. " +
        "Call this after you have researched the relevant concepts and written a brief overview. " +
        "Returns the slug needed for subsequent update_connection calls.",
      inputSchema: z.object({
        slug: z.string().describe("A short kebab-case identifier like 'sphinx-hive' or 'frontend-backend-api'"),
        name: z.string().describe("Short human-readable name for the connection"),
        summary: z.string().describe("Brief overview: 1-2 sentences and/or a few bullet points"),
      }),
      execute: async ({ slug, name, summary }: { slug: string; name: string; summary: string }) => {
        try {
          const connection = await db.connection.create({
            data: {
              slug,
              name,
              summary,
              createdBy: userId,
              orgId,
            },
          });

          await notifyConnectionUpdate(orgId, slug, "created");

          return { slug: connection.slug, status: "created" };
        } catch (e) {
          console.error("Error saving connection:", e);
          return { error: "Failed to save connection" };
        }
      },
    }),

    update_connection: tool({
      description:
        "Update an existing Connection with a diagram, architecture write-up, and/or OpenAPI spec. " +
        "Call this after save_connection, using the slug it returned. " +
        "You can call this multiple times — once per field.",
      inputSchema: z.object({
        slug: z.string().describe("The slug of the connection to update"),
        diagram: z
          .string()
          .optional()
          .describe("Mermaid diagram source code (without ```mermaid fences)"),
        architecture: z
          .string()
          .optional()
          .describe("Detailed markdown architecture write-up of how the systems integrate"),
        openApiSpec: z
          .string()
          .optional()
          .describe("OpenAPI 3.x specification in YAML format"),
      }),
      execute: async ({
        slug,
        diagram,
        architecture,
        openApiSpec,
      }: {
        slug: string;
        diagram?: string;
        architecture?: string;
        openApiSpec?: string;
      }) => {
        try {
          const data: Record<string, string> = {};
          if (diagram !== undefined) data.diagram = diagram;
          if (architecture !== undefined) data.architecture = architecture;
          if (openApiSpec !== undefined) data.openApiSpec = openApiSpec;

          if (Object.keys(data).length === 0) {
            return { error: "Provide at least one of: diagram, architecture, openApiSpec" };
          }

          await db.connection.update({
            where: { orgId_slug: { orgId, slug } },
            data,
          });

          await notifyConnectionUpdate(orgId, slug, "updated", Object.keys(data));

          return { slug, status: "updated", fields: Object.keys(data) };
        } catch (e) {
          console.error("Error updating connection:", e);
          return { error: "Failed to update connection" };
        }
      },
    }),
  };
}
