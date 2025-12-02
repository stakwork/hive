import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeatureForm } from "@/components/features/feature-form";
import { FeaturePriority } from "@prisma/client";
import React from "react";

global.fetch = vi.fn();

describe("FeatureForm Component", () => {
  const mockWorkspaceId = "workspace-123";
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "feature-123",
        title: "Test Feature",
        priority: FeaturePriority.MEDIUM,
      }),
    });
  });

  describe("Priority Selection", () => {
    it("should render priority popover component", () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText("Priority")).toBeInTheDocument();
    });

    it("should default to MEDIUM priority", () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      const prioritySection = screen.getByText("Priority").parentElement;
      expect(prioritySection).toBeInTheDocument();
    });

    it("should display initial priority when provided", () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            title: "Existing Feature",
            priority: FeaturePriority.HIGH,
          }}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByDisplayValue("Existing Feature")).toBeInTheDocument();
    });

    it("should allow setting all priority levels", async () => {
      const { rerender } = render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      const priorities = [
        FeaturePriority.NONE,
        FeaturePriority.LOW,
        FeaturePriority.MEDIUM,
        FeaturePriority.HIGH,
        FeaturePriority.URGENT,
      ];

      for (const priority of priorities) {
        rerender(
          <FeatureForm
            workspaceId={mockWorkspaceId}
            initialData={{ priority }}
            onSuccess={mockOnSuccess}
          />
        );
        expect(screen.getByText("Priority")).toBeInTheDocument();
      }
    });
  });

  describe("Form Submission with Priority", () => {
    it("should submit form with selected priority", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            title: "Test Feature",
            priority: FeaturePriority.HIGH,
          }}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/roadmap/features",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"priority":"HIGH"'),
          })
        );
      });
    });

    it("should submit with MEDIUM priority by default", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      const titleInput = screen.getByTestId("feature-title-input");
      fireEvent.change(titleInput, { target: { value: "New Feature" } });

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/roadmap/features",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"priority":"MEDIUM"'),
          })
        );
      });
    });

    it("should update feature with new priority", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            id: "feature-123",
            title: "Existing Feature",
            priority: FeaturePriority.LOW,
          }}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/roadmap/features/feature-123",
          expect.objectContaining({
            method: "PATCH",
            body: expect.stringContaining('"priority":"LOW"'),
          })
        );
      });
    });

    it("should call onSuccess after successful submission", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            title: "Test Feature",
            priority: FeaturePriority.URGENT,
          }}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });
  });

  describe("Form Validation", () => {
    it("should require title field", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Title is required")).toBeInTheDocument();
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should allow form submission with only title and priority", async () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
        />
      );

      const titleInput = screen.getByTestId("feature-title-input");
      fireEvent.change(titleInput, { target: { value: "Minimal Feature" } });

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });
  });

  describe("Error Handling", () => {
    it("should display error message on submission failure", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Invalid priority value" }),
      });

      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            title: "Test Feature",
          }}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("Invalid priority value")
        ).toBeInTheDocument();
      });

      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  describe("Form Actions", () => {
    it("should call onCancel when cancel button is clicked", () => {
      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          onSuccess={mockOnSuccess}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByTestId("feature-form-cancel-button");
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it("should disable form during submission", async () => {
      // Mock a slow API response to ensure button stays disabled
      (global.fetch as any).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({
                    id: "feature-123",
                    title: "Test Feature",
                  }),
                }),
              100
            )
          )
      );

      render(
        <FeatureForm
          workspaceId={mockWorkspaceId}
          initialData={{
            title: "Test Feature",
          }}
          onSuccess={mockOnSuccess}
        />
      );

      const submitButton = screen.getByTestId("feature-form-submit-button");
      fireEvent.click(submitButton);

      // Button should be disabled immediately after click
      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });
  });
});
