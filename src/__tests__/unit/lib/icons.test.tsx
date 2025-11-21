import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { getIcon, getArtifactIcon, getAgentIcon } from "@/lib/icons";

describe("icons", () => {
  describe("getIcon", () => {
    it("should return Code icon for 'code' type", () => {
      const icon = getIcon("code");
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should return Bot icon for 'agent' type", () => {
      const icon = getIcon("agent");
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should return Phone icon for 'call' type", () => {
      const icon = getIcon("call");
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should return MessageSquare icon for 'message' type", () => {
      const icon = getIcon("message");
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should handle case-insensitive icon types", () => {
      const lowerIcon = getIcon("code");
      const upperIcon = getIcon("CODE");
      const mixedIcon = getIcon("Code");

      expect(lowerIcon).toBeTruthy();
      expect(upperIcon).toBeTruthy();
      expect(mixedIcon).toBeTruthy();
    });

    it("should return null for unknown icon type", () => {
      const icon = getIcon("unknown");
      expect(icon).toBeNull();
    });

    it("should apply default className", () => {
      const icon = getIcon("code");
      const { container } = render(<>{icon}</>);
      const svg = container.querySelector("svg");

      expect(svg).toHaveClass("h-4");
      expect(svg).toHaveClass("w-4");
    });

    it("should apply custom className", () => {
      const icon = getIcon("code", "h-6 w-6 text-blue-500");
      const { container } = render(<>{icon}</>);
      const svg = container.querySelector("svg");

      expect(svg).toHaveClass("h-6");
      expect(svg).toHaveClass("w-6");
      expect(svg).toHaveClass("text-blue-500");
    });

    it("should handle empty string icon type", () => {
      const icon = getIcon("");
      expect(icon).toBeNull();
    });
  });

  describe("getArtifactIcon", () => {
    it("should return Code icon for 'code' type", () => {
      const icon = getArtifactIcon("code");
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should apply artifact-specific className", () => {
      const icon = getArtifactIcon("code");
      const { container } = render(<>{icon}</>);
      const svg = container.querySelector("svg");

      expect(svg).toHaveClass("h-5");
      expect(svg).toHaveClass("w-5");
      expect(svg).toHaveClass("flex-shrink-0");
    });

    it("should return null for unknown icon type", () => {
      const icon = getArtifactIcon("unknown");
      expect(icon).toBeNull();
    });

    it("should handle all valid icon types", () => {
      const types = ["code", "agent", "call", "message"];

      types.forEach((type) => {
        const icon = getArtifactIcon(type);
        expect(icon).toBeTruthy();
      });
    });
  });

  describe("getAgentIcon", () => {
    it("should return Bot icon", () => {
      const icon = getAgentIcon();
      expect(icon).toBeTruthy();

      const { container } = render(<>{icon}</>);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("should apply default className", () => {
      const icon = getAgentIcon();
      const { container } = render(<>{icon}</>);
      const svg = container.querySelector("svg");

      expect(svg).toHaveClass("h-4");
      expect(svg).toHaveClass("w-4");
      expect(svg).toHaveClass("flex-shrink-0");
    });

    it("should apply custom className", () => {
      const icon = getAgentIcon("h-8 w-8 text-purple-500");
      const { container } = render(<>{icon}</>);
      const svg = container.querySelector("svg");

      expect(svg).toHaveClass("h-8");
      expect(svg).toHaveClass("w-8");
      expect(svg).toHaveClass("text-purple-500");
    });

    it("should always return same icon type", () => {
      const icon1 = getAgentIcon();
      const icon2 = getAgentIcon("custom-class");

      expect(icon1).toBeTruthy();
      expect(icon2).toBeTruthy();
    });
  });
});
