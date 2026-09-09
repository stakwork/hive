import { describe, it, expect } from "vitest";
import { normalizeContainer } from "@/app/admin/swarms/[instanceId]/SwarmDetail";

describe("normalizeContainer", () => {
  it("maps a raw Docker container object to the UI Container shape", () => {
    const raw = {
      Names: ["/hermes.sphinx"],
      State: "running",
      Status: "Up 4 hours",
      Image: "nousresearch/hermes-agent:latest",
    };

    const result = normalizeContainer(raw);

    expect(result.name).toBe("hermes.sphinx");
    expect(result.status).toBe("running");
    expect(result.status === "running").toBe(true); // isRunning check
    expect(result.image).toBe("nousresearch/hermes-agent:latest");
  });

  it("does not treat a 'created' State as running", () => {
    const raw = {
      Names: ["/hermes.sphinx"],
      State: "created",
      Status: "Created",
      Image: "nousresearch/hermes-agent:latest",
    };

    const result = normalizeContainer(raw);

    expect(result.status).toBe("created");
    expect(result.status === "running").toBe(false);
  });

  it("passes through an already-lowercase shape unchanged", () => {
    const raw = {
      name: "sphinx",
      status: "running",
      image: "sphinxlightning/sphinx-relay:latest",
    };

    const result = normalizeContainer(raw);

    expect(result).toEqual({
      name: "sphinx",
      status: "running",
      image: "sphinxlightning/sphinx-relay:latest",
    });
  });

  it("defaults missing/empty fields to empty strings and does not throw", () => {
    expect(() => normalizeContainer({})).not.toThrow();

    const result = normalizeContainer({});
    expect(result).toEqual({ name: "", status: "", image: "" });

    const resultWithEmptyNames = normalizeContainer({ Names: [] });
    expect(resultWithEmptyNames.name).toBe("");
  });
});
