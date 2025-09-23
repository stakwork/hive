import React from "react";
import { describe, test, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { getIcon, getArtifactIcon, getAgentIcon } from "@/lib/icons";

describe("icons utilities", () => {
  describe("getIcon", () => {
    test("should return Code icon for 'code' type with default className", () => {
      const result = getIcon("code");
      
      expect(result).toBeTruthy();
      
      // Render to test the actual component
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-4", "w-4");
    });

    test("should return Code icon for 'code' type with custom className", () => {
      const customClassName = "h-6 w-6 text-blue-500";
      const result = getIcon("code", customClassName);
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-6", "w-6", "text-blue-500");
    });

    test("should return Code icon for 'CODE' (uppercase) type", () => {
      const result = getIcon("CODE");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should return Bot icon for 'agent' type", () => {
      const result = getIcon("agent");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should return Bot icon for 'AGENT' (uppercase) type", () => {
      const result = getIcon("AGENT");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should return Phone icon for 'call' type", () => {
      const result = getIcon("call");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should return MessageSquare icon for 'message' type", () => {
      const result = getIcon("message");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should return null for unknown icon type", () => {
      const result = getIcon("unknown");
      
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = getIcon("");
      
      expect(result).toBeNull();
    });

    test("should return null for null input", () => {
      const result = getIcon(null as any);
      
      expect(result).toBeNull();
    });

    test("should return null for undefined input", () => {
      const result = getIcon(undefined as any);
      
      expect(result).toBeNull();
    });

    test("should handle mixed case icon types correctly", () => {
      const testCases = [
        "Code",
        "AgEnT", 
        "CALL",
        "Message"
      ];

      testCases.forEach((input) => {
        const result = getIcon(input);
        expect(result).toBeTruthy();
        
        const { container } = render(<div>{result}</div>);
        const svg = container.querySelector("svg");
        expect(svg).toBeInTheDocument();
      });
    });

    test("should handle custom className with all icon types", () => {
      const customClass = "custom-class";
      const iconTypes = ["code", "agent", "call", "message"];

      iconTypes.forEach((iconType) => {
        const result = getIcon(iconType, customClass);
        expect(result).toBeTruthy();
        
        const { container } = render(<div>{result}</div>);
        const svg = container.querySelector("svg");
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveClass("custom-class");
      });
    });
  });

  describe("getArtifactIcon", () => {
    test("should return Code icon with artifact-specific className for 'code' type", () => {
      const result = getArtifactIcon("code");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return Bot icon with artifact-specific className for 'agent' type", () => {
      const result = getArtifactIcon("agent");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return Phone icon with artifact-specific className for 'call' type", () => {
      const result = getArtifactIcon("call");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return MessageSquare icon with artifact-specific className for 'message' type", () => {
      const result = getArtifactIcon("message");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return null for unknown icon type", () => {
      const result = getArtifactIcon("unknown");
      
      expect(result).toBeNull();
    });

    test("should handle uppercase icon types", () => {
      const result = getArtifactIcon("CODE");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return null for null input", () => {
      const result = getArtifactIcon(null as any);
      
      expect(result).toBeNull();
    });

    test("should return null for undefined input", () => {
      const result = getArtifactIcon(undefined as any);
      
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = getArtifactIcon("");
      
      expect(result).toBeNull();
    });

    test("should always use artifact-specific className regardless of icon type", () => {
      const iconTypes = ["code", "agent", "call", "message"];

      iconTypes.forEach((iconType) => {
        const result = getArtifactIcon(iconType);
        expect(result).toBeTruthy();
        
        const { container } = render(<div>{result}</div>);
        const svg = container.querySelector("svg");
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveClass("h-5", "w-5", "flex-shrink-0");
      });
    });
  });

  describe("getAgentIcon", () => {
    test("should return Bot icon with default className", () => {
      const result = getAgentIcon();
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-4", "w-4", "flex-shrink-0");
    });

    test("should return Bot icon with custom className", () => {
      const customClassName = "h-8 w-8 text-purple-600";
      const result = getAgentIcon(customClassName);
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-8", "w-8", "text-purple-600");
    });

    test("should handle empty string className", () => {
      const result = getAgentIcon("");
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should handle null className", () => {
      const result = getAgentIcon(null as any);
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    test("should handle undefined className (should use default)", () => {
      const result = getAgentIcon(undefined);
      
      expect(result).toBeTruthy();
      
      const { container } = render(<div>{result}</div>);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass("h-4", "w-4", "flex-shrink-0");
    });

    test("should always return Bot icon regardless of input", () => {
      const testClassNames = [
        "test-1",
        "test-2 with-spaces",
        "h-6 w-6",
        "custom-icon-class",
      ];

      testClassNames.forEach((className) => {
        const result = getAgentIcon(className);
        expect(result).toBeTruthy();
        
        const { container } = render(<div>{result}</div>);
        const svg = container.querySelector("svg");
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveClass(className);
      });
    });
  });

  describe("integration tests", () => {
    test("should maintain consistency between getIcon and getArtifactIcon for same icon type", () => {
      const iconType = "code";
      
      const iconResult = getIcon(iconType, "custom-class");
      const artifactResult = getArtifactIcon(iconType);
      
      // Both should return truthy results (same component type)
      expect(iconResult).toBeTruthy();
      expect(artifactResult).toBeTruthy();
    });

    test("should handle all icon types consistently across functions", () => {
      const iconTypes = ["code", "agent", "call", "message"];
      
      iconTypes.forEach((iconType) => {
        const iconResult = getIcon(iconType);
        const artifactResult = getArtifactIcon(iconType);
        
        // Both should return the same type of result (either both truthy or both null)
        expect(Boolean(iconResult)).toBe(Boolean(artifactResult));
        
        if (iconType === "agent") {
          // For agent type, also test consistency with getAgentIcon
          const agentResult = getAgentIcon();
          expect(Boolean(agentResult)).toBe(Boolean(iconResult));
        }
      });
    });
  });
});