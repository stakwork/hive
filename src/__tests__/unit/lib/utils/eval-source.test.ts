import { describe, test, expect } from "vitest";
import { deriveEvalTriggerSource } from "@/lib/utils/eval-source";

describe("deriveEvalTriggerSource", () => {
  test('returns "repo_agent" when agentLogSource is "repo_agent" (even with Anthropic resolvedRequestUrl)', () => {
    expect(
      deriveEvalTriggerSource("repo_agent", "https://api.anthropic.com/v1/messages"),
    ).toBe("repo_agent");
  });

  test('returns "repo_agent" when agentLogSource is "repo_agent" with no resolvedRequestUrl', () => {
    expect(deriveEvalTriggerSource("repo_agent", undefined)).toBe("repo_agent");
  });

  test('returns "jamie_agent" when agentLogSource is "canvas_chat"', () => {
    expect(deriveEvalTriggerSource("canvas_chat", undefined)).toBe("jamie_agent");
  });

  test('returns "jamie_agent" when agentLogSource is "jamie_agent"', () => {
    expect(deriveEvalTriggerSource("jamie_agent", undefined)).toBe("jamie_agent");
  });

  test('returns "provider_direct" when agentLogSource is null and resolvedRequestUrl matches Anthropic', () => {
    expect(
      deriveEvalTriggerSource(null, "https://api.anthropic.com/v1/messages"),
    ).toBe("provider_direct");
  });

  test('returns "provider_direct" when agentLogSource is null and resolvedRequestUrl matches OpenAI', () => {
    expect(
      deriveEvalTriggerSource(null, "https://api.openai.com/v1/chat/completions"),
    ).toBe("provider_direct");
  });

  test('returns "provider_direct" when agentLogSource is undefined and resolvedRequestUrl matches a known LLM API', () => {
    expect(
      deriveEvalTriggerSource(undefined, "https://api.mistral.ai/v1/chat/completions"),
    ).toBe("provider_direct");
  });

  test('returns fallback "repo_agent" when agentLogSource is null and resolvedRequestUrl is undefined', () => {
    expect(deriveEvalTriggerSource(null, undefined)).toBe("repo_agent");
  });

  test('returns fallback "repo_agent" when agentLogSource is undefined and resolvedRequestUrl is undefined', () => {
    expect(deriveEvalTriggerSource(undefined, undefined)).toBe("repo_agent");
  });

  test('returns fallback "repo_agent" when agentLogSource is an unknown string and resolvedRequestUrl does not match', () => {
    expect(
      deriveEvalTriggerSource("github", "https://internal.company.com/llm"),
    ).toBe("repo_agent");
  });
});
