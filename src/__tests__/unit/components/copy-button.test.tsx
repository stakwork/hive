// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("lucide-react", () => ({
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

import { CopyButton } from "@/components/ui/copy-button";

describe("CopyButton", () => {
  // userEvent.setup() installs its own clipboard stub — spy on writeText AFTER setup()
  function setupClipboard() {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    return { user, writeSpy };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls navigator.clipboard.writeText with the provided value", async () => {
    const { user, writeSpy } = setupClipboard();
    render(<CopyButton value="copy me" />);
    const btn = screen.getByRole("button", { name: /Copy/ });
    await user.click(btn);
    expect(writeSpy).toHaveBeenCalledWith("copy me");
  });

  test("shows Check icon after copy", async () => {
    const { user } = setupClipboard();
    render(<CopyButton value="test" />);
    await user.click(screen.getByRole("button", { name: /Copy/ }));
    // Should now show check icon
    expect(screen.getByTestId("icon-check")).toBeTruthy();
  });

  test("stops propagation so parent toggle is not triggered", async () => {
    setupClipboard();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyButton value="test" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
