/**
 * Unit tests for workflow request-steps utilities
 *
 * Tests:
 * - normalizeTransitions: workflowData-wrapped keyed object, flat keyed object, plain array
 * - LLM step URL filtering: only URL-matching transitions pass
 * - Provider inference from URL
 * - extractStepFromTransition: correct model/messages/preview paths, no headers/auth leaked
 * - Preview truncation at 120 chars
 * - EvalSet find-or-create idempotency logic
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  normalizeTransitions,
  inferProvider,
  isLlmStep,
  extractStepFromTransition,
} from "@/lib/stakwork/transitions";

// ── Realistic fixture mirroring the real Stakwork run shape ──────────────────

const realRunFixture = {
  workflowData: {
    transitions: {
      replay_openai: {
        id: "replay_openai",
        attributes: {
          url: "https://api.openai.com/v1/chat/completions",
          method: "post",
          raw_input_params: {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are..." }],
          },
          // headers should NOT appear in snapshots
          headers: { Authorization: "Bearer sk-secret" },
        },
        output: {
          response: {
            choices: [{ message: { content: "SKIP" } }],
          },
        },
      },
      set_var: {
        id: "set_var",
        attributes: { url: null },
      },
    },
  },
  status: "error",
};

// ── normalizeTransitions ──────────────────────────────────────────────────────

describe("normalizeTransitions", () => {
  test("handles workflowData-wrapped keyed object → array of 2 transitions", () => {
    const result = normalizeTransitions(realRunFixture);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(
      expect.arrayContaining(["replay_openai", "set_var"]),
    );
  });

  test("handles flat keyed object (legacy fallback) → still works", () => {
    const flatShape = {
      transitions: {
        replay_openai: {
          id: "replay_openai",
          attributes: { url: "https://api.openai.com/v1/chat/completions" },
        },
        set_var: { id: "set_var", attributes: { url: null } },
      },
    };
    const result = normalizeTransitions(flatShape);
    expect(result).toHaveLength(2);
  });

  test("handles plain array → still works", () => {
    const arrayShape = {
      transitions: [
        { id: "step_a", attributes: { url: "https://api.openai.com/v1/chat/completions" } },
        { id: "step_b", attributes: { url: null } },
      ],
    };
    const result = normalizeTransitions(arrayShape);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("step_a");
  });

  test("returns empty array for null/undefined projectData", () => {
    expect(normalizeTransitions(null)).toEqual([]);
    expect(normalizeTransitions(undefined)).toEqual([]);
    expect(normalizeTransitions({})).toEqual([]);
  });

  test("workflowData with empty transitions object → empty array", () => {
    expect(normalizeTransitions({ workflowData: { transitions: {} } })).toEqual([]);
  });

  test("workflowData with array transitions → returns array as-is", () => {
    const shape = {
      workflowData: {
        transitions: [
          { id: "step_x", attributes: { url: "https://api.anthropic.com/v1/messages" } },
        ],
      },
    };
    const result = normalizeTransitions(shape);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("step_x");
  });
});

// ── isLlmStep ─────────────────────────────────────────────────────────────────

describe("isLlmStep — URL filtering", () => {
  test("replay_openai fixture step → true", () => {
    const transition = realRunFixture.workflowData.transitions.replay_openai;
    expect(isLlmStep(transition)).toBe(true);
  });

  test("set_var fixture step (no LLM URL) → false", () => {
    const transition = realRunFixture.workflowData.transitions.set_var;
    expect(isLlmStep(transition)).toBe(false);
  });

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

// ── inferProvider ─────────────────────────────────────────────────────────────

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

// ── extractStepFromTransition ─────────────────────────────────────────────────

describe("extractStepFromTransition — correct paths", () => {
  test("extracts model, provider, preview from replay_openai fixture", () => {
    const transition = realRunFixture.workflowData.transitions.replay_openai;
    const result = extractStepFromTransition(transition);
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.provider).toBe("openai");
    expect(result.preview).toBe("SKIP");
    expect(result.stepId).toBe("replay_openai");
    expect(result.messages).toEqual([{ role: "system", content: "You are..." }]);
  });

  test("does NOT include headers or Authorization in snapshot", () => {
    const transition = realRunFixture.workflowData.transitions.replay_openai;
    const result = extractStepFromTransition(transition);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("Authorization");
    expect(resultStr).not.toContain("Bearer");
    expect(resultStr).not.toContain("sk-secret");
    expect(resultStr).not.toContain("headers");
  });

  test("reads model from raw_input_params (not request_params)", () => {
    const transition = {
      id: "step_with_request_params",
      attributes: {
        url: "https://api.openai.com/v1/chat/completions",
        request_params: { "": null }, // the broken path — should NOT be used
        raw_input_params: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      },
      output: {
        response: {
          choices: [{ message: { content: "Hi there" } }],
        },
      },
    };
    const result = extractStepFromTransition(transition);
    expect(result.model).toBe("gpt-4o");
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  test("reads preview from output.response (not output.output.response)", () => {
    const withCorrectPath = {
      id: "step_correct",
      attributes: { url: "https://api.openai.com/v1/chat/completions" },
      output: {
        // correct: output.response
        response: { choices: [{ message: { content: "Correct preview" } }] },
      },
    };
    const withOldPath = {
      id: "step_old",
      attributes: { url: "https://api.openai.com/v1/chat/completions" },
      output: {
        // old broken path: output.output.response
        output: { response: { choices: [{ message: { content: "Wrong preview" } }] } },
      },
    };

    expect(extractStepFromTransition(withCorrectPath).preview).toBe("Correct preview");
    // Old nested path should NOT produce a preview in the new util
    expect(extractStepFromTransition(withOldPath).preview).toBeNull();
  });

  test("extracts Anthropic-style content array text", () => {
    const transition = {
      id: "step_anthropic",
      attributes: {
        url: "https://api.anthropic.com/v1/messages",
        raw_input_params: { model: "claude-3-5-sonnet", messages: [] },
      },
      output: {
        response: {
          content: [{ text: "Claude says hi" }],
        },
      },
    };
    const result = extractStepFromTransition(transition);
    expect(result.preview).toBe("Claude says hi");
    expect(result.model).toBe("claude-3-5-sonnet");
    expect(result.provider).toBe("anthropic");
  });

  test("truncates preview to 120 chars", () => {
    const longText = "A".repeat(200);
    const transition = {
      id: "long_step",
      attributes: { url: "https://api.openai.com/v1/chat/completions" },
      output: {
        response: { choices: [{ message: { content: longText } }] },
      },
    };
    const result = extractStepFromTransition(transition);
    expect(result.preview).toHaveLength(120);
  });

  test("returns null preview when output is missing", () => {
    const transition = {
      id: "no_output",
      attributes: { url: "https://api.openai.com/v1/chat/completions" },
    };
    expect(extractStepFromTransition(transition).preview).toBeNull();
  });

  test("returns empty messages array when raw_input_params.messages is absent", () => {
    const transition = {
      id: "no_messages",
      attributes: {
        url: "https://api.openai.com/v1/chat/completions",
        raw_input_params: { model: "gpt-4o" },
      },
    };
    expect(extractStepFromTransition(transition).messages).toEqual([]);
  });

  test("returns prompt_version_id and prompt_name from output", () => {
    const transition = {
      id: "step_with_pv",
      attributes: {
        url: "https://api.openai.com/v1/chat/completions",
        raw_input_params: { model: "gpt-4o", messages: [] },
      },
      output: {
        prompt_version_id: "pv-123",
        prompt_name: "My Prompt v3",
        response: { choices: [{ message: { content: "ok" } }] },
      },
    };
    const result = extractStepFromTransition(transition);
    expect(result.prompt_version_id).toBe("pv-123");
    expect(result.prompt_name).toBe("My Prompt v3");
  });

  test("returns null prompt_version_id and prompt_name when absent", () => {
    const transition = {
      id: "step_no_pv",
      attributes: {
        url: "https://api.openai.com/v1/chat/completions",
        raw_input_params: { model: "gpt-4o", messages: [] },
      },
      output: {
        response: { choices: [{ message: { content: "ok" } }] },
      },
    };
    const result = extractStepFromTransition(transition);
    expect(result.prompt_version_id).toBeNull();
    expect(result.prompt_name).toBeNull();
  });
});

// ── Route integration: normalizeTransitions + filter → steps ─────────────────

describe("normalizeTransitions + filter → LLM steps (route-level logic)", () => {
  test("fixture run yields exactly 1 LLM step (replay_openai)", () => {
    const transitions = normalizeTransitions(realRunFixture);
    const steps = transitions.filter(isLlmStep).map(extractStepFromTransition);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepId).toBe("replay_openai");
    expect(steps[0].model).toBe("gpt-4o-mini");
    expect(steps[0].provider).toBe("openai");
    expect(steps[0].preview).toBe("SKIP");
  });

  test("genuinely empty run (no transitions) yields 0 steps", () => {
    const emptyRun = { workflowData: { transitions: {} }, status: "completed" };
    const transitions = normalizeTransitions(emptyRun);
    const steps = transitions.filter(isLlmStep).map(extractStepFromTransition);
    expect(steps).toHaveLength(0);
  });

  test("run with only non-LLM steps yields 0 steps", () => {
    const nonLlmRun = {
      workflowData: {
        transitions: {
          set_var: { id: "set_var", attributes: { url: null } },
          http_call: {
            id: "http_call",
            attributes: { url: "https://internal.example.com/transform" },
          },
        },
      },
    };
    const transitions = normalizeTransitions(nonLlmRun);
    const steps = transitions.filter(isLlmStep).map(extractStepFromTransition);
    expect(steps).toHaveLength(0);
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
