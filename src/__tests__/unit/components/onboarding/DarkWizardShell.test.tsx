// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";

globalThis.React = React;
import { render, screen } from "@testing-library/react";
import { DarkWizardShell } from "@/components/onboarding/DarkWizardShell";

describe("DarkWizardShell", () => {
  it("renders children inside the dark container", () => {
    render(
      <DarkWizardShell>
        <div data-testid="child-content">Hello World</div>
      </DarkWizardShell>,
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByTestId("child-content").textContent).toBe("Hello World");
  });

  it("applies dark background class to the root element", () => {
    const { container } = render(
      <DarkWizardShell>
        <span>Content</span>
      </DarkWizardShell>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("bg-[#0a0a0a]");
    expect(root.className).toContain("text-zinc-100");
  });

  it("does NOT apply fixed overlay classes by default", () => {
    const { container } = render(
      <DarkWizardShell>
        <span>Content</span>
      </DarkWizardShell>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain("fixed");
    expect(root.className).not.toContain("inset-0");
    expect(root.className).not.toContain("z-50");
  });

  it("applies fixed overlay classes when overlay prop is true", () => {
    const { container } = render(
      <DarkWizardShell overlay>
        <span>Content</span>
      </DarkWizardShell>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("z-50");
  });

  it("renders blur blob elements", () => {
    const { container } = render(
      <DarkWizardShell>
        <span>Content</span>
      </DarkWizardShell>,
    );
    // The blob container has pointer-events-none
    const blobContainer = container.querySelector(".pointer-events-none");
    expect(blobContainer).toBeInTheDocument();
  });
});
