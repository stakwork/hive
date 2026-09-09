/**
 * Shared config helpers for the org external-MCP-server CRUD routes
 * (`/api/orgs/[githubLogin]/mcp-servers`). Kept out of the route files
 * because Next.js route modules may only export HTTP handlers.
 *
 * Header values are write-only through the API: they are encrypted at
 * rest (`mcpHeaders` field) and serialization exposes only key names.
 */

import { EncryptionService } from "@/lib/encryption";
import { MCP_SERVER_NAME_RE, decryptMcpHeaders } from "@/lib/ai/externalMcpTools";
import { z } from "zod";

export const mcpServerCreateSchema = z.object({
  name: z
    .string()
    .regex(MCP_SERVER_NAME_RE, "Name must be 1-24 chars of letters, digits, '-' or '_' (it prefixes tool names)"),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), "URL must be http(s)"),
  headers: z.record(z.string(), z.string()).optional(),
  toolFilter: z.array(z.string().min(1)).max(100).optional(),
  enabled: z.boolean().optional(),
});

/** PATCH accepts any subset; `headers: null` clears stored headers. */
export const mcpServerUpdateSchema = mcpServerCreateSchema
  .partial()
  .extend({ headers: z.record(z.string(), z.string()).nullable().optional() });

export interface SerializedMcpServer {
  id: string;
  name: string;
  url: string;
  headerKeys: string[];
  toolFilter: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialize an OrgMcpServer row for the client. Header VALUES are
 * write-only — only the key names are returned (for the edit form).
 */
export function serializeMcpServer(server: {
  id: string;
  name: string;
  url: string;
  headers: string | null;
  toolFilter: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedMcpServer {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    headerKeys: Object.keys(decryptMcpHeaders(server.headers, server.name)),
    toolFilter: server.toolFilter,
    enabled: server.enabled,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  };
}

export function encryptMcpHeaders(headers: Record<string, string>): string {
  return JSON.stringify(EncryptionService.getInstance().encryptField("mcpHeaders", JSON.stringify(headers)));
}
