import React from "react";
import { describe, test, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ErrorDisplay, classifyError, useErrorDisplay, type ErrorDisplayConfig } from "@/components/ui/error-display";
import { WORKSPACE_ERRORS } from "@/lib/constants";

// Test data helpers
const TEST_ERRORS = {
  KNOWN_ERROR: WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED,
  UNKNOWN_ERROR: "Random error message",
  SLUG_ERROR: WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS,
  ACCESS_ERROR: WORKSPACE_ERRORS.ACCESS_DENIED,
} as const;

const EXPECTED_CONFIGS = {
  WORKSPACE_LIMIT: {
    type: "error" as const,
    title: "Workspace Limit Reached",
    description: "You can only create up to 2 workspaces.",
    helpText: "You can delete an existing workspace to create a new one.",
  },
  UNKNOWN_DEFAULT: {
    type: "error" as const,
    title: "Something went wrong",
    description: TEST_ERRORS.UNKNOWN_ERROR,
  },
} as const;

describe("ErrorDisplay Component", () => {
  describe("rendering behavior", () => {
    test("should render null when no error provided", () => {
      const { container } = render(<ErrorDisplay error={null} />);
      expect(container.firstChild).toBeNull();
    });

    test("should render known workspace errors with proper config", () => {
      const { getByText } = render(<ErrorDisplay error={TEST_ERRORS.KNOWN_ERROR} />);
      
      expect(getByText("Workspace Limit Reached")).toBeInTheDocument();
      expect(getByText("You can only create up to 2 workspaces.")).toBeInTheDocument();
      expect(getByText("You can delete an existing workspace to create a new one.")).toBeInTheDocument();
    });

    test("should render unknown errors with default config", () => {
      const { getByText } = render(<ErrorDisplay error={TEST_ERRORS.UNKNOWN_ERROR} />);
      
      expect(getByText("Error")).toBeInTheDocument();
      expect(getByText(TEST_ERRORS.UNKNOWN_ERROR)).toBeInTheDocument();
    });

    test("should render compact mode correctly", () => {
      const { container, getByText } = render(
        <ErrorDisplay error={TEST_ERRORS.KNOWN_ERROR} compact={true} />
      );
      
      expect(getByText("You can only create up to 2 workspaces.")).toBeInTheDocument();
      expect(container.querySelector('.text-destructive')).toBeInTheDocument();
    });
  });

  describe("styling and accessibility", () => {
    test("should apply custom className", () => {
      const customClass = "custom-error-class";
      const { container } = render(
        <ErrorDisplay error={TEST_ERRORS.UNKNOWN_ERROR} className={customClass} />
      );
      
      expect(container.firstChild).toHaveClass(customClass);
    });

    test("should render with proper ARIA attributes", () => {
      const { container } = render(<ErrorDisplay error={TEST_ERRORS.ACCESS_ERROR} />);
      
      // Alert component should have proper role
      const alertElement = container.querySelector('[role="alert"]');
      expect(alertElement).toBeInTheDocument();
    });
  });
});

describe("classifyError utility", () => {
  describe("known workspace errors", () => {
    test.each([
      [WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED, "Workspace Limit Reached"],
      [WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS, "Name Already Taken"],
      [WORKSPACE_ERRORS.SLUG_INVALID_FORMAT, "Invalid Name Format"],
      [WORKSPACE_ERRORS.SLUG_INVALID_LENGTH, "Invalid Name Length"],
      [WORKSPACE_ERRORS.SLUG_RESERVED, "Reserved Name"],
      [WORKSPACE_ERRORS.NOT_FOUND, "Workspace Not Found"],
      [WORKSPACE_ERRORS.ACCESS_DENIED, "Access Denied"],
    ])("should classify %s correctly", (errorMessage, expectedTitle) => {
      const config = classifyError(errorMessage);
      
      expect(config.type).toBe("error");
      expect(config.title).toBe(expectedTitle);
      expect(config.description).toBeTruthy();
    });
  });

  describe("unknown errors", () => {
    test("should classify unknown errors with defaults", () => {
      const config = classifyError(TEST_ERRORS.UNKNOWN_ERROR);
      
      expect(config).toEqual(EXPECTED_CONFIGS.UNKNOWN_DEFAULT);
    });

    test("should handle empty string errors", () => {
      const config = classifyError("");
      
      expect(config.type).toBe("error");
      expect(config.title).toBe("Something went wrong");
      expect(config.description).toBe("");
    });
  });

  describe("configuration completeness", () => {
    test("should return complete ErrorDisplayConfig interface", () => {
      const config = classifyError(TEST_ERRORS.KNOWN_ERROR);
      
      expect(config).toHaveProperty("type");
      expect(config).toHaveProperty("title");
      expect(config).toHaveProperty("description");
      expect(typeof config.type).toBe("string");
      expect(["error", "warning", "info"]).toContain(config.type);
    });
  });
});

describe("useErrorDisplay hook", () => {
  let hookResult: ReturnType<typeof useErrorDisplay>;

  beforeEach(() => {
    hookResult = useErrorDisplay();
  });

  describe("getErrorConfig method", () => {
    test("should return same result as classifyError", () => {
      const error = TEST_ERRORS.KNOWN_ERROR;
      const hookConfig = hookResult.getErrorConfig(error);
      const utilityConfig = classifyError(error);
      
      expect(hookConfig).toEqual(utilityConfig);
    });
  });

  describe("isWorkspaceError method", () => {
    test("should identify workspace errors correctly", () => {
      expect(hookResult.isWorkspaceError(WORKSPACE_ERRORS.NOT_FOUND)).toBe(true);
      expect(hookResult.isWorkspaceError(WORKSPACE_ERRORS.ACCESS_DENIED)).toBe(true);
      expect(hookResult.isWorkspaceError(TEST_ERRORS.UNKNOWN_ERROR)).toBe(false);
    });

    test("should handle edge cases", () => {
      expect(hookResult.isWorkspaceError("")).toBe(false);
      expect(hookResult.isWorkspaceError("undefined")).toBe(false);
    });
  });
});
