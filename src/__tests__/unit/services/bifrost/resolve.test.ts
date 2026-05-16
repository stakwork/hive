import { describe, it, expect } from "vitest";
import { deriveBifrostBaseUrl } from "@/services/bifrost/resolve";

describe("deriveBifrostBaseUrl", () => {
  it.each([
    ["https://swarm-abc.sphinx.chat", "https://swarm-abc.sphinx.chat:8181"],
    [
      "https://swarm-abc.sphinx.chat:3355",
      "https://swarm-abc.sphinx.chat:8181",
    ],
    ["http://localhost:3355", "http://localhost:8181"],
    ["http://10.0.0.1", "http://10.0.0.1:8181"],
    ["https://swarm-abc.sphinx.chat/", "https://swarm-abc.sphinx.chat:8181"],
    // Hive stores swarmUrl as `https://<host>/api` (see
    // services/swarm/db.ts), but the gateway's routes live at the
    // root — strip the path.
    ["https://swarm-abc.sphinx.chat/api", "https://swarm-abc.sphinx.chat:8181"],
    [
      "https://swarm-abc.sphinx.chat:3355/api",
      "https://swarm-abc.sphinx.chat:8181",
    ],
    [
      "https://swarm-abc.sphinx.chat/api?x=1#frag",
      "https://swarm-abc.sphinx.chat:8181",
    ],
  ])("derives %s -> %s", (input, expected) => {
    expect(deriveBifrostBaseUrl(input)).toBe(expected);
  });

  it("uses a custom port when provided", () => {
    expect(deriveBifrostBaseUrl("https://swarm.example", 9000)).toBe(
      "https://swarm.example:9000",
    );
  });

  it("rejects non-URL inputs", () => {
    expect(() => deriveBifrostBaseUrl("not a url")).toThrow(/Invalid swarmUrl/);
  });
});
