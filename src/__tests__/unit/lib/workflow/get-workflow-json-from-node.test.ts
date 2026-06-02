// @vitest-environment node
import { describe, test, expect } from "vitest";
import { getWorkflowJsonFromNode } from "@/lib/workflow/get-workflow-json-from-node";

describe("getWorkflowJsonFromNode", () => {
  test("returns properties.body string value", () => {
    const node = { properties: { body: '{"transitions":[]}' } };
    expect(getWorkflowJsonFromNode(node)).toBe('{"transitions":[]}');
  });

  test("JSON.stringifies properties.body when it is an object", () => {
    const node = { properties: { body: { transitions: [] } } };
    expect(getWorkflowJsonFromNode(node)).toBe('{"transitions":[]}');
  });

  test("returns properties.workflow_json when body is absent", () => {
    const node = { properties: { workflow_json: '{"nodes":[]}' } };
    expect(getWorkflowJsonFromNode(node)).toBe('{"nodes":[]}');
  });

  test("returns bare workflow_json when properties is absent", () => {
    const node = { workflow_json: '{"steps":[]}' };
    expect(getWorkflowJsonFromNode(node)).toBe('{"steps":[]}');
  });

  test("prefers properties.body over properties.workflow_json", () => {
    const node = {
      properties: {
        body: '{"from":"body"}',
        workflow_json: '{"from":"workflow_json"}',
      },
    };
    expect(getWorkflowJsonFromNode(node)).toBe('{"from":"body"}');
  });

  test("returns undefined for null node", () => {
    expect(getWorkflowJsonFromNode(null)).toBeUndefined();
  });

  test("returns undefined for undefined node", () => {
    expect(getWorkflowJsonFromNode(undefined)).toBeUndefined();
  });

  test("returns undefined for empty properties", () => {
    const node = { properties: {} };
    expect(getWorkflowJsonFromNode(node)).toBeUndefined();
  });
});
