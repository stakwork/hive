/**
 * Prompt capability tools for the canvas agent.
 *
 * Four tools:
 *   - `get_prompt`           — fetch a prompt's resolved content by id or name (read, no approval)
 *   - `list_prompts`         — list prompts with latest/published version number (read, no approval)
 *   - `propose_new_prompt`   — emit an approvable card to create a new prompt (write via approval)
 *   - `propose_prompt_update`— emit an approvable card with before/after diff (write via approval)
 *
 * The `Prompt` model is globally scoped (no org/workspace FK), so the builder
 * takes only `userId` — no `orgId` param. The MCP write fns resolve the shared
 * Stakwork workspace internally; the approval handler guards membership.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { getResolvedPrompt, getRawPromptValue } from "@/services/prompts/prompt-read";
import {
  PROPOSE_NEW_PROMPT_TOOL,
  PROPOSE_PROMPT_UPDATE_TOOL,
} from "@/lib/proposals/types";

export function buildPromptTools(userId: string): ToolSet {
  void userId; // userId is carried by propose tools for attribution at approval time

  return {
    get_prompt: tool({
      description:
        "Fetch a prompt's fully resolved content by id or name. " +
        "Returns the published version's text (with nested references expanded and variables substituted). " +
        "Use this to read an existing prompt before reasoning about or proposing an update to it. " +
        "No approval required — this is a read-only operation.",
      inputSchema: z.object({
        id_or_name: z
          .string()
          .describe(
            "The prompt's cuid id OR its UPPERCASE_UNDERSCORE name (e.g. 'CANVAS_AGENT_SYSTEM_PROMPT').",
          ),
        variables: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Optional key/value map of variables to substitute into {{PLACEHOLDER}} tokens in the prompt text.",
          ),
      }),
      execute: async ({
        id_or_name,
        variables,
      }: {
        id_or_name: string;
        variables?: Record<string, string>;
      }) => {
        const result = await getResolvedPrompt(id_or_name, variables ?? {});
        if ("notFound" in result) {
          return { error: `Prompt '${id_or_name}' not found.` };
        }
        if ("error" in result) {
          return { error: result.error };
        }
        return {
          id: result.id,
          name: result.name,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          resolvedText: result.resolvedText,
          missingVariables: result.missingVariables,
        };
      },
    }),

    list_prompts: tool({
      description:
        "List all prompts in the shared library — id, name, description, updatedAt, and the " +
        "latest/published version number. Use this to discover a prompt's id or name before " +
        "calling get_prompt or propose_prompt_update. No approval required — this is read-only.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Optional keyword to filter prompts by name or description (case-insensitive)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum number of prompts to return (default 50, max 100)."),
      }),
      execute: async ({
        search,
        limit = 50,
      }: {
        search?: string;
        limit?: number;
      }) => {
        try {
          const prompts = await db.prompt.findMany({
            where: search
              ? {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { description: { contains: search, mode: "insensitive" } },
                  ],
                }
              : undefined,
            select: {
              id: true,
              name: true,
              description: true,
              updatedAt: true,
              publishedVersionId: true,
              versions: {
                select: { id: true, versionNumber: true },
                orderBy: { versionNumber: "desc" },
                take: 1,
              },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
          });

          return prompts.map((p) => {
            const latestVersion = p.versions[0];
            const isPublishedCurrent =
              latestVersion && p.publishedVersionId === latestVersion.id;
            return {
              id: p.id,
              name: p.name,
              description: p.description ?? null,
              updatedAt: p.updatedAt.toISOString(),
              latestVersionNumber: latestVersion?.versionNumber ?? null,
              publishedVersionId: p.publishedVersionId ?? null,
              isLatestPublished: isPublishedCurrent ?? false,
            };
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          return { error: `Failed to list prompts: ${msg}` };
        }
      },
    }),

    [PROPOSE_NEW_PROMPT_TOOL]: tool({
      description:
        "Propose creating a new prompt in the shared library. " +
        "Emits an approvable card in the canvas chat — the prompt is NOT created until the user approves. " +
        "Name must be UPPERCASE_UNDERSCORE format (e.g. 'MY_PROMPT_NAME'). " +
        "Use `list_prompts` first to verify the name doesn't already exist.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "Prompt name in UPPERCASE_UNDERSCORE format (e.g. 'CANVAS_AGENT_SYSTEM_PROMPT'). " +
            "Must match /^[A-Z][A-Z0-9_]*$/.",
          ),
        value: z
          .string()
          .describe("The full prompt text. May contain {{VARIABLE}} placeholders."),
        description: z
          .string()
          .optional()
          .describe("Short description of what this prompt does."),
        rationale: z
          .string()
          .optional()
          .describe("Why this prompt is being proposed — shown on the approval card."),
      }),
      execute: async ({
        name,
        value,
        description,
        rationale,
      }: {
        name: string;
        value: string;
        description?: string;
        rationale?: string;
      }) => {
        // Basic name validation up-front so the agent gets feedback before
        // the user has to approve (the full validation runs again in the
        // approval handler via mcpCreatePrompt).
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
          return {
            error:
              "Prompt name must be UPPERCASE_UNDERSCORE format (only uppercase letters, digits, and underscores, starting with a letter).",
          };
        }
        const proposalId = nanoid();
        return {
          kind: "promptCreate" as const,
          proposalId,
          payload: { name, value, description },
          ...(rationale && { rationale }),
        };
      },
    }),

    [PROPOSE_PROMPT_UPDATE_TOOL]: tool({
      description:
        "Propose updating the value and/or description of an existing prompt. " +
        "Emits an approvable card with a before/after diff — no new version is written until the user approves. " +
        "The approved update creates a new DRAFT version; it does NOT auto-publish. " +
        "Use `get_prompt` or `list_prompts` first to obtain the prompt's id.",
      inputSchema: z.object({
        prompt_id: z
          .string()
          .describe("The cuid id of the prompt to update (obtain via list_prompts or get_prompt)."),
        value: z
          .string()
          .describe(
            "The full proposed new value for the prompt. " +
            "Even for a description-only change, supply the current value unchanged here.",
          ),
        description: z
          .string()
          .optional()
          .describe("Updated description. Omit to leave the current description unchanged."),
        rationale: z
          .string()
          .optional()
          .describe("Why this change is being proposed — shown on the approval card."),
      }),
      execute: async ({
        prompt_id,
        value,
        description,
        rationale,
      }: {
        prompt_id: string;
        value: string;
        description?: string;
        rationale?: string;
      }) => {
        // Fetch the raw value of the version `get_prompt` would resolve
        // (published if set, else latest) so the diff "before" is consistent
        // with what the read tool reports. We intentionally do NOT use
        // getResolvedPrompt's resolvedText here — that is variable-substituted
        // and reference-inlined, making it a corrupt apples-to-oranges diff.
        const raw = await getRawPromptValue(prompt_id);
        if ("notFound" in raw) {
          return { error: `Prompt '${prompt_id}' not found.` };
        }
        if ("error" in raw) {
          return { error: raw.error };
        }

        const proposalId = nanoid();
        return {
          kind: "promptUpdate" as const,
          proposalId,
          payload: { promptId: prompt_id, value, description },
          meta: { oldStr: raw.value, newStr: value },
          ...(rationale && { rationale }),
        };
      },
    }),
  };
}
