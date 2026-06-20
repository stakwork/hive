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
  type TextEditInput,
  type ProposedEdit,
} from "./editor";

const DOC_PATH = "workspace-description.md";

const SYSTEM_PROMPT = `You maintain the "workspace description" — a short context document that is injected directly into the system prompt of AI coding agents working in this workspace. Improving it makes those agents smarter immediately, with no code change or deploy.

You are given a scorer INSIGHT describing an observed problem with agent behavior, plus optional guidance from a human operator. Make the SMALLEST, most surgical edit to the workspace description that durably addresses the insight — e.g. clarifying which repository contains which backend/service, noting constraints the agent cannot verify, or recording domain facts the agent repeatedly gets wrong.

Rules:
- Use the str_replace_based_edit_tool to view and edit the document.
- ALWAYS \`view\` the current document before editing it.
- Prefer \`str_replace\` for targeted changes; include enough surrounding context that old_str matches exactly once. Use \`create\` only when the document is empty.
- Keep edits concise and factual. Do NOT restructure or rewrite content unrelated to the insight.
- Do NOT invent facts that aren't supported by the insight, the repositories list, or the operator's guidance.

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

  const prompt = [
    "INSIGHT",
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
        ? "It currently has content — view it before editing."
        : "It is currently EMPTY."
    }`,
    "",
    userPrompt
      ? `OPERATOR GUIDANCE:\n${userPrompt}`
      : "No additional operator guidance was provided.",
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

export async function rejectProposal(proposalId: string): Promise<void> {
  await db.scorerDescriptionProposal.update({
    where: { id: proposalId },
    data: { status: "REJECTED" },
  });
}
