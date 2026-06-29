// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { LingoBreadcrumb } from "@/app/w/[slug]/lingo/components/Breadcrumb";

describe("LingoBreadcrumb", () => {
  const items = [
    { ref_id: "n1", name: "Pod Orchestration" },
    { ref_id: "n2", name: "Swarm" },
  ];

  it("renders Home link and all items", () => {
    render(<LingoBreadcrumb items={items} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("breadcrumb-home")).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb-item-0")).toHaveTextContent("Pod Orchestration");
    expect(screen.getByTestId("breadcrumb-item-1")).toHaveTextContent("Swarm");
  });

  it("last item is not a interactive button (just span)", () => {
    render(<LingoBreadcrumb items={items} onNavigate={vi.fn()} />);
    const lastItem = screen.getByTestId("breadcrumb-item-1");
    expect(lastItem.tagName).toBe("SPAN");
  });

  it("intermediate items are buttons", () => {
    render(<LingoBreadcrumb items={items} onNavigate={vi.fn()} />);
    const firstItem = screen.getByTestId("breadcrumb-item-0");
    expect(firstItem.tagName).toBe("BUTTON");
  });

  it("calls onNavigate(-1) when Home is clicked", () => {
    const onNavigate = vi.fn();
    render(<LingoBreadcrumb items={items} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId("breadcrumb-home"));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("calls onNavigate(0) when first item is clicked", () => {
    const onNavigate = vi.fn();
    render(<LingoBreadcrumb items={items} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId("breadcrumb-item-0"));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("renders single item with last item as span", () => {
    const singleItem = [{ ref_id: "n1", name: "Only Term" }];
    render(<LingoBreadcrumb items={singleItem} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("breadcrumb-item-0").tagName).toBe("SPAN");
  });

  it("renders empty items with only Home", () => {
    render(<LingoBreadcrumb items={[]} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("breadcrumb-home")).toBeInTheDocument();
    expect(screen.queryByTestId("breadcrumb-item-0")).not.toBeInTheDocument();
  });
});
