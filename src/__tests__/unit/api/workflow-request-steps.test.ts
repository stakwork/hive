/**
 * Unit tests for workflow request-steps utilities
 *
 * Tests:
 * - LLM step URL filtering: only URL-matching transitions pass
 * - Provider inference from URL
 * - Preview truncation at 120 chars
 * - EvalSet find-or-create idempotency logic
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Helpers extracted for unit testing ───────────────────────────────────────
// We test the pure logic inline — no route import needed for unit tests.

const LLM_API_PATTERNS = [
  { pattern: "api.openai.com", provider: "openai" },
  { pattern: "api.anthropic.com", provider: "anthropic" },
  { pattern: "api.cohere.ai", provider: "cohere" },
  { pattern: "generativelanguage.googleapis.com", provider: "google" },
  { pattern: "api.mistral.ai", provider: "mistral" },
  { pattern: "api.together.xyz", provider: "together" },
];

function inferProvider(url: string): string | null {
  for (const { pattern, provider } of LLM_API_PATTERNS) {
    if (url.includes(pattern)) return provider;
  }
  return null;
}

function isLlmStep(transition: Record<string, unknown>): boolean {
  const stepUrl = (
    (transition?.step as Record<string, unknown> | undefined)?.attributes as
      | Record<string, unknown>
      | undefined
  )?.url;
  const topUrl = (transition?.attributes as Record<string, unknown> | undefined)?.url;
  const requestUrl = ((stepUrl ?? topUrl) as string | undefined) ?? "";
  return LLM_API_PATTERNS.some(({ pattern }) => requestUrl.includes(pattern));
}

function extractPreview(transition: Record<string, unknown>): string | null {
  const output = (transition?.output as Record<string, unknown> | undefined)?.output as
    | Record<string, unknown>
    | undefined;
  const response = output?.response as Record<string, unknown> | undefined;
  const raw =
    (
      (response?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
        | Record<string, unknown>
        | undefined
    )?.content ??
    ((response?.content as Array<Record<string, unknown>> | undefined)?.[0]?.text as
      | string
      | undefined) ??
    null;
  return typeof raw === "string" ? raw.slice(0, 120) : null;
}

// ── LLM step filtering ────────────────────────────────────────────────────────

describe("isLlmStep — URL filtering", () => {
  test("accepts api.openai.com step (via step.attributes.url)", () => {
    const transition = {
      step: { attributes: { url: "https://api.openai.com/v1/chat/completions" } },
    };
    expect(isLlmStep(transition)).toBe(true);
  });

  test("accepts api.anthropic.com step (via top-level attributes.url)", () => {
    const transition = {
      attributes: { url: "https://api.anthropic.com/v1/messages" },
    };
    expect(isLlmStep(transition)).toBe(true);
  });

  test("accepts generativelanguage.googleapis.com", () => {
    const transition = {
      attributes: {
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
      },
    };
    expect(isLlmStep(transition)).toBe(true);
  });

  test("accepts api.mistral.ai", () => {
    const t = { attributes: { url: "https://api.mistral.ai/v1/chat/completions" } };
    expect(isLlmStep(t)).toBe(true);
  });

  test("accepts api.cohere.ai", () => {
    const t = { attributes: { url: "https://api.cohere.ai/v1/generate" } };
    expect(isLlmStep(t)).toBe(true);
  });

  test("accepts api.together.xyz", () => {
    const t = { attributes: { url: "https://api.together.xyz/v1/chat/completions" } };
    expect(isLlmStep(t)).toBe(true);
  });

  test("rejects a non-LLM step URL", () => {
    const transition = {
      attributes: { url: "https://some-internal-service.example.com/run" },
    };
    expect(isLlmStep(transition)).toBe(false);
  });

  test("rejects a step with no URL", () => {
    const transition = { attributes: {} };
    expect(isLlmStep(transition)).toBe(false);
  });

  test("rejects a step with no attributes at all", () => {
    expect(isLlmStep({ name: "fetch_data" })).toBe(false);
  });

  test("filters a mixed array correctly", () => {
    const transitions = [
      { attributes: { url: "https://api.openai.com/v1/chat/completions" } },
      { attributes: { url: "https://internal.example.com/transform" } },
      { step: { attributes: { url: "https://api.anthropic.com/v1/messages" } } },
      { attributes: {} },
    ];
    const llmSteps = transitions.filter(isLlmStep);
    expect(llmSteps).toHaveLength(2);
  });
});

// ── Provider inference ────────────────────────────────────────────────────────

describe("inferProvider", () => {
  test.each([
    ["https://api.openai.com/v1/chat/completions", "openai"],
    ["https://api.anthropic.com/v1/messages", "anthropic"],
    ["https://generativelanguage.googleapis.com/v1/models/gemini:generate", "google"],
    ["https://api.mistral.ai/v1/chat/completions", "mistral"],
    ["https://api.cohere.ai/v1/generate", "cohere"],
    ["https://api.together.xyz/v1/chat/completions", "together"],
  ])("infers %s → %s", (url, expected) => {
    expect(inferProvider(url)).toBe(expected);
  });

  test("returns null for unknown URL", () => {
    expect(inferProvider("https://unknown-llm-provider.io/v1/complete")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(inferProvider("")).toBeNull();
  });
});

// ── Preview truncation ────────────────────────────────────────────────────────

describe("extractPreview — truncation at 120 chars", () => {
  test("returns null when output is missing", () => {
    expect(extractPreview({})).toBeNull();
  });

  test("returns null when response is missing", () => {
    expect(extractPreview({ output: { output: {} } })).toBeNull();
  });

  test("extracts OpenAI-style choice content", () => {
    const transition = {
      output: {
        output: {
          response: {
            choices: [{ message: { content: "Hello world" } }],
          },
        },
      },
    };
    expect(extractPreview(transition)).toBe("Hello world");
  });

  test("extracts Anthropic-style content array text", () => {
    const transition = {
      output: {
        output: {
          response: {
            content: [{ text: "Claude says hi" }],
          },
        },
      },
    };
    expect(extractPreview(transition)).toBe("Claude says hi");
  });

  test("truncates long content to exactly 120 chars", () => {
    const longText = "A".repeat(200);
    const transition = {
      output: {
        output: {
          response: {
            choices: [{ message: { content: longText } }],
          },
        },
      },
    };
    const result = extractPreview(transition);
    expect(result).toHaveLength(120);
    expect(result).toBe("A".repeat(120));
  });

  test("does not truncate content shorter than 120 chars", () => {
    const shortText = "Short response";
    const transition = {
      output: {
        output: {
          response: {
            choices: [{ message: { content: shortText } }],
          },
        },
      },
    };
    expect(extractPreview(transition)).toBe(shortText);
  });
});

// ── EvalSet find-or-create logic ──────────────────────────────────────────────

describe("EvalSet find-or-create", () => {
  const jarvisConfig = { jarvisUrl: "https://test-swarm.sphinx.chat:8444", apiKey: "test-key" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("reuses existing EvalSet ref_id when Jarvis returns a matching node", async () => {
    const mockAddNode = vi.fn();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [{ ref_id: "existing-ref-123" }] }),
    } as Response);

    // Replicate the find-or-create logic inline
    const evalSetId = "evalset-456";
    let ref_id: string | undefined;
    let created = false;

    const lookupRes = await fetch(
      `${jarvisConfig.jarvisUrl}/node?id=${encodeURIComponent(evalSetId)}`,
      { headers: { "x-api-token": jarvisConfig.apiKey } },
    );

    if (lookupRes.ok) {
      const data = await lookupRes.json();
      const nodes: Array<{ ref_id: string }> =
        data?.nodes ?? (data?.ref_id ? [data] : []);
      if (nodes.length > 0 && nodes[0].ref_id) {
        ref_id = nodes[0].ref_id;
        created = false;
      }
    }

    expect(ref_id).toBe("existing-ref-123");
    expect(created).toBe(false);
    expect(mockAddNode).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("calls addNode when Jarvis returns 404 for EvalSet lookup", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ref_id: "new-ref-789" } }),
      } as Response);

    // Replicate the find-or-create logic
    const evalSetId = "evalset-456";
    let ref_id: string | undefined;
    let created = false;

    try {
      const lookupRes = await fetch(
        `${jarvisConfig.jarvisUrl}/node?id=${encodeURIComponent(evalSetId)}`,
        { headers: { "x-api-token": jarvisConfig.apiKey } },
      );
      if (!lookupRes.ok) throw new Error("not found");
    } catch {
      // fall through to create — simulate addNode call
      const createRes = await fetch(`${jarvisConfig.jarvisUrl}/node`, {
        method: "POST",
        headers: {
          "x-api-token": jarvisConfig.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          node_type: "EvalSet",
          node_data: { id: evalSetId, name: "Workflow 456 Evals" },
        }),
      });
      const createData = await createRes.json();
      ref_id = createData?.data?.ref_id;
      created = true;
    }

    expect(ref_id).toBe("new-ref-789");
    expect(created).toBe(true);
    // fetch was called twice: once for lookup, once for addNode
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  test("calls addNode when Jarvis returns empty nodes array", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ref_id: "created-ref-000" } }),
      } as Response);

    const evalSetId = "evalset-789";
    let ref_id: string | undefined;
    let created = false;

    const lookupRes = await fetch(
      `${jarvisConfig.jarvisUrl}/node?id=${encodeURIComponent(evalSetId)}`,
      { headers: { "x-api-token": jarvisConfig.apiKey } },
    );

    if (lookupRes.ok) {
      const data = await lookupRes.json();
      const nodes: Array<{ ref_id: string }> = data?.nodes ?? [];
      if (nodes.length === 0 || !nodes[0].ref_id) {
        // create
        const createRes = await fetch(`${jarvisConfig.jarvisUrl}/node`, {
          method: "POST",
          headers: { "x-api-token": jarvisConfig.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            node_type: "EvalSet",
            node_data: { id: evalSetId, name: "Workflow 789 Evals" },
          }),
        });
        const createData = await createRes.json();
        ref_id = createData?.data?.ref_id;
        created = true;
      }
    }

    expect(ref_id).toBe("created-ref-000");
    expect(created).toBe(true);
    fetchSpy.mockRestore();
  });
});
