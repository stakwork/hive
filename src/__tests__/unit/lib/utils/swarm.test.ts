import { describe, test, expect } from "vitest";
import { getJarvisUrl, transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

describe("swarm utils", () => {
  describe("getJarvisUrl", () => {
    test("returns correct Jarvis URL format", () => {
      const result = getJarvisUrl("swarm38");
      expect(result).toBe("https://swarm38.sphinx.chat:8444");
    });

    test("handles swarm names with hyphens", () => {
      const result = getJarvisUrl("my-swarm-01");
      expect(result).toBe("https://my-swarm-01.sphinx.chat:8444");
    });

    test("handles swarm names with numbers", () => {
      const result = getJarvisUrl("swarm123");
      expect(result).toBe("https://swarm123.sphinx.chat:8444");
    });

    test("handles swarm names with mixed case", () => {
      const result = getJarvisUrl("MySwarm");
      expect(result).toBe("https://MySwarm.sphinx.chat:8444");
    });

    test("always uses HTTPS protocol", () => {
      const result = getJarvisUrl("testswarm");
      expect(result).toMatch(/^https:\/\//);
    });

    test("always uses port 8444", () => {
      const result = getJarvisUrl("testswarm");
      expect(result).toMatch(/:8444$/);
    });

    test("uses sphinx.chat domain", () => {
      const result = getJarvisUrl("testswarm");
      expect(result).toContain("sphinx.chat");
    });
  });

  describe("transformSwarmUrlToRepo2Graph", () => {
    test("transforms URL ending with /api", () => {
      const result = transformSwarmUrlToRepo2Graph("https://swarm.sphinx.chat/api");
      expect(result).toBe("https://swarm.sphinx.chat:3355");
    });

    test("transforms URL not ending with /api", () => {
      const result = transformSwarmUrlToRepo2Graph("https://swarm.sphinx.chat");
      expect(result).toBe("https://swarm.sphinx.chat:3355");
    });

    test("returns empty string for null", () => {
      const result = transformSwarmUrlToRepo2Graph(null);
      expect(result).toBe("");
    });

    test("returns empty string for undefined", () => {
      const result = transformSwarmUrlToRepo2Graph(undefined);
      expect(result).toBe("");
    });
  });
});
