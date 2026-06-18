/**
 * Shared utilities for parsing Stakwork run project-data transitions.
 *
 * The real Stakwork /projects/{id}.json response shape is:
 *   { success, data: { transitions: { key: {...}, ... }, connections, project } }
 *
 * This module normalises all three shapes seen in the wild:
 *   1. { data: { transitions: { … } } }          ← real Stakwork shape (was missing!)
 *   2. { workflowData: { transitions: { … } } }  ← legacy wrapped shape
 *   3. { transitions: { … } | [ … ] }            ← flat legacy fallback
 *
 * And corrects three additional bugs present in earlier code:
 *   a. keyed objects must be converted to arrays via Object.values()
 *   b. model/messages live in `raw_input_params`, not `request_params`
 *   c. LLM provider URL can be at transition top-level, not only under attributes
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
 * Priority order (first non-undefined wins):
 * 1. `data.transitions`       — real Stakwork /projects/{id}.json shape
 * 2. `workflowData.transitions` — legacy wrapped shape used in some contexts
 * 3. top-level `transitions`  — flat legacy fallback
 */
export function normalizeTransitions(projectData: unknown): TransitionStep[] {
  const pd = projectData as Record<string, unknown> | null | undefined;
  if (!pd || typeof pd !== "object" || Array.isArray(pd)) return [];

  // 1. Real Stakwork shape: { data: { transitions } }
  const fromData =
    pd.data && typeof pd.data === "object" && !Array.isArray(pd.data)
      ? (pd.data as Record<string, unknown>).transitions
      : undefined;

  // 2. Legacy wrapped shape: { workflowData: { transitions } }
  const fromWorkflowData =
    pd.workflowData && typeof pd.workflowData === "object" && !Array.isArray(pd.workflowData)
      ? (pd.workflowData as Record<string, unknown>).transitions
      : undefined;

  // 3. Flat fallback: top-level transitions
  const raw = fromData ?? fromWorkflowData ?? pd.transitions;

  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw as TransitionStep[];
  if (typeof raw === "object") return Object.values(raw as Record<string, unknown>) as TransitionStep[];
  return [];
}

export function inferProvider(url: string): string | null {
  for (const { pattern, provider } of LLM_API_PATTERNS) {
    if (url.includes(pattern)) return provider;
  }
  return null;
}

/**
 * Returns true if the transition represents an LLM provider API call.
 *
 * Checks the request URL from (in priority order):
 *   1. transition.url          — top-level (real Stakwork "Request" skill shape)
 *   2. transition.attributes.url
 *   3. transition.step.attributes.url
 */
export function isLlmStep(transition: TransitionStep): boolean {
  const topAttrs = transition?.attributes as Record<string, unknown> | undefined;
  const stepAttrs = (transition?.step as Record<string, unknown> | undefined)
    ?.attributes as Record<string, unknown> | undefined;

  const requestUrl =
    (transition?.url as string | undefined) ??
    (topAttrs?.url as string | undefined) ??
    (stepAttrs?.url as string | undefined) ??
    "";

  return LLM_API_PATTERNS.some(({ pattern }) => requestUrl.includes(pattern));
}

/** Replay body blob captured from runtime output for eval snapshot */
export interface ReplayBody {
  /** Prompt diff/change if available from output, otherwise null */
  prompt_change: string | null;
  /** Model name resolved from raw_input_params */
  model: string | null;
  /** JSON.stringify of the full output.response object */
  response_raw: string | null;
  /** Extracted text content from the response (untruncated) */
  output_text: string | null;
  /** finish_reason from choices[0] or null */
  finish_reason: string | null;
}

export interface ExtractedStep {
  stepId: string;
  name: string;
  model: string | null;
  provider: string | null;
  endpoint_url: string | null;
  preview: string | null;
  /** HTTP method resolved from transition or attributes */
  method: string | null;
  /** Messages array for snapshot — from raw_input_params.messages */
  messages: unknown[];
  /** Replay body blob assembled from runtime output */
  body: ReplayBody;
}

/**
 * Extract a structured step record from a raw transition object.
 *
 * URL/method resolution priority: top-level transition fields → attributes → step.attributes
 * Params resolution: raw_input_params (non-empty) → request_params fallback
 * Body blob: assembled from runtime output fields
 */
export function extractStepFromTransition(transition: TransitionStep): ExtractedStep {
  const topAttrs = transition?.attributes as Record<string, unknown> | undefined;
  const stepAttrs = (transition?.step as Record<string, unknown> | undefined)
    ?.attributes as Record<string, unknown> | undefined;

  // Resolve URL: top-level first (real Stakwork "Request" skill), then attributes
  const requestUrl =
    (transition?.url as string | undefined) ??
    (topAttrs?.url as string | undefined) ??
    (stepAttrs?.url as string | undefined) ??
    "";

  // Resolve method: top-level first, then attributes
  const method =
    (transition?.method as string | undefined) ??
    (topAttrs?.method as string | undefined) ??
    (stepAttrs?.method as string | undefined) ??
    null;

  // Resolve params: raw_input_params (non-empty) → request_params fallback
  const rawInputTop = topAttrs?.raw_input_params as Record<string, unknown> | undefined;
  const rawInputStep = stepAttrs?.raw_input_params as Record<string, unknown> | undefined;
  const reqParamsTop = topAttrs?.request_params as Record<string, unknown> | undefined;
  const reqParamsStep = stepAttrs?.request_params as Record<string, unknown> | undefined;

  // Use raw_input_params only when it has at least one key
  const resolvedParams =
    (rawInputTop && Object.keys(rawInputTop).length > 0 ? rawInputTop : undefined) ??
    (rawInputStep && Object.keys(rawInputStep).length > 0 ? rawInputStep : undefined) ??
    reqParamsTop ??
    reqParamsStep;

  const model = (resolvedParams?.model as string | undefined) ?? null;
  const messages = Array.isArray(resolvedParams?.messages)
    ? (resolvedParams!.messages as unknown[])
    : [];

  // Resolve output
  const outputTop = transition?.output as Record<string, unknown> | undefined;
  const response = outputTop?.response as Record<string, unknown> | undefined;

  // Extract text content (OpenAI choices or Anthropic content array)
  const rawText =
    (
      (response?.choices as Array<Record<string, unknown>> | undefined)?.[0]
        ?.message as Record<string, unknown> | undefined
    )?.content ??
    ((response?.content as Array<Record<string, unknown>> | undefined)?.[0]
      ?.text as string | undefined) ??
    null;

  const outputText = typeof rawText === "string" ? rawText : null;
  const preview = outputText ? outputText.slice(0, 120) : null;

  // finish_reason from OpenAI-style choices
  const finishReason =
    ((response?.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.finish_reason as string | undefined) ?? null;

  // Assemble replay body blob from runtime output
  const body: ReplayBody = {
    prompt_change: (outputTop?.prompt_change as string | undefined) ?? null,
    model,
    response_raw: response !== undefined ? JSON.stringify(response) : null,
    output_text: outputText,
    finish_reason: finishReason,
  };

  return {
    stepId: ((transition.id ?? transition.unique_id) as string | undefined) ?? "",
    name: ((transition.display_name ?? transition.name) as string | undefined) ?? "",
    model,
    provider: inferProvider(requestUrl),
    endpoint_url: requestUrl || null,
    preview,
    method,
    messages,
    body,
  };
}
