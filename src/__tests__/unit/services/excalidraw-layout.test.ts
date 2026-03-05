import { describe, test, expect } from "vitest";
import { sanitiseDiagram } from "@/services/excalidraw-layout";
import type { ParsedDiagram } from "@/services/excalidraw-layout";

describe("sanitiseDiagram", () => {
  test("valid diagram passes through unchanged", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "API Gateway", type: "gateway" },
        { id: "c2", name: "User Service", type: "service" },
      ],
      connections: [{ from: "c1", to: "c2", label: "REST" }],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(2);
    expect(result.connections).toHaveLength(1);
    expect(result.components[0]).toEqual(diagram.components[0]);
    expect(result.components[1]).toEqual(diagram.components[1]);
    expect(result.connections[0]).toEqual(diagram.connections[0]);
  });

  test("component missing id is removed", () => {
    const diagram = {
      components: [
        { id: "", name: "Missing ID", type: "service" },
        { id: "c2", name: "Valid Service", type: "service" },
      ],
      connections: [],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].id).toBe("c2");
  });

  test("component missing name is removed", () => {
    const diagram = {
      components: [
        { id: "c1", name: "", type: "service" },
        { id: "c2", name: "Valid Service", type: "service" },
      ],
      connections: [],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].id).toBe("c2");
  });

  test("connection with unknown from ID is stripped", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [
        { from: "UNKNOWN", to: "c2", label: "broken" },
        { from: "c1", to: "c2", label: "valid" },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("valid");
  });

  test("connection with unknown to ID is stripped", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [
        { from: "c1", to: "DOES_NOT_EXIST", label: "broken" },
        { from: "c1", to: "c2", label: "valid" },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("valid");
  });

  test("unknown component type is coerced to service", () => {
    const diagram = {
      components: [
        { id: "c1", name: "Weird Component", type: "blockchain" },
      ],
      connections: [],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].type).toBe("service");
  });

  test("connections referencing removed components are also stripped", () => {
    const diagram = {
      components: [
        { id: "", name: "No ID", type: "service" }, // will be removed
        { id: "c2", name: "Valid", type: "service" },
      ],
      connections: [
        { from: "", to: "c2", label: "dangling" },
        { from: "c2", to: "c2", label: "self-loop" },
      ],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    // The "" id component is gone, so the dangling connection is also stripped
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("self-loop");
  });
});
