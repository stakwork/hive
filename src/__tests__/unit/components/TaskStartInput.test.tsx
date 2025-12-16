import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskStartInput } from "@/app/w/[slug]/task/[...taskParams]/components/TaskStartInput";

// Mock UI components
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, any>((props, ref) => (
    <textarea ref={ref} {...props} />
  )),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, any>((props, ref) => (
    <input ref={ref} {...props} />
  )),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, className, ...props }: any) => (
    <button className={className} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild, ...props }: any) => <div {...props}>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-value={value} data-onvaluechange={onValueChange}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Mock dependencies
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: () => false,
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => false,
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("TaskStartInput Component", () => {
  const defaultProps = {
    onStart: vi.fn(),
    taskMode: "agent",
    onModeChange: vi.fn(),
    isLoading: false,
    hasAvailablePods: true,
    isCheckingPods: false,
    workspaceSlug: "test-workspace",
    onWorkflowSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Workflow Mode - Input Validation", () => {
    it("should allow typing workflow ID without premature validation", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      
      // Type partial workflow ID
      fireEvent.change(input, { target: { value: "12" } });
      
      // Should not show any error messages
      expect(screen.queryByText(/workflow not found/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/exists in stakwork/i)).not.toBeInTheDocument();
    });

    it("should enable submit button when valid numeric ID is entered", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Initially disabled
      expect(submitButton).toBeDisabled();

      // Enter valid workflow ID
      fireEvent.change(input, { target: { value: "123" } });

      // Should be enabled
      expect(submitButton).not.toBeDisabled();
    });

    it("should keep submit button disabled for non-numeric input", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Enter invalid workflow ID
      fireEvent.change(input, { target: { value: "abc" } });

      // Should remain disabled
      expect(submitButton).toBeDisabled();
    });

    it("should keep submit button disabled for empty input", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const submitButton = screen.getByTestId("task-start-submit");

      // Should be disabled
      expect(submitButton).toBeDisabled();
    });
  });

  describe("Workflow Mode - Submission", () => {
    it("should call onWorkflowSelect with numeric workflow ID on Enter key", () => {
      const mockOnWorkflowSelect = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          onWorkflowSelect={mockOnWorkflowSelect}
        />
      );

      const input = screen.getByTestId("workflow-id-input");

      // Enter valid workflow ID
      fireEvent.change(input, { target: { value: "456" } });

      // Press Enter
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Should call onWorkflowSelect with parsed number
      expect(mockOnWorkflowSelect).toHaveBeenCalledWith(456);
      expect(mockOnWorkflowSelect).toHaveBeenCalledTimes(1);
    });

    it("should call onWorkflowSelect with numeric workflow ID on button click", () => {
      const mockOnWorkflowSelect = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          onWorkflowSelect={mockOnWorkflowSelect}
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Enter valid workflow ID
      fireEvent.change(input, { target: { value: "789" } });

      // Click submit button
      fireEvent.click(submitButton);

      // Should call onWorkflowSelect with parsed number
      expect(mockOnWorkflowSelect).toHaveBeenCalledWith(789);
      expect(mockOnWorkflowSelect).toHaveBeenCalledTimes(1);
    });

    it("should not call onWorkflowSelect when Enter is pressed with invalid input", () => {
      const mockOnWorkflowSelect = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          onWorkflowSelect={mockOnWorkflowSelect}
        />
      );

      const input = screen.getByTestId("workflow-id-input");

      // Enter invalid workflow ID
      fireEvent.change(input, { target: { value: "abc" } });

      // Press Enter
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Should not call onWorkflowSelect
      expect(mockOnWorkflowSelect).not.toHaveBeenCalled();
    });

    it("should not call onWorkflowSelect when button is clicked with invalid input", () => {
      const mockOnWorkflowSelect = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          onWorkflowSelect={mockOnWorkflowSelect}
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Enter invalid workflow ID
      fireEvent.change(input, { target: { value: "" } });

      // Click submit button
      fireEvent.click(submitButton);

      // Should not call onWorkflowSelect
      expect(mockOnWorkflowSelect).not.toHaveBeenCalled();
    });

    it("should trim whitespace from workflow ID before submission", () => {
      const mockOnWorkflowSelect = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          onWorkflowSelect={mockOnWorkflowSelect}
        />
      );

      const input = screen.getByTestId("workflow-id-input");

      // Enter workflow ID with whitespace
      fireEvent.change(input, { target: { value: "  123  " } });

      // Press Enter
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Should call onWorkflowSelect with trimmed and parsed number
      expect(mockOnWorkflowSelect).toHaveBeenCalledWith(123);
    });
  });

  describe("Workflow Mode - Loading States", () => {
    it("should disable submit button when isLoading is true", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          isLoading={true}
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Enter valid workflow ID
      fireEvent.change(input, { target: { value: "123" } });

      // Should still be disabled due to loading
      expect(submitButton).toBeDisabled();
    });

    it("should show loading spinner when isLoading is true", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
          isLoading={true}
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      fireEvent.change(input, { target: { value: "123" } });

      // Check for loading spinner (Loader2 component)
      const submitButton = screen.getByTestId("task-start-submit");
      const loader = submitButton.querySelector(".animate-spin");
      expect(loader).toBeInTheDocument();
    });
  });

  describe("Workflow Mode - Props Removed", () => {
    it("should not accept workflows prop", () => {
      // This test verifies that the component doesn't use workflows prop
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      fireEvent.change(input, { target: { value: "999" } });

      // Should not show any workflow name or status based on local workflows array
      expect(screen.queryByText(/workflow name/i)).not.toBeInTheDocument();
    });

    it("should not show workflow status UI elements", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="workflow_editor"
        />
      );

      const input = screen.getByTestId("workflow-id-input");
      fireEvent.change(input, { target: { value: "123" } });

      // Should not show success/error/loading status messages
      expect(screen.queryByText(/workflow not found/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("Agent Mode - Normal Operation", () => {
    it("should work normally in agent mode with text input", () => {
      const mockOnStart = vi.fn();
      
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="agent"
          onStart={mockOnStart}
        />
      );

      const input = screen.getByTestId("task-start-input");

      // Enter task description
      fireEvent.change(input, { target: { value: "Build a new feature" } });

      // Press Enter
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Should call onStart with text
      expect(mockOnStart).toHaveBeenCalledWith("Build a new feature");
    });

    it("should disable submit in agent mode when no pods available", () => {
      render(
        <TaskStartInput
          {...defaultProps}
          taskMode="agent"
          hasAvailablePods={false}
        />
      );

      const input = screen.getByTestId("task-start-input");
      const submitButton = screen.getByTestId("task-start-submit");

      // Enter valid text
      fireEvent.change(input, { target: { value: "Build feature" } });

      // Should be disabled due to no pods
      expect(submitButton).toBeDisabled();
    });
  });
});
