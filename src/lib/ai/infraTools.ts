import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSwarmContainerConfig } from "@/services/swarm/db";
import { maskEnvVarsInPM2Config } from "@/utils/devContainerUtils";

/**
 * Build the read-only infra capability tools for the org-canvas agent.
 *
 * Exports a single `read_pod_infra` tool that reads a workspace's stored
 * pod config files (Dockerfile, pm2.config.js, docker-compose.yml, etc.)
 * from `Swarm.containerFiles`. Strictly scoped to workspaces belonging to
 * the caller's org — IDOR-safe: unauthorized slugs return an
 * indistinguishable "not found" message.
 */
export function buildInfraTools(orgId: string, userId: string): ToolSet {
  return {
    read_pod_infra: tool({
      description:
        "Read a workspace's stored pod infrastructure config files " +
        "(Dockerfile, pm2.config.js, docker-compose.yml, devcontainer.json, etc.) " +
        "from Hive's `Swarm.containerFiles`. Env-var values in pm2.config.js are " +
        "masked. Use `listOnly` to see which files exist before pulling bodies, " +
        "or `file` to read a single file. Only works for workspaces you can access " +
        "in this org.",
      inputSchema: z.object({
        workspace: z
          .string()
          .describe("The workspace slug or id to read infra config from."),
        file: z
          .string()
          .optional()
          .describe(
            "Return only this specific file by name (e.g. 'Dockerfile', 'pm2.config.js'). " +
              "If the file is not present, an error listing available filenames is returned.",
          ),
        listOnly: z
          .boolean()
          .optional()
          .describe(
            "If true, return only the list of available filenames and a compact services summary — no file bodies.",
          ),
      }),
      execute: async ({
        workspace,
        file,
        listOnly,
      }: {
        workspace: string;
        file?: string;
        listOnly?: boolean;
      }) => {
        try {
          // ---------------------------------------------------------------
          // Org-scoped workspace resolution (IDOR protection).
          // Mirror the guard from resolveOrgWorkspaceSlugs in orgMcpTools.ts:
          //   sourceControlOrgId === orgId, deleted: false,
          //   AND (ownerId === userId OR member with leftAt: null).
          // ---------------------------------------------------------------
          const ws = await db.workspace.findFirst({
            where: {
              sourceControlOrgId: orgId,
              deleted: false,
              OR: [{ slug: workspace }, { id: workspace }],
              AND: [
                {
                  OR: [
                    { ownerId: userId },
                    { members: { some: { userId, leftAt: null } } },
                  ],
                },
              ],
            },
            select: { id: true, slug: true, name: true },
          });

          if (!ws) {
            console.warn(
              `[infraTools] read_pod_infra: workspace "${workspace}" not found or not accessible for org ${orgId} / user ${userId}`,
            );
            return { error: "Workspace not found or not accessible" };
          }

          // ---------------------------------------------------------------
          // Fetch and decode container config (reuses existing helper).
          // ---------------------------------------------------------------
          const config = await getSwarmContainerConfig(ws.id);

          if (!config || !config.containerFiles || Object.keys(config.containerFiles).length === 0) {
            console.warn(
              `[infraTools] read_pod_infra: workspace "${ws.slug}" has no provisioned container files`,
            );
            return {
              status: "not_provisioned",
              message: "Pod infra not provisioned yet for this workspace",
              workspace: ws.slug,
            };
          }

          const { containerFiles, services } = config;

          const filenames = Object.keys(containerFiles);
          const servicesSummary = services.map((s) => ({
            name: s.name,
            scripts: s.scripts,
          }));

          /** Mask pm2 env vars only when actually returning that file's content. */
          const getMaskedContent = (name: string, content: string): string =>
            name === "pm2.config.js" ? maskEnvVarsInPM2Config(content) : content;

          // ---------------------------------------------------------------
          // listOnly mode — filenames + services summary, no file bodies
          // ---------------------------------------------------------------
          if (listOnly) {
            return {
              workspace: ws.slug,
              files: filenames,
              serviceCount: services.length,
              services: servicesSummary,
            };
          }

          // ---------------------------------------------------------------
          // Single-file mode
          // ---------------------------------------------------------------
          if (file) {
            if (!(file in containerFiles)) {
              return {
                error: `File "${file}" not found. Available files: ${filenames.join(", ")}`,
              };
            }
            return {
              workspace: ws.slug,
              file,
              content: getMaskedContent(file, containerFiles[file]),
            };
          }

          // ---------------------------------------------------------------
          // Default: return all files (pm2 masked) + services
          // ---------------------------------------------------------------
          const maskedFiles: Record<string, string> = {};
          for (const [name, content] of Object.entries(containerFiles)) {
            maskedFiles[name] = getMaskedContent(name, content);
          }

          return {
            workspace: ws.slug,
            files: maskedFiles,
            services: config.services,
          };
        } catch (e) {
          console.error("[infraTools] read_pod_infra unexpected error:", e);
          return { error: "Failed to read pod infra config" };
        }
      },
    }),
  };
}
