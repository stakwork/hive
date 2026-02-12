import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeploymentStatusBadge from "@/components/tasks/DeploymentStatusBadge";

describe("DeploymentStatusBadge", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.clearAllMocks();
  });

  describe("Staging Environment", () => {
    it("renders with purple styling and Rocket icon", () => {
      render(
        <DeploymentStatusBadge
          environment="staging"
          deployedAt="2024-01-15T10:30:00Z"
        />
      );

      const badge = screen.getByText("Staging");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("border-purple-300");

      // Check for Rocket icon (lucide-react renders as svg with specific class)
      const icon = badge.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });

    it("shows ExternalLink icon when deploymentUrl provided", () => {
      render(
        <DeploymentStatusBadge
          environment="staging"
          deploymentUrl="https://staging.example.com"
          deployedAt="2024-01-15T10:30:00Z"
        />
      );

      const badge = screen.getByText("Staging");
      const icons = badge.querySelectorAll("svg");
      // Should have both Rocket and ExternalLink icons
      expect(icons.length).toBeGreaterThanOrEqual(2);
    });

    it("opens deploymentUrl in new tab on click", async () => {
      const user = userEvent.setup();
      const deploymentUrl = "https://staging.example.com";

      render(
        <DeploymentStatusBadge
          environment="staging"
          deploymentUrl={deploymentUrl}
          deployedAt="2024-01-15T10:30:00Z"
        />
      );

      const badge = screen.getByText("Staging");
      expect(badge).toBeInTheDocument();

      await user.click(badge);
      expect(window.open).toHaveBeenCalledWith(deploymentUrl, "_blank", "noopener,noreferrer");
    });
  });

  describe("Production Environment", () => {
    it("renders with green styling and CheckCircle2 icon", () => {
      render(
        <DeploymentStatusBadge
          environment="production"
          deployedAt="2024-01-15T12:00:00Z"
        />
      );

      const badge = screen.getByText("Production");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("border-green-300");

      const icon = badge.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });
  });

  describe("Failed Environment", () => {
    it("renders with red styling and XCircle icon", () => {
      render(
        <DeploymentStatusBadge
          environment="failed"
          deployedAt="2024-01-15T11:00:00Z"
        />
      );

      const badge = screen.getByText("Failed");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("border-red-300");

      const icon = badge.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });
  });

  describe("Click Behavior", () => {
    it("does nothing when clicked without deploymentUrl", async () => {
      const user = userEvent.setup();

      render(
        <DeploymentStatusBadge
          environment="staging"
          deployedAt="2024-01-15T10:30:00Z"
        />
      );

      const badge = screen.getByText("Staging");
      expect(badge).toBeInTheDocument();

      await user.click(badge);
      expect(window.open).not.toHaveBeenCalled();
    });

    it("stops event propagation on click", async () => {
      const user = userEvent.setup();
      const parentClickHandler = vi.fn();
      const deploymentUrl = "https://staging.example.com";

      render(
        <div onClick={parentClickHandler}>
          <DeploymentStatusBadge
            environment="staging"
            deploymentUrl={deploymentUrl}
            deployedAt="2024-01-15T10:30:00Z"
          />
        </div>
      );

      const badge = screen.getByText("Staging");
      expect(badge).toBeInTheDocument();

      await user.click(badge);
      expect(window.open).toHaveBeenCalledWith(deploymentUrl, "_blank", "noopener,noreferrer");
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  describe("Badge Variant", () => {
    it("uses outline variant", () => {
      render(
        <DeploymentStatusBadge
          environment="production"
          deployedAt="2024-01-15T12:00:00Z"
        />
      );

      const badge = screen.getByText("Production");
      // Badge outline variant has border class
      expect(badge.className).toMatch(/border/);
    });
  });
});
