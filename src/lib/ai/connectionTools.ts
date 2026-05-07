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

    list_connections: tool({
      description:
        "List all Connection documents in this org, most recently updated " +
        "first. Returns a compact array of `{ slug, name, summary, " +
        "hasDiagram, hasArchitecture, hasOpenApiSpec, updatedAt }` — the " +
        "`has*` flags let you see at a glance which fields are populated " +
        "without pulling the (potentially large) bodies. Use this when " +
        "the user asks what integration docs already exist, or to check " +
        "for a prior writeup before creating a new one. Pair with " +
        "`read_connection` to pull the full body for a specific slug. " +
        "Edges that link to a Connection carry the slug in " +
        "`edge.customData.connectionId` — use `read_canvas` to discover " +
        "those linkages and this tool to enumerate the docs themselves.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const rows = await db.connection.findMany({
            where: { orgId },
            orderBy: { updatedAt: "desc" },
            select: {
              slug: true,
              name: true,
              summary: true,
              diagram: true,
              architecture: true,
              openApiSpec: true,
              updatedAt: true,
            },
          });
          return rows.map((r) => ({
            slug: r.slug,
            name: r.name,
            summary: r.summary,
            // Surface presence flags rather than the bodies themselves
            // so the listing stays cheap. Agent can call read_connection
            // for the full content when it needs to extend or cite.
            hasDiagram: r.diagram !== null,
            hasArchitecture: r.architecture !== null,
            hasOpenApiSpec: r.openApiSpec !== null,
            updatedAt: r.updatedAt,
          }));
        } catch (e) {
          console.error("Error listing connections:", e);
          return { error: "Failed to list connections" };
        }
      },
    }),

    read_connection: tool({
      description:
        "Read a Connection document's full body by slug. Returns " +
        "`{ slug, name, summary, diagram, architecture, openApiSpec, " +
        "updatedAt }` — any of `diagram` / `architecture` / `openApiSpec` " +
        "may be null if not yet authored. Use this whenever the user " +
        "asks to extend, cite, or reference an existing integration doc, " +
        "or before calling `update_connection` to add a section so you " +
        "can preserve what's already there. `update_connection` is per- " +
        "field overwrite (each field independently), so reading the " +
        "current value is the right way to extend rather than replace " +
        "(e.g. append a new flow to an existing diagram, or add a " +
        "section to an existing architecture writeup).",
      inputSchema: z.object({
        slug: z.string().min(1).describe("The slug of the connection to read."),
      }),
      execute: async ({ slug }: { slug: string }) => {
        try {
          const row = await db.connection.findUnique({
            where: { orgId_slug: { orgId, slug } },
            select: {
              slug: true,
              name: true,
              summary: true,
              diagram: true,
              architecture: true,
              openApiSpec: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!row) {
            return {
              error: `No connection found with slug "${slug}". Use list_connections to see available slugs.`,
            };
          }
          return row;
        } catch (e) {
          console.error("Error reading connection:", e);
          return { error: "Failed to read connection" };
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
