/**
 * Scorer self-improvement agent.
 *
 * Given a ScorerInsight, runs an Anthropic tool-calling agent that edits the
 * workspace "description" — the context doc injected into coding agents'
 * system prompts. Edits are NOT applied directly; they are recorded as a
 * ScorerDescriptionProposal for human approval, then applied with exact
 * str_replace semantics against the live value.
 *
 * Uses generateText (not generateObject): the model must call the text-editor
 * tool in a loop (view -> str_replace). The "structured output" we persist is
 * derived from those tool calls, not a JSON schema.
 */

import { generateText, stepCountIs, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import {
  createInMemoryEditor,
  applyEdit,
  diffToEdits,
  type TextEditInput,
  type ProposedEdit,
} from "./editor";

const DOC_PATH = "workspace-description.md";

const SYSTEM_PROMPT = `You maintain the "workspace description" — a short context document that is injected directly into the system prompt of AI coding agents working in this workspace. Improving it makes those agents smarter immediately, with no code change or deploy.

You are given a scorer INSIGHT (an observed problem with agent behavior) and — when provided — OPERATOR GUIDANCE from a human.

PRIORITY OF INSTRUCTIONS:
1. When OPERATOR GUIDANCE is present it is your PRIMARY and OVERRIDING directive. Do exactly — and ONLY — what it asks. The insight is then BACKGROUND CONTEXT ONLY: if the operator addresses just one part of the insight (or something tangential to it), edit only that. Do NOT broaden the edit to cover the rest of the insight or the suggestion.
2. When there is NO operator guidance, address the insight itself: make the smallest, most surgical edit that durably resolves it.

Rules:
- Use the str_replace_based_edit_tool to view and edit the document.
- ALWAYS \`view\` the current document before editing it.
- Prefer \`str_replace\` for targeted changes; include enough surrounding context that old_str matches exactly once. Use \`create\` only when the document is empty.
- Keep edits concise and factual. Do NOT restructure or rewrite unrelated content. Add nothing beyond what the ACTIVE directive (operator guidance if present, otherwise the insight) calls for.
- Do NOT invent facts that aren't supported by the operator's guidance, the insight, or the repositories list.

When finished, briefly explain in plain text what you changed and why. If no edit is warranted, make no tool calls and explain why.`;

export interface ImprovementResult {
  proposalId: string | null;
  editCount: number;
  message: string;
}

export async function runImprovement({
  insightId,
  userPrompt,
}: {
  insightId: string;
  userPrompt?: string;
}): Promise<ImprovementResult> {
  const insight = await db.scorerInsight.findUniqueOrThrow({
    where: { id: insightId },
    select: {
      id: true,
      workspaceId: true,
      pattern: true,
      description: true,
      suggestion: true,
    },
  });

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: insight.workspaceId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      repositories: {
        select: {
          name: true,
          repositoryUrl: true,
          branch: true,
          description: true,
        },
      },
    },
  });

  const initial = workspace.description ?? "";
  const editor = createInMemoryEditor(initial);

  const repoList = workspace.repositories.length
    ? workspace.repositories
        .map(
          (r) =>
            `- ${r.name} (${r.repositoryUrl}${r.branch ? `, branch ${r.branch}` : ""})${r.description ? `: ${r.description}` : ""}`
        )
        .join("\n")
    : "(no repositories linked)";

  const directive = userPrompt
    ? [
        "OPERATOR GUIDANCE — PRIMARY DIRECTIVE. Do exactly and ONLY this:",
        userPrompt,
        "",
        "Treat the INSIGHT below as background context only. Address only what the operator guidance above asks — do NOT expand the edit to cover the rest of the insight or its suggestion.",
      ]
    : [
        "No operator guidance was provided — address the INSIGHT below directly.",
      ];

  const prompt = [
    ...directive,
    "",
    userPrompt ? "INSIGHT (background context only)" : "INSIGHT",
    `Pattern: ${insight.pattern}`,
    `Description: ${insight.description}`,
    `Suggestion: ${insight.suggestion}`,
    "",
    `WORKSPACE: ${workspace.name} (${workspace.slug})`,
    "REPOSITORIES:",
    repoList,
    "",
    `The workspace description document is available at "${DOC_PATH}". ${
      initial.length > 0
        ? "It currently has content — `view` it first, then make targeted `str_replace` edits."
        : "It is currently EMPTY — author it from scratch with the `create` command (do NOT use str_replace on an empty document)."
    }`,
  ].join("\n");

  const apiKey = getApiKeyForProvider("anthropic");
  const model = getModel("anthropic", apiKey, undefined, "sonnet");

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.3,
    stopWhen: stepCountIs(8),
    // Provider-defined tool; cast to ai's ToolSet to bridge the slightly
    // different `@ai-sdk/provider-utils` generic the anthropic package ships.
    tools: {
      str_replace_based_edit_tool: anthropic.tools.textEditor_20250728({
        execute: async (input) =>
          editor.exec({ ...(input as TextEditInput), path: DOC_PATH }),
      }),
    } as unknown as ToolSet,
  });

  const edits = editor.getEdits();
  const message = result.text?.trim() || "";

  if (edits.length === 0) {
    return {
      proposalId: null,
      editCount: 0,
      message: message || "The agent proposed no edits.",
    };
  }

  const proposal = await db.scorerDescriptionProposal.create({
    data: {
      workspaceId: workspace.id,
      insightId: insight.id,
      userPrompt: userPrompt || null,
      rationale: message || null,
      edits: edits as unknown as Prisma.InputJsonValue,
      beforePreview: initial,
      afterPreview: editor.getContent(),
      status: "PENDING",
    },
  });

  return { proposalId: proposal.id, editCount: edits.length, message };
}

/**
 * Apply a PENDING proposal to the live Workspace.description using exact
 * str_replace semantics. If the live value drifted such that any edit no
 * longer matches exactly once, mark the proposal CONFLICT and bail.
 */
export async function applyProposal(
  proposalId: string
): Promise<{ status: string; description?: string; error?: string }> {
  const proposal = await db.scorerDescriptionProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });

  if (proposal.status !== "PENDING") {
    return { status: proposal.status, error: "Proposal is not pending" };
  }

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: proposal.workspaceId },
    select: { description: true },
  });

  let live = workspace.description ?? "";
  const edits = proposal.edits as unknown as ProposedEdit[];

  for (const edit of edits) {
    const next = applyEdit(live, edit);
    if (next === null) {
      await db.scorerDescriptionProposal.update({
        where: { id: proposalId },
        data: { status: "CONFLICT" },
      });
      return {
        status: "CONFLICT",
        error:
          "The workspace description has changed; this proposal no longer applies cleanly.",
      };
    }
    live = next;
  }

  await db.$transaction([
    db.workspace.update({
      where: { id: proposal.workspaceId },
      data: { description: live },
    }),
    db.scorerDescriptionProposal.update({
      where: { id: proposalId },
      data: { status: "APPLIED", appliedAt: new Date() },
    }),
  ]);

  return { status: "APPLIED", description: live };
}

/**
 * Replace a PENDING proposal's edits with the human-edited final text.
 * Recomputes the minimal diff against the original (pre-edit) description so
 * the proposal still applies via exact str_replace, and refreshes the
 * afterPreview shown in the UI/history.
 */
export async function editProposal(
  proposalId: string,
  text: string
): Promise<{ status: string; editCount?: number; error?: string }> {
  const proposal = await db.scorerDescriptionProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });

  if (proposal.status !== "PENDING") {
    return { status: proposal.status, error: "Proposal is not pending" };
  }

  const edits = diffToEdits(proposal.beforePreview, text);

  await db.scorerDescriptionProposal.update({
    where: { id: proposalId },
    data: {
      edits: edits as unknown as Prisma.InputJsonValue,
      afterPreview: text,
    },
  });

  return { status: "PENDING", editCount: edits.length };
}

export async function rejectProposal(proposalId: string): Promise<void> {
  await db.scorerDescriptionProposal.update({
    where: { id: proposalId },
    data: { status: "REJECTED" },
  });
}
