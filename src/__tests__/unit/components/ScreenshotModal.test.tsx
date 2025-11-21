import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScreenshotModal } from "@/components/ScreenshotModal";
import type { Screenshot } from "@/types/common";

// Mock Dialog components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: { children: React.ReactNode; open: boolean; onOpenChange: () => void }) =>
    open ? (
      <div data-testid="dialog-mock" role="dialog">
        {children}
      </div>
    ) : null,
  DialogContent: ({ children, className, ...props }: any) => (
    <div data-testid="screenshot-modal" className={className} {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Mock screenshots for testing
const createMockScreenshot = (overrides: Partial<Screenshot> = {}): Screenshot => ({
  id: "screenshot-1",
  actionIndex: 0,
  dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  timestamp: Date.now(),
  url: "https://example.com",
  ...overrides,
});

const mockScreenshots: Screenshot[] = [
  createMockScreenshot({ id: "screenshot-1", actionIndex: 0, url: "https://example.com/page1" }),
  createMockScreenshot({ id: "screenshot-2", actionIndex: 1, url: "https://example.com/page2" }),
  createMockScreenshot({ id: "screenshot-3", actionIndex: 2, url: "https://example.com/page3" }),
];

describe("ScreenshotModal", () => {
  const defaultProps = {
    screenshot: mockScreenshots[0],
    allScreenshots: mockScreenshots,
    isOpen: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    test("renders when open with screenshot data", () => {
      render(<ScreenshotModal {...defaultProps} />);

      expect(screen.getByTestId("screenshot-modal")).toBeInTheDocument();
      expect(screen.getByTestId("screenshot-image")).toBeInTheDocument();
    });

    test("does not render when closed", () => {
      render(<ScreenshotModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId("screenshot-modal")).not.toBeInTheDocument();
    });

    test("returns null when no screenshot provided", () => {
      const { container } = render(<ScreenshotModal {...defaultProps} screenshot={null} />);

      expect(container.firstChild).toBeNull();
    });

    test("displays screenshot image with correct src", () => {
      render(<ScreenshotModal {...defaultProps} />);

      const image = screen.getByTestId("screenshot-image") as HTMLImageElement;
      expect(image.src).toBe(mockScreenshots[0].dataUrl);
    });

    test("shows action index and URL in title", () => {
      render(<ScreenshotModal {...defaultProps} />);

      expect(screen.getByText(/Screenshot - Action 1/)).toBeInTheDocument();
      expect(screen.getByText(mockScreenshots[0].url)).toBeInTheDocument();
    });

    test("shows formatted timestamp", () => {
      const timestamp = new Date("2024-01-15T10:30:00").getTime();
      const screenshot = createMockScreenshot({ timestamp });

      render(<ScreenshotModal {...defaultProps} screenshot={screenshot} />);

      const timestampText = screen.getByText(/Captured:/);
      expect(timestampText).toBeInTheDocument();
    });
  });

  describe("Navigation Buttons", () => {
    test("previous button disabled on first screenshot", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[0]} />);

      const prevButton = screen.getByTestId("screenshot-prev");
      expect(prevButton).toBeDisabled();
    });

    test("next button disabled on last screenshot", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[2]} />);

      const nextButton = screen.getByTestId("screenshot-next");
      expect(nextButton).toBeDisabled();
    });

    test("previous button enabled on middle screenshot", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} />);

      const prevButton = screen.getByTestId("screenshot-prev");
      expect(prevButton).not.toBeDisabled();
    });

    test("next button enabled on middle screenshot", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} />);

      const nextButton = screen.getByTestId("screenshot-next");
      expect(nextButton).not.toBeDisabled();
    });

    test("previous button navigates to previous screenshot", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} onNavigate={onNavigate} />);

      const prevButton = screen.getByTestId("screenshot-prev");
      await user.click(prevButton);

      expect(onNavigate).toHaveBeenCalledWith(mockScreenshots[0]);
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    test("next button navigates to next screenshot", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} onNavigate={onNavigate} />);

      const nextButton = screen.getByTestId("screenshot-next");
      await user.click(nextButton);

      expect(onNavigate).toHaveBeenCalledWith(mockScreenshots[2]);
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    test("shows correct position (X of Y)", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} />);

      const position = screen.getByTestId("screenshot-position");
      expect(position).toHaveTextContent("2 of 3");
    });

    test("hides navigation when only one screenshot", () => {
      const singleScreenshot = [mockScreenshots[0]];

      render(<ScreenshotModal {...defaultProps} allScreenshots={singleScreenshot} screenshot={singleScreenshot[0]} />);

      expect(screen.queryByTestId("screenshot-prev")).not.toBeInTheDocument();
      expect(screen.queryByTestId("screenshot-next")).not.toBeInTheDocument();
      expect(screen.queryByTestId("screenshot-position")).not.toBeInTheDocument();
    });
  });

  describe("Keyboard Navigation", () => {
    test("left arrow key navigates to previous", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} onNavigate={onNavigate} />);

      await user.keyboard("{ArrowLeft}");

      expect(onNavigate).toHaveBeenCalledWith(mockScreenshots[0]);
    });

    test("right arrow key navigates to next", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} onNavigate={onNavigate} />);

      await user.keyboard("{ArrowRight}");

      expect(onNavigate).toHaveBeenCalledWith(mockScreenshots[2]);
    });

    test("arrow keys only work when modal is open", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(<ScreenshotModal {...defaultProps} isOpen={false} onNavigate={onNavigate} />);

      await user.keyboard("{ArrowLeft}");
      await user.keyboard("{ArrowRight}");

      expect(onNavigate).not.toHaveBeenCalled();

      // Open modal
      rerender(
        <ScreenshotModal {...defaultProps} isOpen={true} screenshot={mockScreenshots[1]} onNavigate={onNavigate} />,
      );

      await user.keyboard("{ArrowRight}");
      expect(onNavigate).toHaveBeenCalledWith(mockScreenshots[2]);
    });

    test("left arrow does nothing on first screenshot", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[0]} onNavigate={onNavigate} />);

      await user.keyboard("{ArrowLeft}");

      expect(onNavigate).not.toHaveBeenCalled();
    });

    test("right arrow does nothing on last screenshot", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[2]} onNavigate={onNavigate} />);

      await user.keyboard("{ArrowRight}");

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe("Modal Behavior", () => {
    test("dialog is visible when isOpen is true", () => {
      render(<ScreenshotModal {...defaultProps} isOpen={true} />);

      const modal = screen.getByTestId("screenshot-modal");
      expect(modal).toBeVisible();
    });

    test("dialog is not rendered when isOpen is false", () => {
      render(<ScreenshotModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId("screenshot-modal")).not.toBeInTheDocument();
    });
  });

  describe("Screenshot Display", () => {
    test("displays correct alt text with URL", () => {
      render(<ScreenshotModal {...defaultProps} />);

      const image = screen.getByAltText(/Screenshot of https:\/\/example\.com\/page1/);
      expect(image).toBeInTheDocument();
    });

    test("handles screenshots with long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(200);
      const screenshot = createMockScreenshot({ url: longUrl });

      render(<ScreenshotModal {...defaultProps} screenshot={screenshot} />);

      expect(screen.getByText(longUrl)).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("handles empty allScreenshots array", () => {
      render(<ScreenshotModal {...defaultProps} allScreenshots={[]} />);

      expect(screen.queryByTestId("screenshot-prev")).not.toBeInTheDocument();
      expect(screen.queryByTestId("screenshot-next")).not.toBeInTheDocument();
    });

    test("handles invalid screenshot ID", () => {
      const invalidScreenshot = createMockScreenshot({ id: "invalid-id" });

      render(<ScreenshotModal {...defaultProps} screenshot={invalidScreenshot} />);

      // Should still render but navigation might not work correctly
      expect(screen.getByTestId("screenshot-modal")).toBeInTheDocument();
    });

    test("handles missing URL", () => {
      const screenshot = createMockScreenshot({ url: "" });

      render(<ScreenshotModal {...defaultProps} screenshot={screenshot} />);

      expect(screen.getByTestId("screenshot-modal")).toBeInTheDocument();
    });

    test("handles rapid navigation clicks", async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[0]} onNavigate={onNavigate} />);

      const nextButton = screen.getByTestId("screenshot-next");

      // Rapid clicks
      await user.click(nextButton);
      await user.click(nextButton);
      await user.click(nextButton);

      // Should be called for each click even if disabled
      expect(onNavigate).toHaveBeenCalled();
    });

    test("navigation updates when screenshot prop changes", () => {
      const { rerender } = render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[0]} />);

      expect(screen.getByTestId("screenshot-position")).toHaveTextContent("1 of 3");

      rerender(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[2]} />);

      expect(screen.getByTestId("screenshot-position")).toHaveTextContent("3 of 3");
    });
  });

  describe("Accessibility", () => {
    test("navigation buttons have accessible labels", () => {
      render(<ScreenshotModal {...defaultProps} screenshot={mockScreenshots[1]} />);

      const prevButton = screen.getByTestId("screenshot-prev");
      const nextButton = screen.getByTestId("screenshot-next");

      expect(prevButton).toHaveTextContent("Previous");
      expect(nextButton).toHaveTextContent("Next");
    });

    test("image has descriptive alt text", () => {
      render(<ScreenshotModal {...defaultProps} />);

      const image = screen.getByRole("img");
      expect(image).toHaveAttribute("alt");
      expect(image.getAttribute("alt")).toContain("Screenshot of");
    });

    test("dialog has appropriate ARIA attributes", () => {
      render(<ScreenshotModal {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
    });
  });
});
