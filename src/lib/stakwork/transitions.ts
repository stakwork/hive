/**
 * Shared utilities for parsing Stakwork run project-data transitions.
 *
 * Stakwork returns: { workflowData: { transitions: { key: {...}, ... } }, status }
 * Both `request-steps` and `eval/capture` routes previously read
 * top-level `projectData.transitions` (always undefined) and assumed an array.
 * This module corrects all three bugs:
 *   1. Unwrap `workflowData` before reading transitions
 *   2. Convert keyed object → array via Object.values()
 *   3. Read model/messages from `raw_input_params` (not `request_params`)
 *      and preview from `output.response` (not `output.output.response`)
 */

/** LLM provider API URL patterns */
export const LLM_API_PATTERNS: Array<{ pattern: string; provider: string }> = [
  { pattern: "api.openai.com", provider: "openai" },
  { pattern: "api.anthropic.com", provider: "anthropic" },
  { pattern: "api.cohere.ai", provider: "cohere" },
  { pattern: "generativelanguage.googleapis.com", provider: "google" },
  { pattern: "api.mistral.ai", provider: "mistral" },
  { pattern: "api.together.xyz", provider: "together" },
];

export type TransitionStep = Record<string, unknown>;

/**
 * Normalize the transitions from a Stakwork project JSON payload into a flat array.
 *
 * Handles:
 * - `{ workflowData: { transitions: { key: step, ... } } }` (real Stakwork shape)
 * - `{ transitions: { key: step, ... } }` (legacy flat shape)
 * - `{ transitions: [ ... ] }` (already an array)
 */
export function normalizeTransitions(projectData: unknown): TransitionStep[] {
  const raw =
    (projectData as Record<string, unknown> | null | undefined)?.workflowData &&
    typeof (projectData as Record<string, unknown>).workflowData === "object"
      ? ((projectData as Record<string, unknown>).workflowData as Record<string, unknown>)
          ?.transitions
      : undefined;

  const fallback =
    raw !== undefined
      ? raw
      : (projectData as Record<string, unknown> | null | undefined)?.transitions;

  if (fallback === undefined || fallback === null) {
    return [];
  }

  if (Array.isArray(fallback)) {
    return fallback as TransitionStep[];
  }

  if (typeof fallback === "object") {
    return Object.values(fallback as Record<string, unknown>) as TransitionStep[];
  }

  return [];
}

export function inferProvider(url: string): string | null {
  for (const { pattern, provider } of LLM_API_PATTERNS) {
    if (url.includes(pattern)) return provider;
  }
  return null;
}

export function isLlmStep(transition: TransitionStep): boolean {
  const topAttrs = transition?.attributes as Record<string, unknown> | undefined;
  const stepAttrs = (transition?.step as Record<string, unknown> | undefined)
    ?.attributes as Record<string, unknown> | undefined;
  const requestUrl = ((topAttrs?.url ?? stepAttrs?.url) as string | undefined) ?? "";
  return LLM_API_PATTERNS.some(({ pattern }) => requestUrl.includes(pattern));
}

export interface ExtractedStep {
  stepId: string;
  name: string;
  model: string | null;
  provider: string | null;
  endpoint_url: string | null;
  preview: string | null;
  /** Messages array for snapshot — from raw_input_params.messages */
  messages: unknown[];
}

export function extractStepFromTransition(transition: TransitionStep): ExtractedStep {
  const topAttrs = transition?.attributes as Record<string, unknown> | undefined;
  const stepAttrs = (transition?.step as Record<string, unknown> | undefined)
    ?.attributes as Record<string, unknown> | undefined;

  const requestUrl = ((topAttrs?.url ?? stepAttrs?.url) as string | undefined) ?? "";

  // Fix: model & messages live under raw_input_params, NOT request_params
  const rawInputParams = (topAttrs?.raw_input_params ??
    stepAttrs?.raw_input_params) as Record<string, unknown> | undefined;

  const model = (rawInputParams?.model as string | undefined) ?? null;
  const messages = Array.isArray(rawInputParams?.messages)
    ? (rawInputParams!.messages as unknown[])
    : [];

  // Fix: preview is at output.response, NOT output.output.response
  const outputTop = transition?.output as Record<string, unknown> | undefined;
  const response = outputTop?.response as Record<string, unknown> | undefined;

  const rawPreview =
    (
      (response?.choices as Array<Record<string, unknown>> | undefined)?.[0]
        ?.message as Record<string, unknown> | undefined
    )?.content ??
    ((response?.content as Array<Record<string, unknown>> | undefined)?.[0]
      ?.text as string | undefined) ??
    null;

  const preview = typeof rawPreview === "string" ? rawPreview.slice(0, 120) : null;

  return {
    stepId: ((transition.unique_id ?? transition.id) as string | undefined) ?? "",
    name: ((transition.display_name ?? transition.name) as string | undefined) ?? "",
    model,
    provider: inferProvider(requestUrl),
    endpoint_url: requestUrl || null,
    preview,
    messages,
  };
}
