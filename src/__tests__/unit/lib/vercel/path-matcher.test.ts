import { describe, test, expect } from "vitest";
import { convertPathToPattern, matchPathToEndpoint, type EndpointNode } from "@/lib/vercel/path-matcher";

describe("convertPathToPattern", () => {
  test("should convert numeric ID segments to [id] pattern", () => {
    const patterns = convertPathToPattern("/api/users/123");
    expect(patterns).toContain("/api/users/[id]");
  });

  test("should convert UUID segments to dynamic patterns", () => {
    const patterns = convertPathToPattern("/api/tasks/550e8400-e29b-41d4-a716-446655440000");
    expect(patterns.some((p) => p.includes("["))).toBe(true);
  });

  test("should convert kebab-case segments to [slug] pattern", () => {
    const patterns = convertPathToPattern("/api/workspaces/my-workspace/tasks");
    expect(patterns.some((p) => p.includes("workspaces/["))).toBe(true);
  });

  test("should convert CUID segments to dynamic patterns", () => {
    const patterns = convertPathToPattern("/api/users/cl1234567890abcdefghijk");
    expect(patterns.some((p) => p.includes("["))).toBe(true);
  });

  test("should handle multiple dynamic segments", () => {
    const patterns = convertPathToPattern("/api/users/123/posts/456");
    expect(patterns.some((p) => p.includes("/users/[") && p.includes("/posts/["))).toBe(true);
  });

  test("should keep static segments unchanged", () => {
    const patterns = convertPathToPattern("/api/health");
    expect(patterns).toContain("/api/health");
  });

  test("should handle paths without leading slash", () => {
    const patterns = convertPathToPattern("api/users/123");
    expect(patterns.some((p) => p.startsWith("/"))).toBe(true);
  });

  test("should generate multiple pattern variations", () => {
    const patterns = convertPathToPattern("/api/users/123");
    // Should have variations with different dynamic segment names
    expect(patterns.length).toBeGreaterThan(1);
  });

  test("should sort patterns by specificity (fewer dynamic segments first)", () => {
    const patterns = convertPathToPattern("/api/users/123/posts/456");
    const dynamicCounts = patterns.map((p) => (p.match(/\[/g) || []).length);

    // Verify sorted order (ascending dynamic segment count)
    for (let i = 1; i < dynamicCounts.length; i++) {
      expect(dynamicCounts[i]).toBeGreaterThanOrEqual(dynamicCounts[i - 1]);
    }
  });

  test("should handle root path", () => {
    const patterns = convertPathToPattern("/");
    expect(patterns).toContain("/");
  });

  test("should handle empty string", () => {
    const patterns = convertPathToPattern("");
    expect(patterns).toContain("/");
  });

  test("should remove trailing slashes", () => {
    const patterns = convertPathToPattern("/api/users/123/");
    expect(patterns.every((p) => !p.endsWith("/") || p === "/")).toBe(true);
  });
});

describe("matchPathToEndpoint", () => {
  const createMockNode = (name: string, refId: string): EndpointNode => ({
    name,
    file: `src/app${name}/route.ts`,
    ref_id: refId,
  });

  test("should match exact path", () => {
    const nodes = [createMockNode("/api/health", "node-1"), createMockNode("/api/users", "node-2")];

    const matched = matchPathToEndpoint("/api/health", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match dynamic path with numeric ID", () => {
    const nodes = [createMockNode("/api/users/[id]", "node-1"), createMockNode("/api/posts", "node-2")];

    const matched = matchPathToEndpoint("/api/users/123", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match dynamic path with slug", () => {
    const nodes = [createMockNode("/api/workspaces/[slug]/tasks", "node-1"), createMockNode("/api/tasks", "node-2")];

    const matched = matchPathToEndpoint("/api/workspaces/my-workspace/tasks", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match path with UUID", () => {
    const nodes = [createMockNode("/api/tasks/[id]", "node-1")];

    const matched = matchPathToEndpoint("/api/tasks/550e8400-e29b-41d4-a716-446655440000", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match path with CUID", () => {
    const nodes = [createMockNode("/api/users/[id]", "node-1")];

    const matched = matchPathToEndpoint("/api/users/cl1234567890abcdefghijk", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should prefer exact match over pattern match", () => {
    const nodes = [createMockNode("/api/users/123", "exact-match"), createMockNode("/api/users/[id]", "pattern-match")];

    const matched = matchPathToEndpoint("/api/users/123", nodes);
    expect(matched?.ref_id).toBe("exact-match");
  });

  test("should return null when no match found", () => {
    const nodes = [createMockNode("/api/health", "node-1")];

    const matched = matchPathToEndpoint("/api/unknown", nodes);
    expect(matched).toBeNull();
  });

  test("should handle trailing slash normalization", () => {
    const nodes = [createMockNode("/api/health", "node-1")];

    const matched = matchPathToEndpoint("/api/health/", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should handle path without leading slash", () => {
    const nodes = [createMockNode("/api/health", "node-1")];

    const matched = matchPathToEndpoint("api/health", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match case-insensitively as fallback", () => {
    const nodes = [createMockNode("/api/Health", "node-1")];

    const matched = matchPathToEndpoint("/api/health", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match using node.name", () => {
    const node: EndpointNode = {
      name: "/api/users/[id]",
      file: "src/app/api/users/[id]/route.ts",
      ref_id: "node-1",
    };

    const matched = matchPathToEndpoint("/api/users/123", [node]);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should handle multiple dynamic segments", () => {
    const nodes = [createMockNode("/api/users/[id]/posts/[id]", "node-1")];

    const matched = matchPathToEndpoint("/api/users/123/posts/456", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should handle empty nodes array", () => {
    const matched = matchPathToEndpoint("/api/health", []);
    expect(matched).toBeNull();
  });

  test("should match Next.js style dynamic routes", () => {
    const nodes = [
      createMockNode("/api/workspaces/[slug]", "node-1"),
      createMockNode("/posts/[slug]", "node-2"),
      createMockNode("/users/[id]/settings", "node-3"),
    ];

    expect(matchPathToEndpoint("/api/workspaces/my-workspace", nodes)?.ref_id).toBe("node-1");
    expect(matchPathToEndpoint("/posts/hello-world", nodes)?.ref_id).toBe("node-2");
    expect(matchPathToEndpoint("/users/42/settings", nodes)?.ref_id).toBe("node-3");
  });

  test("should handle complex nested dynamic routes", () => {
    const nodes = [createMockNode("/api/workspaces/[slug]/features/[id]/tasks/[id]", "node-1")];

    const matched = matchPathToEndpoint("/api/workspaces/my-workspace/features/feat-123/tasks/task-456", nodes);
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should strip query string from path before matching", () => {
    const nodes = [createMockNode("/api/swarm/jarvis/nodes", "node-1")];

    const matched = matchPathToEndpoint(
      "/api/swarm/jarvis/nodes?id=cmdx0a2v1000fl504z1oeb6oe&endpoint=graph%2Fsearch",
      nodes,
    );
    expect(matched?.ref_id).toBe("node-1");
  });

  test("should match swarm format endpoint nodes", () => {
    const node: EndpointNode = {
      name: "/api/vercel/log-drain",
      file: "stakwork/hive/src/app/api/vercel/log-drain/route.ts",
      ref_id: "bdd98c46-6e82-49ce-91d1-c32cb6692ecd",
    };

    const matched = matchPathToEndpoint("/api/vercel/log-drain", [node]);
    expect(matched?.ref_id).toBe("bdd98c46-6e82-49ce-91d1-c32cb6692ecd");
  });

  test("should match dynamic routes with query strings", () => {
    const node: EndpointNode = {
      name: "/api/workspaces/[slug]/tasks",
      file: "stakwork/hive/src/app/api/workspaces/[slug]/tasks/route.ts",
      ref_id: "task-node-123",
    };

    const matched = matchPathToEndpoint("/api/workspaces/my-workspace/tasks?status=active&page=1", [node]);
    expect(matched?.ref_id).toBe("task-node-123");
  });
});
