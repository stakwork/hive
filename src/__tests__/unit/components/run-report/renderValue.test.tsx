import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderValue, KeyValues } from "@/components/run-report/chrome";

// Helper: render a ReactNode and return the container element.
function renderNode(node: React.ReactNode) {
  const { container } = render(<div data-testid="root">{node}</div>);
  return container.querySelector("[data-testid='root']")!;
}

// Builds a deeply nested object: { a: { a: { a: ... } } } for `levels` levels.
function deepNested(levels: number): unknown {
  if (levels <= 0) return "leaf";
  return { a: deepNested(levels - 1) };
}

// Builds a circular reference.
function circular(): unknown {
  const obj: Record<string, unknown> = {};
  obj.self = obj;
  return obj;
}

// ── renderValue unit tests ───────────────────────────────────────────────────

describe("renderValue", () => {
  it("renders a flat string as a <span> with correct text content", () => {
    const el = renderNode(renderValue("hello world"));
    const span = el.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("hello world");
  });

  it("renders a number as a <span>", () => {
    const el = renderNode(renderValue(42));
    const span = el.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("42");
  });

  it("renders null as a <span> with 'null' text", () => {
    const el = renderNode(renderValue(null));
    const span = el.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("null");
  });

  it("renders undefined as a <span> with 'undefined' text", () => {
    const el = renderNode(renderValue(undefined));
    const span = el.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("undefined");
  });

  it("renders a boolean as a <span>", () => {
    const el = renderNode(renderValue(true));
    const span = el.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("true");
  });

  it("renders a nested object (2 levels) as <dl> containing a nested <dl>", () => {
    const el = renderNode(renderValue({ outer: { inner: "value" } }));
    const dls = el.querySelectorAll("dl");
    // Outer dl + inner dl
    expect(dls.length).toBeGreaterThanOrEqual(2);
    expect(el.querySelector("dt")?.textContent).toBe("outer");
    expect(el.textContent).toContain("inner");
    expect(el.textContent).toContain("value");
  });

  it("renders an array of strings as <ul> with <li> entries", () => {
    const el = renderNode(renderValue(["alpha", "beta", "gamma"]));
    const ul = el.querySelector("ul");
    expect(ul).not.toBeNull();
    const lis = ul!.querySelectorAll("li");
    expect(lis).toHaveLength(3);
    expect(lis[0].textContent).toBe("alpha");
    expect(lis[1].textContent).toBe("beta");
    expect(lis[2].textContent).toBe("gamma");
  });

  it("renders an array of objects as <ul> with <li> entries each containing <dl>", () => {
    const el = renderNode(
      renderValue([
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "viewer" },
      ]),
    );
    const ul = el.querySelector("ul");
    expect(ul).not.toBeNull();
    const lis = ul!.querySelectorAll(":scope > li");
    expect(lis).toHaveLength(2);
    lis.forEach((li) => {
      expect(li.querySelector("dl")).not.toBeNull();
    });
    expect(el.textContent).toContain("Alice");
    expect(el.textContent).toContain("Bob");
  });

  it("renders a 6-level deep object with a <pre> (depth cap fires at depth > 5)", () => {
    // depth 6 = 6 levels of nesting; the root call is depth 0, so level 6 hits depth > 5
    const el = renderNode(renderValue(deepNested(6)));
    expect(el.querySelector("pre")).not.toBeNull();
  });

  it("renders a 10-level deep object with a <pre>, not a 10-deep <dl> tree", () => {
    const el = renderNode(renderValue(deepNested(10)));
    const pre = el.querySelector("pre");
    expect(pre).not.toBeNull();
    // Confirm we don't have 10 deep dl elements (depth cap fires early)
    const dls = el.querySelectorAll("dl");
    expect(dls.length).toBeLessThan(10);
  });

  it("renders a circular reference as '[unserializable]' inside a <pre>, does not throw", () => {
    expect(() => {
      const el = renderNode(renderValue(circular()));
      const pre = el.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre!.textContent).toContain("[unserializable]");
    }).not.toThrow();
  });
});

// ── KeyValues render tests ───────────────────────────────────────────────────

describe("KeyValues", () => {
  it("renders nested object values without raw JSON text in the output", () => {
    const data = {
      config: { model: "gpt-4", temperature: 0.7 },
      tags: ["legal", "benchmark"],
      score: 0.92,
    };
    const { container } = render(<KeyValues data={data} />);

    // No raw JSON string like {"model":"gpt-4"...} should appear as text content
    const textContent = container.textContent ?? "";
    expect(textContent).not.toContain('{"model"');
    expect(textContent).not.toContain('["legal"');

    // But the actual values should be present
    expect(textContent).toContain("gpt-4");
    expect(textContent).toContain("0.7");
    expect(textContent).toContain("legal");
    expect(textContent).toContain("benchmark");
    expect(textContent).toContain("0.92");
  });

  it("renders an empty data object with the 'No data' message", () => {
    render(<KeyValues data={{}} />);
    expect(screen.getByText("No data for this run.")).toBeInTheDocument();
  });

  it("renders primitive values as spans (not raw JSON)", () => {
    const { container } = render(<KeyValues data={{ key: "plain value" }} />);
    // Should contain a span with the text, not JSON-encoded
    const span = container.querySelector("dd span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("plain value");
  });
});
