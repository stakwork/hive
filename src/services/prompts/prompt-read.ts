/**
 * Prompt read service — DB-backed resolution for the MCP get_prompt tools.
 *
 * Owns:
 *   - Inline resolver (nested expansion + variable interpolation, cycle detection)
 *   - getResolvedPrompt      — published/live version by id or name
 *   - listPromptVersions     — full version list with published/current markers
 *   - getResolvedPromptVersion — specific version by id (IDOR-guarded)
 *
 * Auth is enforced at the MCP handler layer; prompts are global-scope (no workspace FK).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedPromptResult {
  id: string;
  name: string;
  versionId: string;
  versionNumber: number;
  resolvedText: string;
  missingVariables: string[];
}

export interface PromptVersionSummary {
  versionId: string;
  versionNumber: number;
  published: boolean;
  current: boolean;
  createdAt: Date;
}

type ResolveResult<T> = T | { notFound: true } | { error: string };

// ─── Inline Resolver ─────────────────────────────────────────────────────────

interface ResolvePromptTextParams {
  value: string;
  variables: Record<string, string>;
  /** Tracks the names currently in the recursion stack for cycle detection. */
  visitedNames?: Set<string>;
  /** Ordered list of visited names for human-readable cycle error messages. */
  visitedPath?: string[];
}

interface ResolveTextResult {
  text: string;
  missingVariables: string[];
  cycleError?: string;
}

/**
 * Resolves all `{{NAME}}` placeholders in `value`:
 *   1. If NAME matches a key in `variables`, substitute the value.
 *   2. Otherwise, attempt to look up NAME as a Prompt name in DB and recurse.
 *   3. If neither resolves, leave `{{NAME}}` intact and add to missingVariables.
 *
 * Cycle detection: if NAME is already in the recursion stack, returns a cycleError.
 */
async function resolvePromptText(
  params: ResolvePromptTextParams,
): Promise<ResolveTextResult> {
  const { value, variables, visitedNames = new Set(), visitedPath = [] } = params;
  const missingVariables: string[] = [];
  const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

  // Collect all unique placeholder names.
  const placeholderNames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
    placeholderNames.add(match[1]);
  }

  // Resolve each unique placeholder name once.
  const resolved = new Map<string, string>();
  for (const name of placeholderNames) {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      // Direct variable interpolation.
      resolved.set(name, variables[name]);
    } else {
      // Attempt to resolve as a nested prompt name.
      if (visitedNames.has(name)) {
        const cyclePath = [...visitedPath, name].join(" → ");
        return {
          text: value,
          missingVariables: [],
          cycleError: `circular prompt reference detected: ${cyclePath}`,
        };
      }

      const childPrompt = await db.prompt.findUnique({
        where: { name },
        select: {
          id: true,
          name: true,
          publishedVersionId: true,
          versions: {
            select: { id: true, versionNumber: true, value: true },
            orderBy: { versionNumber: "desc" },
          },
        },
      });

      if (!childPrompt) {
        // Not a prompt name either — leave placeholder intact.
        missingVariables.push(name);
        resolved.set(name, `{{${name}}}`);
      } else {
        // Pick published version or fall back to highest.
        const childVersion =
          childPrompt.versions.find((v) => v.id === childPrompt.publishedVersionId) ??
          childPrompt.versions[0];

        if (!childVersion) {
          missingVariables.push(name);
          resolved.set(name, `{{${name}}}`);
          continue;
        }

        // Recurse into the child prompt's value.
        const childResult = await resolvePromptText({
          value: childVersion.value,
          variables,
          visitedNames: new Set([...visitedNames, name]),
          visitedPath: [...visitedPath, name],
        });

        if (childResult.cycleError) {
          return { text: value, missingVariables: [], cycleError: childResult.cycleError };
        }

        resolved.set(name, childResult.text);
        for (const mv of childResult.missingVariables) {
          if (!missingVariables.includes(mv)) missingVariables.push(mv);
        }
      }
    }
  }

  // Replace all placeholders with resolved values.
  const text = value.replace(/\{\{([^}]+)\}\}/g, (_full, name: string) => {
    return resolved.get(name) ?? `{{${name}}}`;
  });

  return { text, missingVariables };
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetch a prompt by cuid id OR unique name and resolve its published/live version.
 * Falls back to the highest-numbered version when no publishedVersionId is set.
 */
export async function getResolvedPrompt(
  idOrName: string,
  variables: Record<string, string>,
): Promise<ResolveResult<ResolvedPromptResult>> {
  try {
    const prompt = await db.prompt.findFirst({
      where: { OR: [{ id: idOrName }, { name: idOrName }] },
      select: {
        id: true,
        name: true,
        publishedVersionId: true,
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!prompt) {
      logger.info("[prompt-read] getResolvedPrompt: prompt not found", "prompt-read", {
        idOrName,
      });
      return { notFound: true };
    }

    const version =
      prompt.versions.find((v) => v.id === prompt.publishedVersionId) ??
      prompt.versions[0];

    if (!version) {
      logger.info(
        "[prompt-read] getResolvedPrompt: no versions found",
        "prompt-read",
        { promptId: prompt.id, promptName: prompt.name },
      );
      return { notFound: true };
    }

    const resolveResult = await resolvePromptText({
      value: version.value,
      variables,
      visitedNames: new Set([prompt.name]),
      visitedPath: [prompt.name],
    });

    if (resolveResult.cycleError) {
      logger.warn(
        "[prompt-read] cycle detected",
        "prompt-read",
        { promptId: prompt.id, error: resolveResult.cycleError },
      );
      return { error: resolveResult.cycleError };
    }

    if (resolveResult.missingVariables.length > 0) {
      logger.info(
        "[prompt-read] getResolvedPrompt: missing variables",
        "prompt-read",
        {
          promptId: prompt.id,
          promptName: prompt.name,
          missingVariables: resolveResult.missingVariables,
        },
      );
    }

    return {
      id: prompt.id,
      name: prompt.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      resolvedText: resolveResult.text,
      missingVariables: resolveResult.missingVariables,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error("[prompt-read] getResolvedPrompt error", "prompt-read", { idOrName, error: msg });
    return { error: msg };
  }
}

/**
 * Fetch the raw (unresolved) value of the version that `getResolvedPrompt` would return —
 * i.e. the published version if set, else the highest-numbered version.
 * Used by `propose_prompt_update` to build the diff "before" value from the same
 * version anchor as `get_prompt` resolves, without variable substitution or reference inlining.
 */
export async function getRawPromptValue(
  idOrName: string,
): Promise<ResolveResult<{ id: string; name: string; versionId: string; versionNumber: number; value: string }>> {
  try {
    const prompt = await db.prompt.findFirst({
      where: { OR: [{ id: idOrName }, { name: idOrName }] },
      select: {
        id: true,
        name: true,
        publishedVersionId: true,
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!prompt) {
      return { notFound: true };
    }

    const version =
      prompt.versions.find((v) => v.id === prompt.publishedVersionId) ??
      prompt.versions[0];

    if (!version) {
      return { notFound: true };
    }

    return {
      id: prompt.id,
      name: prompt.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      value: version.value,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error("[prompt-read] getRawPromptValue error", "prompt-read", { idOrName, error: msg });
    return { error: msg };
  }
}

/**
 * List all versions of a prompt with published/current markers.
 * "current" = highest versionNumber. "published" = Prompt.publishedVersionId matches.
 */
export async function listPromptVersions(
  idOrName: string,
): Promise<ResolveResult<PromptVersionSummary[]>> {
  try {
    const prompt = await db.prompt.findFirst({
      where: { OR: [{ id: idOrName }, { name: idOrName }] },
      select: {
        id: true,
        publishedVersionId: true,
        versions: {
          select: { id: true, versionNumber: true, createdAt: true },
          orderBy: { versionNumber: "asc" },
        },
      },
    });

    if (!prompt) {
      logger.info("[prompt-read] listPromptVersions: prompt not found", "prompt-read", {
        idOrName,
      });
      return { notFound: true };
    }

    const maxVersionNumber = Math.max(...prompt.versions.map((v) => v.versionNumber), 0);

    return prompt.versions.map((v) => ({
      versionId: v.id,
      versionNumber: v.versionNumber,
      published: v.id === prompt.publishedVersionId,
      current: v.versionNumber === maxVersionNumber,
      createdAt: v.createdAt,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error("[prompt-read] listPromptVersions error", "prompt-read", { idOrName, error: msg });
    return { error: msg };
  }
}

/**
 * Fetch and resolve a specific version of a prompt.
 * IDOR guard: verifies versionId belongs to the prompt resolved from idOrName.
 */
export async function getResolvedPromptVersion(
  idOrName: string,
  versionId: string,
  variables: Record<string, string>,
): Promise<ResolveResult<ResolvedPromptResult>> {
  try {
    const prompt = await db.prompt.findFirst({
      where: { OR: [{ id: idOrName }, { name: idOrName }] },
      select: {
        id: true,
        name: true,
        publishedVersionId: true,
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!prompt) {
      logger.info(
        "[prompt-read] getResolvedPromptVersion: prompt not found",
        "prompt-read",
        { idOrName },
      );
      return { notFound: true };
    }

    // IDOR guard — versionId must belong to the resolved prompt.
    const version = prompt.versions.find((v) => v.id === versionId);
    if (!version) {
      logger.info(
        "[prompt-read] getResolvedPromptVersion: version not found",
        "prompt-read",
        { promptId: prompt.id, promptName: prompt.name, versionId },
      );
      return { notFound: true };
    }

    const resolveResult = await resolvePromptText({
      value: version.value,
      variables,
      visitedNames: new Set([prompt.name]),
      visitedPath: [prompt.name],
    });

    if (resolveResult.cycleError) {
      logger.warn(
        "[prompt-read] cycle detected in version",
        "prompt-read",
        { promptId: prompt.id, versionId, error: resolveResult.cycleError },
      );
      return { error: resolveResult.cycleError };
    }

    if (resolveResult.missingVariables.length > 0) {
      logger.info(
        "[prompt-read] getResolvedPromptVersion: missing variables",
        "prompt-read",
        {
          promptId: prompt.id,
          promptName: prompt.name,
          versionId,
          missingVariables: resolveResult.missingVariables,
        },
      );
    }

    return {
      id: prompt.id,
      name: prompt.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      resolvedText: resolveResult.text,
      missingVariables: resolveResult.missingVariables,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error("[prompt-read] getResolvedPromptVersion error", "prompt-read", {
      idOrName,
      versionId,
      error: msg,
    });
    return { error: msg };
  }
}
