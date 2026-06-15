import { describe, test, expect } from "vitest";
import { extractAgentRoleName } from "@/lib/utils/agent-role";

describe("extractAgentRoleName", () => {
  test("strips random suffix after -agent", () => {
    expect(extractAgentRoleName("plan-agent-abc123")).toBe("plan-agent");
  });

  test("strips random suffix for other agent types", () => {
    expect(extractAgentRoleName("coder-agent-xyz")).toBe("coder-agent");
  });

  test("returns full string when no -agent pattern", () => {
    expect(extractAgentRoleName("researcher")).toBe("researcher");
  });

  test("returns unchanged when agent string ends exactly on -agent", () => {
    expect(extractAgentRoleName("plan-agent")).toBe("plan-agent");
  });
});
