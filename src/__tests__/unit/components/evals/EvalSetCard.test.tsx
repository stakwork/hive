/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, onClick, ...props }: any) => (
    <div data-testid="card" onClick={onClick} {...props}>{children}</div>
  ),
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}));

// Mock ActionMenu to expose trigger and action buttons for testing
vi.mock("@/components/ui/action-menu", () => ({
  ActionMenu: ({ actions }: { actions: Array<{ label: string; onClick?: () => void; confirmation?: { onConfirm: () => void } }> }) => (
    <div data-testid="action-menu">
      {actions.map((action, i) => (
        <button
          key={i}
          data-testid={`action-${action.label.toLowerCase()}`}
          onClick={(e) => {
            e.stopPropagation();
            if (action.onClick) action.onClick();
            if (action.confirmation) action.confirmation.onConfirm();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("lucide-react", () => ({
  Pencil: () => <span>✏️</span>,
  Trash2: () => <span>🗑️</span>,
}));

import { EvalSetCard } from "@/components/evals/EvalSetCard";

const EVAL_SET = {
  ref_id: "eval-set-1",
  node_type: "EvalSet",
  properties: {
    name: "Code Quality Evals",
    description: "Tests for code quality",
    requirement_count: 3,
  },
};

describe("EvalSetCard", () => {
  const onClickMock = vi.fn();
  const onEditMock = vi.fn();
  const onDeleteMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the eval set name and requirement count", () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );
    expect(screen.getByText("Code Quality Evals")).toBeTruthy();
    expect(screen.getByTestId("badge").textContent).toContain("3 reqs");
  });

  it("renders description when present", () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );
    expect(screen.getByText("Tests for code quality")).toBeTruthy();
  });

  it("calls onClick when card is clicked", async () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );
    await userEvent.click(screen.getByTestId("eval-set-card"));
    expect(onClickMock).toHaveBeenCalledTimes(1);
  });

  it("fires onEdit when Edit action is clicked without triggering onClick", async () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );

    await userEvent.click(screen.getByTestId("action-edit"));

    expect(onEditMock).toHaveBeenCalledTimes(1);
    // Card onClick should NOT fire because ActionMenu stops propagation
    expect(onClickMock).not.toHaveBeenCalled();
  });

  it("fires onDelete when Delete action is confirmed without triggering onClick", async () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );

    await userEvent.click(screen.getByTestId("action-delete"));

    expect(onDeleteMock).toHaveBeenCalledTimes(1);
    expect(onClickMock).not.toHaveBeenCalled();
  });

  it("renders ActionMenu component", () => {
    render(
      <EvalSetCard
        evalSet={EVAL_SET}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );
    expect(screen.getByTestId("action-menu")).toBeTruthy();
  });

  it("shows singular 'req' for count of 1", () => {
    const singleReq = { ...EVAL_SET, properties: { ...EVAL_SET.properties, requirement_count: 1 } };
    render(
      <EvalSetCard
        evalSet={singleReq}
        onClick={onClickMock}
        onEdit={onEditMock}
        onDelete={onDeleteMock}
      />,
    );
    expect(screen.getByTestId("badge").textContent).toContain("1 req");
    expect(screen.getByTestId("badge").textContent).not.toContain("reqs");
  });
});
