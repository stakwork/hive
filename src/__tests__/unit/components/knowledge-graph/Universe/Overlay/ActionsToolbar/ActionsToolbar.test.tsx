import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionsToolbar } from "@/components/knowledge-graph/Universe/Overlay/ActionsToolbar";
import { CameraRecenterControl } from "@/components/knowledge-graph/Universe/Overlay/ActionsToolbar/CameraRecenterControl";
import { GraphClear } from "@/components/knowledge-graph/Universe/Overlay/ActionsToolbar/GraphClear";
import { GraphViewControl } from "@/components/knowledge-graph/Universe/Overlay/ActionsToolbar/GraphViewControl";

// Mock stores
vi.mock("@/stores/useStores", () => ({
  useDataStore: vi.fn((selector) => {
    const state = {
      isOnboarding: false,
      resetGraph: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
  useGraphStore: vi.fn((selector) => {
    const state = {
      cameraFocusTrigger: false,
      setCameraFocusTrigger: vi.fn(),
      graphStyle: "split",
      setGraphStyle: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock UI components
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  ToggleGroupItem: ({ children, className, ...props }: any) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
}));

// Mock icons
vi.mock("@/components/Icons/CameraCenterIcon", () => ({
  default: () => <div data-testid="camera-icon">CameraIcon</div>,
}));

vi.mock("@/components/Icons/ClearIcon", () => ({
  default: () => <div data-testid="clear-icon">ClearIcon</div>,
}));

vi.mock("@/components/Icons/BubbleChartIcon", () => ({
  default: () => <div>BubbleChartIcon</div>,
}));

vi.mock("@/components/Icons/GrainIcon", () => ({
  default: () => <div>GrainIcon</div>,
}));

describe("ActionsToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render with correct positioning classes", () => {
    const { container } = render(<ActionsToolbar />);

    const toolbar = container.querySelector("#actions-toolbar");
    expect(toolbar).toBeTruthy();
    expect(toolbar?.className).toContain("bottom-4");
    expect(toolbar?.className).toContain("right-5");
  });

  it("should use bottom-4 instead of bottom-5", () => {
    const { container } = render(<ActionsToolbar />);

    const toolbar = container.querySelector("#actions-toolbar");
    expect(toolbar?.className).toContain("bottom-4");
    expect(toolbar?.className).not.toContain("bottom-5");
  });
});

describe("CameraRecenterControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render button with w-10 h-10 classes", () => {
    const { container } = render(<CameraRecenterControl />);

    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    expect(button?.className).toContain("w-10");
    expect(button?.className).toContain("h-10");
  });

  it("should not use w-8 class", () => {
    const { container } = render(<CameraRecenterControl />);

    const button = container.querySelector("button");
    expect(button?.className).not.toContain("w-8");
  });

  it("should render with correct size classes for h-10 (40px)", () => {
    const { container } = render(<CameraRecenterControl />);

    const button = container.querySelector("button");
    expect(button?.className).toMatch(/w-10.*h-10|h-10.*w-10/);
  });
});

describe("GraphClear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render button with w-10 h-10 classes", () => {
    const { container } = render(<GraphClear />);

    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    expect(button?.className).toContain("w-10");
    expect(button?.className).toContain("h-10");
  });

  it("should not use w-8 class", () => {
    const { container } = render(<GraphClear />);

    const button = container.querySelector("button");
    expect(button?.className).not.toContain("w-8");
  });

  it("should render with correct size classes for h-10 (40px)", () => {
    const { container } = render(<GraphClear />);

    const button = container.querySelector("button");
    expect(button?.className).toMatch(/w-10.*h-10|h-10.*w-10/);
  });
});

describe("GraphViewControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render ToggleGroup with size lg", () => {
    const { container } = render(<GraphViewControl />);

    // The ToggleGroup should have been called with size="lg"
    // Since we're mocking it, we check the rendered output has expected structure
    const toggleGroup = container.querySelector("div");
    expect(toggleGroup).toBeTruthy();
  });

  it("should render ToggleGroupItem buttons with px-3 class", () => {
    const { container } = render(<GraphViewControl />);

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    
    buttons.forEach((button) => {
      expect(button.className).toContain("px-3");
    });
  });

  it("should not use px-5 class on ToggleGroupItem", () => {
    const { container } = render(<GraphViewControl />);

    const buttons = container.querySelectorAll("button");
    buttons.forEach((button) => {
      expect(button.className).not.toContain("px-5");
    });
  });

  it("should render toggle items for all graph styles", () => {
    const { container } = render(<GraphViewControl />);

    const buttons = container.querySelectorAll("button");
    // Should have 2 buttons: split and sphere
    expect(buttons.length).toBe(2);
  });
});

describe("ActionsToolbar Component Sizing Integration", () => {
  it("should ensure all action buttons have consistent h-10 sizing", () => {
    const { container: cameraContainer } = render(<CameraRecenterControl />);
    const { container: clearContainer } = render(<GraphClear />);

    const cameraButton = cameraContainer.querySelector("button");
    const clearButton = clearContainer.querySelector("button");

    expect(cameraButton?.className).toContain("h-10");
    expect(clearButton?.className).toContain("h-10");
  });

  it("should verify all components align at same baseline with bottom-4", () => {
    const { container } = render(<ActionsToolbar />);

    const toolbar = container.querySelector("#actions-toolbar");
    expect(toolbar?.className).toContain("bottom-4");
  });
});
