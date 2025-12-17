import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/diff";
import type { Artifact } from "@/lib/chat";

// Mock useTheme hook
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "light",
    resolvedTheme: "light",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    mounted: true,
  }),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("DiffArtifactPanel - Sticky File Name Header", () => {
  const createMockDiffArtifact = (fileName: string, content: string): Artifact => ({
    id: `artifact-${fileName}`,
    messageId: "test-message",
    type: "DIFF",
    content: {
      diffs: [
        {
          file: fileName,
          action: "modify" as const,
          repoName: "test-repo",
          content: content,
        },
      ],
    },
    icon: "file-diff",
    createdAt: new Date(),
  });

  const mockSingleFileDiff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,5 @@
 function test() {
-  console.log("old");
+  console.log("new");
 }`;

  const mockMultiFileDiff1 = `diff --git a/src/file1.ts b/src/file1.ts
index 1234567..abcdefg 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,5 +1,5 @@
 function file1() {
-  console.log("old file1");
+  console.log("new file1");
 }`;

  const mockMultiFileDiff2 = `diff --git a/src/file2.ts b/src/file2.ts
index 1234567..abcdefg 100644
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1,5 +1,5 @@
 function file2() {
-  console.log("old file2");
+  console.log("new file2");
 }`;

  const createMultiFileArtifact = (files: Array<{ fileName: string; content: string }>): Artifact => ({
    id: "artifact-multi",
    messageId: "test-message",
    type: "DIFF",
    content: {
      diffs: files.map(({ fileName, content }) => ({
        file: fileName,
        action: "modify" as const,
        repoName: "test-repo",
        content,
      })),
    },
    icon: "file-diff",
    createdAt: new Date(),
  });

  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("Sticky Positioning", () => {
    it("should apply sticky positioning classes to file header", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      expect(fileHeader).toBeInTheDocument();
      
      // Verify sticky positioning classes are applied
      expect(fileHeader).toHaveClass("sticky");
      expect(fileHeader).toHaveClass("top-0");
      expect(fileHeader).toHaveClass("z-10");
    });

    it("should have opaque background color for sticky header", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Verify bg-card class is present (ensures opaque background)
      expect(fileHeader).toHaveClass("bg-card");
    });

    it("should have proper z-index for stacking context", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Verify z-index class
      expect(fileHeader).toHaveClass("z-10");
    });

    it("should render file name within sticky header", () => {
      const artifacts = [createMockDiffArtifact("src/components/MyComponent.tsx", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/components/MyComponent.tsx");
      expect(fileHeader).toHaveTextContent("src/components/MyComponent.tsx");
    });
  });

  describe("Multiple Files with Sticky Headers", () => {
    it("should apply sticky positioning to all file headers", () => {
      const multiFileArtifact = createMultiFileArtifact([
        { fileName: "src/file1.ts", content: mockMultiFileDiff1 },
        { fileName: "src/file2.ts", content: mockMultiFileDiff2 },
      ]);
      
      render(<DiffArtifactPanel artifacts={[multiFileArtifact]} />);

      const file1Header = screen.getByTestId("file-header-src/file1.ts");
      const file2Header = screen.getByTestId("file-header-src/file2.ts");

      // Verify both headers have sticky positioning
      expect(file1Header).toHaveClass("sticky", "top-0", "z-10", "bg-card");
      expect(file2Header).toHaveClass("sticky", "top-0", "z-10", "bg-card");
    });

    it("should display correct file names in each sticky header", () => {
      const multiFileArtifact = createMultiFileArtifact([
        { fileName: "src/file1.ts", content: mockMultiFileDiff1 },
        { fileName: "src/file2.ts", content: mockMultiFileDiff2 },
      ]);
      
      render(<DiffArtifactPanel artifacts={[multiFileArtifact]} />);

      const file1Header = screen.getByTestId("file-header-src/file1.ts");
      const file2Header = screen.getByTestId("file-header-src/file2.ts");

      expect(file1Header).toHaveTextContent("src/file1.ts");
      expect(file2Header).toHaveTextContent("src/file2.ts");
    });
  });

  describe("File Expansion State", () => {
    it("should maintain sticky header when file is expanded", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // File should be expanded by default (new files auto-expand)
      expect(fileHeader).toHaveClass("sticky", "top-0", "z-10");
    });

    it("should maintain sticky header when file is collapsed", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Click to collapse
      fireEvent.click(fileHeader);
      
      // Header should still have sticky positioning
      expect(fileHeader).toHaveClass("sticky", "top-0", "z-10");
    });
  });

  describe("Scroll Container Context", () => {
    it("should render within a scrollable container", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      const { container } = render(<DiffArtifactPanel artifacts={artifacts} />);

      // Find the scroll container (flex-1 overflow-auto)
      const scrollContainer = container.querySelector(".flex-1.overflow-auto");
      expect(scrollContainer).toBeInTheDocument();
    });

    it("should position sticky header at top of scroll container", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Verify top-0 positions at top of nearest scroll container
      expect(fileHeader).toHaveClass("top-0");
    });
  });

  describe("File Action Display", () => {
    it("should display file action badge in sticky header", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Should contain action badge (Modified in this case)
      expect(fileHeader).toHaveTextContent("Modified");
    });

    it("should display addition/deletion counts in sticky header", () => {
      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Should display diff stats (+/- counts)
      // mockSingleFileDiff has 1 deletion and 1 addition
      expect(fileHeader.textContent).toMatch(/[+-]\d+/);
    });
  });

  describe("Dark Mode Support", () => {
    it("should apply sticky positioning in dark mode", () => {
      // Mock dark theme
      vi.mock("@/hooks/use-theme", () => ({
        useTheme: () => ({
          theme: "dark",
          resolvedTheme: "dark",
          setTheme: vi.fn(),
          toggleTheme: vi.fn(),
          mounted: true,
        }),
      }));

      const artifacts = [createMockDiffArtifact("src/test.ts", mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId("file-header-src/test.ts");
      
      // Sticky classes should still be present
      expect(fileHeader).toHaveClass("sticky", "top-0", "z-10", "bg-card");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty artifacts array", () => {
      const { container } = render(<DiffArtifactPanel artifacts={[]} />);
      
      // Should render empty state, not file headers
      expect(container.querySelector("[data-testid^='file-header-']")).not.toBeInTheDocument();
    });

    it("should handle files with special characters in name", () => {
      const specialFileName = "src/components/My-Component_v2.0.tsx";
      const artifacts = [createMockDiffArtifact(specialFileName, mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId(`file-header-${specialFileName}`);
      expect(fileHeader).toHaveClass("sticky", "top-0", "z-10");
      expect(fileHeader).toHaveTextContent(specialFileName);
    });

    it("should handle very long file names", () => {
      const longFileName = "src/components/features/dashboard/widgets/analytics/charts/RealTimeDataVisualizationComponent.tsx";
      const artifacts = [createMockDiffArtifact(longFileName, mockSingleFileDiff)];
      render(<DiffArtifactPanel artifacts={artifacts} />);

      const fileHeader = screen.getByTestId(`file-header-${longFileName}`);
      expect(fileHeader).toHaveClass("sticky", "top-0", "z-10");
      expect(fileHeader).toHaveTextContent(longFileName);
    });
  });
});
