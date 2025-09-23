import { describe, test, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { getIcon, getArtifactIcon, getAgentIcon } from "@/lib/icons";

// Mock lucide-react components
vi.mock("lucide-react", () => ({
  Code: ({ className }: { className?: string }) => (
    <div data-testid="code-icon" className={className} />
  ),
  Bot: ({ className }: { className?: string }) => (
    <div data-testid="bot-icon" className={className} />
  ),
  Phone: ({ className }: { className?: string }) => (
    <div data-testid="phone-icon" className={className} />
  ),
  MessageSquare: ({ className }: { className?: string }) => (
    <div data-testid="message-square-icon" className={className} />
  ),
}));

describe("icons.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIcon", () => {
    test("should return Code icon for 'code' type", () => {
      const result = getIcon("code");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='code-icon']")).toHaveClass("h-4", "w-4");
    });

    test("should return Bot icon for 'agent' type", () => {
      const result = getIcon("agent");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("h-4", "w-4");
    });

    test("should return Phone icon for 'call' type", () => {
      const result = getIcon("call");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='phone-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='phone-icon']")).toHaveClass("h-4", "w-4");
    });

    test("should return MessageSquare icon for 'message' type", () => {
      const result = getIcon("message");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='message-square-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='message-square-icon']")).toHaveClass("h-4", "w-4");
    });

    test("should use custom className when provided", () => {
      const customClass = "h-6 w-6 text-blue-500";
      const result = getIcon("code", customClass);
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='code-icon']")).toHaveClass("h-6", "w-6", "text-blue-500");
    });

    test("should be case-insensitive", () => {
      const upperCaseResult = getIcon("CODE");
      const lowerCaseResult = getIcon("code");
      const mixedCaseResult = getIcon("CoDe");
      
      const { container: upperContainer } = render(<>{upperCaseResult}</>);
      const { container: lowerContainer } = render(<>{lowerCaseResult}</>);
      const { container: mixedContainer } = render(<>{mixedCaseResult}</>);
      
      expect(upperContainer.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
      expect(lowerContainer.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
      expect(mixedContainer.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
    });

    test("should return null for unknown icon type", () => {
      const result = getIcon("unknown");
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = getIcon("");
      expect(result).toBeNull();
    });

    test("should handle null input gracefully", () => {
      const result = getIcon(null as any);
      expect(result).toBeNull();
    });

    test("should handle undefined input gracefully", () => {
      const result = getIcon(undefined as any);
      expect(result).toBeNull();
    });

    test("should use default className when no className provided", () => {
      const result = getIcon("bot");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("h-4", "w-4");
    });

    test("should handle special characters in className", () => {
      const specialClass = "h-4 w-4 hover:text-red-500 focus:ring-2";
      const result = getIcon("agent", specialClass);
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass(
        "h-4", "w-4", "hover:text-red-500", "focus:ring-2"
      );
    });
  });

  describe("getArtifactIcon", () => {
    test("should return Code icon with artifact-specific className for 'code' type", () => {
      const result = getArtifactIcon("code");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='code-icon']")).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return Bot icon with artifact-specific className for 'agent' type", () => {
      const result = getArtifactIcon("agent");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return Phone icon with artifact-specific className for 'call' type", () => {
      const result = getArtifactIcon("call");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='phone-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='phone-icon']")).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return MessageSquare icon with artifact-specific className for 'message' type", () => {
      const result = getArtifactIcon("message");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='message-square-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='message-square-icon']")).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should be case-insensitive like getIcon", () => {
      const result = getArtifactIcon("CODE");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='code-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='code-icon']")).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("should return null for unknown icon type", () => {
      const result = getArtifactIcon("unknown");
      expect(result).toBeNull();
    });

    test("should handle null input gracefully", () => {
      const result = getArtifactIcon(null as any);
      expect(result).toBeNull();
    });

    test("should handle undefined input gracefully", () => {
      const result = getArtifactIcon(undefined as any);
      expect(result).toBeNull();
    });
  });

  describe("getAgentIcon", () => {
    test("should return Bot icon with default className", () => {
      const result = getAgentIcon();
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("h-4", "w-4", "flex-shrink-0");
    });

    test("should use custom className when provided", () => {
      const customClass = "h-8 w-8 text-green-500 flex-shrink-0";
      const result = getAgentIcon(customClass);
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("h-8", "w-8", "text-green-500", "flex-shrink-0");
    });

    test("should handle empty string className", () => {
      const result = getAgentIcon("");
      const { container } = render(<>{result}</>);
      
      expect(container.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='bot-icon']")).toHaveClass("");
    });

    test("should always return Bot icon regardless of parameters", () => {
      const result1 = getAgentIcon();
      const result2 = getAgentIcon("custom-class");
      
      const { container: container1 } = render(<>{result1}</>);
      const { container: container2 } = render(<>{result2}</>);
      
      expect(container1.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
      expect(container2.querySelector("[data-testid='bot-icon']")).toBeInTheDocument();
    });
  });

  describe("Integration Tests", () => {
    test("getArtifactIcon should behave differently than getIcon for same iconType", () => {
      const regularIcon = getIcon("code");
      const artifactIcon = getArtifactIcon("code");
      
      const { container: regularContainer } = render(<>{regularIcon}</>);
      const { container: artifactContainer } = render(<>{artifactIcon}</>);
      
      const regularCodeIcon = regularContainer.querySelector("[data-testid='code-icon']");
      const artifactCodeIcon = artifactContainer.querySelector("[data-testid='code-icon']");
      
      expect(regularCodeIcon).toHaveClass("h-4", "w-4");
      expect(artifactCodeIcon).toHaveClass("h-5", "w-5", "flex-shrink-0");
    });

    test("getAgentIcon should return same component as getIcon('agent') but with different default className", () => {
      const agentViaGetIcon = getIcon("agent");
      const agentViaGetAgentIcon = getAgentIcon();
      
      const { container: getIconContainer } = render(<>{agentViaGetIcon}</>);
      const { container: getAgentIconContainer } = render(<>{agentViaGetAgentIcon}</>);
      
      const getIconBot = getIconContainer.querySelector("[data-testid='bot-icon']");
      const getAgentIconBot = getAgentIconContainer.querySelector("[data-testid='bot-icon']");
      
      expect(getIconBot).toHaveClass("h-4", "w-4");
      expect(getAgentIconBot).toHaveClass("h-4", "w-4", "flex-shrink-0");
    });

    test("all functions should return renderable React elements", () => {
      const iconTypes = ["code", "agent", "call", "message"];
      
      iconTypes.forEach(iconType => {
        const regularIcon = getIcon(iconType);
        const artifactIcon = getArtifactIcon(iconType);
        
        expect(() => render(<>{regularIcon}</>)).not.toThrow();
        expect(() => render(<>{artifactIcon}</>)).not.toThrow();
      });
      
      const agentIcon = getAgentIcon();
      expect(() => render(<>{agentIcon}</>)).not.toThrow();
    });

    test("functions should handle consistent iconType mapping", () => {
      const testCases = [
        { iconType: "code", expectedTestId: "code-icon" },
        { iconType: "agent", expectedTestId: "bot-icon" },
        { iconType: "call", expectedTestId: "phone-icon" },
        { iconType: "message", expectedTestId: "message-square-icon" }
      ];
      
      testCases.forEach(({ iconType, expectedTestId }) => {
        const regularIcon = getIcon(iconType);
        const artifactIcon = getArtifactIcon(iconType);
        
        const { container: regularContainer } = render(<>{regularIcon}</>);
        const { container: artifactContainer } = render(<>{artifactIcon}</>);
        
        expect(regularContainer.querySelector(`[data-testid='${expectedTestId}']`)).toBeInTheDocument();
        expect(artifactContainer.querySelector(`[data-testid='${expectedTestId}']`)).toBeInTheDocument();
      });
    });
  });
});